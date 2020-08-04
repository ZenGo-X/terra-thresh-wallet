import assert from 'assert';
import path from 'path';

import { DEFULT_GAS_PRICE } from './constants';
import { ThreasholdKey } from './threasholdKey';

import {
  Key,
  AccAddress,
  MnemonicKey,
  LCDClient,
  Wallet,
  MsgSend,
  MsgSwap,
  StdSignature,
  StdTx,
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

const client_debug = require('debug')('client_debug');

import fs from 'fs';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

const CLIENT_DB_PATH = path.join(__dirname, '../../client_db');
const P1_ENDPOINT = 'http://localhost:8000';

type SendOptions = {
  memo?: string;
  feeDenom?: Denom;
};

export class TerraThreshSigClient {
  private mainnet: boolean;
  private db: any;
  private p2: Party2;
  private p2MasterKeyShare: Party2Share;
  private terraWallet: Wallet;

  constructor(mainnet: boolean = false) {
    this.p2 = new Party2(P1_ENDPOINT);
  }

  public async getBalance(address?: string): Promise<Coins> {
    if (address == null) {
      address = this.terraWallet.key.accAddress;
    }
    return this.terraWallet.lcd.bank.balance(address);
  }

  /**
   * Transfer tokens to address
   * @param amount Amount of tokens to swa in u<Token>  == <Token> * 1e6
   * @param denom Denomination of tokens to use. One of uluna, uusd, ukrw etc.
   * @param ask Denom of tokens to received. One of uluna, uusd, ukrw
   * @param dryRun Create trasnsaction but do not broadcast
   */
  public async swap(
    amount: string,
    denom: Denom,
    ask: Denom,
    options?: SendOptions,
    dryRun?: boolean,
  ) {
    let offer = new Coin(denom, amount);

    // This is an example of creating a transaction without breaking down to stesp
    const msg = new MsgSwap(this.terraWallet.key.accAddress, offer, ask);

    // This is
    const tx = await this.terraWallet.createAndSignTx({
      msgs: [msg],
    });

    if (dryRun) {
      console.log('------ Dry Run ----- ');
      console.log(tx.toJSON());
    } else {
      console.log(' ===== Executing ===== ');
      console.log(tx.toJSON());
      let resp = await this.terraWallet.lcd.tx.broadcast(tx);
      return resp;
    }
  }

  /**
   * Checks that the account has at least as much balance as requested by transaction
   * Returns balance in Coins for future use
   */
  private async checkEnoughBalance(
    amount: string,
    denom: Denom,
  ): Promise<Coins> {
    const balance = await this.getBalance();
    const balanceCoins = balance.filter((res) => res.denom === denom);
    assert(
      Number(amount) < Number(balanceCoins.get(denom)?.toData().amount),
      'Not enough balance',
    );
    return balance;
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
    to: string,
    amount: string,
    denom: Denom,
    options?: SendOptions,
    sendAll?: boolean,
    dryRun?: boolean,
  ) {
    // For sending all, set the amount to the minimum, so that gas estimation works properly
    if (sendAll) {
      // Place holder so that gas estimation will not fail
      amount = '1';
    }
    // Optionally add a memo the transaction
    const memo: string = (options && options.memo) || '';
    const balance = await this.checkEnoughBalance(amount, denom);

    // Set default denom to uluna
    if (denom == null) {
      denom = 'uluna';
    }

    // Coins for amount
    let coin = new Coin(denom, amount);
    let coins = new Coins([coin]);

    // Coins for gas fees
    const gasPriceCoin = new Coin(denom, DEFULT_GAS_PRICE);
    const gasPriceCoins = new Coins([gasPriceCoin]);

    let send = new MsgSend(this.terraWallet.key.accAddress, to, coins);

    // Create tx
    // This also estimates the initial fees
    let tx = await this.terraWallet.createTx({
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
        const taxRate = await this.terraWallet.lcd.treasury.taxRate();
        // Cap on max tax per transactions
        const taxCap = await this.terraWallet.lcd.treasury.taxCap(denom);
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
      send = new MsgSend(this.terraWallet.key.accAddress, to, amountSubFee);

      // Create a new Tx with the updates fees
      tx = await this.terraWallet.createTx({
        msgs: [send],
        fee: fee,
      });
    }
    ////////////////////// Siging and broadcasting is split into steps ////////////////
    // Step 1: creating the trasnsaction (done)

    // Step 2: Signing the message
    // Sign the raw tx data
    let sigData = await this.terraWallet.key.sign(Buffer.from(tx.toJSON()));

    // Createa a sig+public key object
    let stdSig = StdSignature.fromData({
      signature: sigData.toString('base64'),
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: this.terraWallet.key.publicKey.toString('base64'),
      },
    });

    // Create message + signature for boradcasting
    const stdTx = new StdTx(tx.msgs, tx.fee, [stdSig], tx.memo);

    // Step 3: Broadcasting the message
    if (dryRun) {
      console.log('------ Dry Run ----- ');
      console.log(tx.toJSON());
    } else {
      console.log(' ===== Executing ===== ');
      console.log(tx.toJSON());
      let resp = await this.terraWallet.lcd.tx.broadcast(stdTx);
      return resp;
    }
  }

  /**
   * Initiate the client
   * @param accAddress Address to use for wallet generation. Optional. Otherwise uses index 0
   */
  public async init(accAddress?: string) {
    this.initDb();

    let masterKeyShare = await this.initMasterKey();
    this.p2MasterKeyShare = masterKeyShare;

    // The LCD clients must be initiated with a node and chain_id
    const terraClient = new LCDClient({
      // URL: 'https://lcd.terra.dev', // public node columbus_3
      // URL: 'http://52.78.43.42:1317', // private node columbus_3
      // chainID: 'columbus_3',

      // URL: 'https://soju-lcd.terra.dev' // public node soju
      // URL: 'http://52.78.69.160:1317', //public node 2 soju
      URL: 'http://54.249.197.56:1317', //private node soju
      // URL: 'http://54.244.217.202:1317', //amanusk node
      chainID: 'soju-0014',
    });

    let addressIndex = 0;
    const addressObj: any = this.db
      .get('addresses')
      .find({ accAddress })
      .value();
    if (addressObj) {
      addressIndex = addressObj.index;
    }

    const key = new ThreasholdKey(masterKeyShare, this.p2, addressIndex);
    this.terraWallet = terraClient.wallet(key);
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
    return this.restoreOrGenerateMasterKey();
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
    const address: Key = new ThreasholdKey(
      this.p2MasterKeyShare,
      this.p2,
      addressIndex,
    );
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
