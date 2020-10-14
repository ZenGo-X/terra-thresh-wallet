import assert from 'assert';
import path from 'path';

import { DummyKey } from './dummyKey';
import { getChainID, getGasPrices, GasPrices } from './info';
import { ChainName, Chains } from './api';

import {
  AccAddress,
  MnemonicKey,
  LCDClient,
  Wallet,
  MsgSend,
  MsgDelegate,
  MsgSwap,
  StdSignature,
  StdTx,
  StdSignMsg,
  StdFee,
  Coin,
  Coins,
  Denom,
} from '@terra-money/terra.js';

import {
  EcdsaParty2 as Party2,
  EcdsaParty2Share as Party2Share,
  EcdsaSignature as MPCSignature,
} from '@kzen-networks/thresh-sig';

import SHA256 from 'crypto-js/sha256';

const P1_ENDPOINT = 'http://localhost:8000';
const HD_COIN_INDEX = 0;
const CLIENT_DB_PATH = path.join(__dirname, '../../client_db');

import fs from 'fs';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

type SendOptions = {
  memo?: string;
  feeDenom?: Denom;
};

export class TerraThreshSigClient {
  private db: any;
  private p2: Party2;
  private chainName: ChainName;
  private p2MasterKeyShare: Party2Share;
  private lcd: LCDClient;

  constructor() {
    this.p2 = new Party2(P1_ENDPOINT);
  }

  public async getBalance(address: string): Promise<Coins> {
    return this.lcd.bank.balance(address);
  }

  public async getValidatorStats(validator: string) {
    let res = await this.lcd.staking.validator(validator);
    console.log(res);
  }

  /**
   * Checks that the account has at least as much balance as requested by transaction
   * Returns balance in Coins for future use
   */
  private async checkEnoughBalance(
    address: string,
    amount: string,
    denom: Denom,
  ): Promise<Coins> {
    const balance = await this.getBalance(address);
    const balanceCoins = balance.filter((res) => res.denom === denom);
    assert(
      Number(amount) < Number(balanceCoins.get(denom)?.toData().amount),
      'Not enough balance',
    );
    return balance;
  }

  private async createTransferTx(
    from: string,
    to: string,
    amount: string,
    denom: Denom,
    options?: SendOptions,
    sendAll?: boolean,
  ): Promise<StdSignMsg> {
    // For sending all, set the amount to the minimum, so that gas estimation works properly
    if (sendAll) {
      // Place holder so that gas estimation will not fail
      amount = '1';
    }
    // Optionally add a memo the transaction
    const memo: string = (options && options.memo) || '';
    const balance = await this.checkEnoughBalance(from, amount, denom);

    // Set default denom to uluna
    if (denom == null) {
      denom = 'uluna';
    }

    // Coins for amount
    let coin = new Coin(denom, amount);
    let coins = new Coins([coin]);

    let gasPrices: GasPrices = await getGasPrices(this.chainName);

    let gasPrice = gasPrices[denom];
    console.log('GasPrice', gasPrice);

    let gasPriceCoin;
    let gasPriceCoins;

    if (gasPrice) {
      gasPriceCoin = new Coin(denom, gasPrice);
      gasPriceCoins = new Coins([gasPriceCoin]);
    } else {
      throw 'Illegal denominator';
    }

    let send = new MsgSend(from, to, coins);

    // Create tx
    // This also estimates the initial fees
    let tx = await this.lcd.tx.create(from, {
      msgs: [send],
      gasPrices: gasPriceCoins,
    });

    // Extract estimated fee
    let fee = tx.fee;

    // Covernt balance to Coins in relevant denom
    const balanceCoins = balance.filter((res) => res.denom === denom);

    // console.log('Amount', amount);
    // console.log('Fees', fee.amount.get(denom)?.toData().amount);
    // console.log('Balance', Number(balanceCoins.get(denom)?.toData().amount));

    // Make sure the fees + amount are sufficient
    assert(
      Number(fee.amount.get(denom)?.toData().amount) + Number(amount) <=
        Number(balanceCoins.get(denom)?.toData().amount),
      'Not enough balance to cover the fees',
    );

    // Special care for sending all
    if (sendAll) {
      // Deduct fees from the balance of tokens
      let amountSubFee = balanceCoins.sub(fee.amount);

      // For tokens other than LUNA, an additional stablity tax is payed
      if (denom != 'uluna') {
        // Tax rate per token sent
        const taxRate = await this.lcd.treasury.taxRate();
        // Cap on max tax per transactions
        const taxCap = await this.lcd.treasury.taxCap(denom);
        const taxCapAmount = Number(taxCap.toData().amount);
        // Subtract known fees from amount to be sent
        let taxedAmount = amountSubFee.get(denom)?.toData().amount;
        // Take the min between the max tax and the tax for tx
        let taxToPay = Math.floor(
          Math.min(taxCapAmount, Number(taxRate) * Number(taxedAmount)),
        );

        let taxCoin = new Coin(denom, taxToPay);
        // Subtract tax from the payed amount
        amountSubFee = amountSubFee.sub(taxCoin);
        // Add tax to the fee to be payed
        fee = new StdFee(fee.gas, fee.amount.add(taxCoin));
      }
      // Create a new message with adjusted amount
      send = new MsgSend(from, to, amountSubFee);

      // Create a new Tx with the updates fees
      tx = await this.lcd.tx.create(from, {
        msgs: [send],
        fee: fee,
      });
    }
    return tx;
  }

  /**
   * Transfer tokens to address
   * @param to  address to send tokens to
   * @param amount Amount of tokens to send in u<Token>  == <Token> * 1e6
   * @param denom Denomination of tokens to use. One of uluna, uusd, ukrw etc.
   * @param options Optional memo and different gas fees
   * @param sendAll Use special logic to send all tokens of specified denom
   * @param dryRun Create trasnsaction but do not broadcast
   */
  public async transfer(
    from: string,
    to: string,
    amount: string,
    denom: Denom,
    options?: SendOptions,
    sendAll?: boolean,
    syncSend?: boolean,
    dryRun?: boolean,
  ) {
    // Validate to address
    assert(AccAddress.validate(to), 'To address is invalid');
    ////////////////////// Siging and broadcasting is split into steps ////////////////
    // Step 1: creating the trasnsaction (done)
    const tx = await this.createTransferTx(
      from,
      to,
      amount,
      denom,
      options,
      sendAll,
    );

    // Get relevant from address index (for sign and public key)
    const addressObj: any = this.db
      .get('addresses')
      .find({ accAddress: from })
      .value();

    const addressIndex: number = addressObj.index;

    // Step 2: Signing the message
    // Sign the raw tx data
    let sigData = await this.sign(addressIndex, Buffer.from(tx.toJSON()));

    let pubKey = this.getPublicKeyBuffer(addressIndex).toString('base64');

    // Step 3: Inject signature to messate
    // Createa a sig+public key object
    let stdSig = StdSignature.fromData({
      signature: sigData.toString('base64'),
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: pubKey,
      },
    });

    // Create message object
    const stdTx = new StdTx(tx.msgs, tx.fee, [stdSig], tx.memo);

    // Step 3: Broadcasting the message
    if (dryRun) {
      console.log('------ Dry Run ----- ');
      console.log(tx.toJSON());
    } else {
      console.log(' ===== Executing ===== ');
      console.log(stdTx.toJSON());
      let resp;
      console.log('SyncSend', syncSend);
      if (syncSend) {
        resp = await this.lcd.tx.broadcast(stdTx);
      } else {
        resp = await this.lcd.tx.broadcastSync(stdTx);
      }
      return resp;
    }
  }

  /**
   * Transfer tokens to address
   * @param to  address to send tokens to
   * @param amount Amount of tokens to send in u<Token>  == <Token> * 1e6
   * @param denom Denomination of tokens to use. One of uluna, uusd, ukrw etc.
   * @param options Optional memo and different gas fees
   * @param sendAll Use special logic to send all tokens of specified denom
   * @param dryRun Create trasnsaction but do not broadcast
   */
  public async delegate(
    from: string,
    to: string,
    amount: string,
    denom: Denom,
    options?: SendOptions,
    sendAll?: boolean,
    syncSend?: boolean,
    dryRun?: boolean,
  ) {
    // Validate to address
    assert(AccAddress.validate(to), 'To address is invalid');

    // Optionally add a memo the transaction
    const memo: string = (options && options.memo) || '';
    const balance = await this.checkEnoughBalance(from, amount, denom);

    // Set default denom to uluna
    if (denom == null) {
      denom = 'uluna';
    }

    // Coins for amount
    let coin = new Coin(denom, amount);

    let gasPrices: GasPrices = await getGasPrices(this.chainName);

    let gasPrice = gasPrices[denom];
    console.log('GasPrice', gasPrice);

    let gasPriceCoin;
    let gasPriceCoins;

    if (gasPrice) {
      gasPriceCoin = new Coin(denom, gasPrice);
      gasPriceCoins = new Coins([gasPriceCoin]);
    } else {
      throw 'Illegal denominator';
    }

    let send = new MsgDelegate(from, to, coin);

    // Create tx
    // This also estimates the initial fees
    let tx = await this.lcd.tx.create(from, {
      msgs: [send],
      gasPrices: gasPriceCoins,
    });
  }

  /**
   * Initiate the client
   * @param accAddress Address to use for wallet generation. Optional. Otherwise uses index 0
   */
  public async init(chainName?: ChainName) {
    this.initDb();
    this.initMasterKey();

    if (chainName == null) {
      chainName = 'tequila';
    }
    this.chainName = chainName;

    let URL = Chains[chainName];
    let chainID = await getChainID(chainName);
    console.log('URL', URL);
    console.log('chainID', chainID);

    // The LCD clients must be initiated with a node and chain_id
    this.lcd = new LCDClient({
      //URL: 'https://tequila-lcd.terra.dev', // public node soju
      //chainID: 'tequila-0001',
      URL,
      chainID,
    });
  }

  private initDb() {
    ensureDirSync(CLIENT_DB_PATH);
    const adapter = new FileSync(`${CLIENT_DB_PATH}/db.json`);
    this.db = low(adapter);
    this.db.defaults({ mkShare: null, addresses: [] }).write();
  }

  /**
   * Initialize the client's master key.
   * Will either generate a new one by the 2 party protocol, or restore one from previous session.
   * @return {Promise}
   */
  private async initMasterKey() {
    this.p2MasterKeyShare = await this.restoreOrGenerateMasterKey();
  }

  /**
   * Fetch the share from the database or create a new share with the server
   */
  private async restoreOrGenerateMasterKey(): Promise<Party2Share> {
    const p2MasterKeyShare = this.db.get('mkShare').value();
    if (p2MasterKeyShare) {
      return p2MasterKeyShare;
    }
    return this.generateMasterKeyShare();
  }

  private async generateMasterKeyShare(): Promise<Party2Share> {
    const p2MasterKeyShare: Party2Share = await this.p2.generateMasterKey();
    this.db.set('mkShare', p2MasterKeyShare).write();

    return p2MasterKeyShare;
  }

  /**
   * get the address of the specified index. If the index is omitted, will return the default address (of index 0).
   * @param addressIndex HD index of the address to get
   */
  public getAddress(addressIndex = 0): string {
    const publicKeyBuffer = this.getPublicKeyBuffer(addressIndex);
    // This is only to generate an address from public key
    const address = new DummyKey(publicKeyBuffer);

    const accAddress = address.accAddress;
    const dbAddress = this.db.get('addresses').find({ accAddress }).value();
    if (!dbAddress) {
      this.db
        .get('addresses')
        .push({ accAddress, index: addressIndex })
        .write();
    }
    return address.accAddress;
  }

  private getPublicKeyBuffer(addressIndex: number): Buffer {
    const publicKey = this.getPublicKey(addressIndex);
    const publicKeyHex = publicKey.encode('hex', true);
    return Buffer.from(publicKeyHex, 'hex');
  }

  private getPublicKey(addressIndex: number) {
    // assuming a single default address
    const p2ChildShare = this.p2.getChildShare(
      this.p2MasterKeyShare,
      HD_COIN_INDEX,
      addressIndex,
    );
    return p2ChildShare.getPublicKey();
  }

  // Two party signing function
  private async sign(addressIndex: number, payload: Buffer): Promise<Buffer> {
    const p2ChildShare: Party2Share = this.p2.getChildShare(
      this.p2MasterKeyShare,
      HD_COIN_INDEX,
      addressIndex,
    );

    const hash = Buffer.from(SHA256(payload.toString()).toString(), 'hex');

    const signatureMPC: MPCSignature = await this.p2.sign(
      hash,
      p2ChildShare,
      HD_COIN_INDEX,
      addressIndex,
    );
    const signature = signatureMPC.toBuffer();
    return signature;
  }
}

function ensureDirSync(dirpath: string) {
  try {
    fs.mkdirSync(dirpath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Create many terra addresses (for stress testing)
export function addressGenerator() {
  for (let i = 0; i < 70000; i++) {
    const mk = new MnemonicKey();
    console.log('"' + mk.accAddress + '",');
  }
}
