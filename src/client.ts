import { DEFULT_GAS_PRICE, DEFAULT_GAS_COEFFICIENT, Denom } from './constants';
import { ThreasholdKey } from './threasholdKey';
import path from 'path';

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
    //return get(chainName, `/bank/balances/${address}`);
  }

  public async swap(
    amount: string,
    denom: Denom,
    ask: Denom,
    options?: SendOptions,
    dryRun?: boolean,
  ) {
    let offer = new Coin(denom, amount);

    const msg = new MsgSwap(this.terraWallet.key.accAddress, offer, ask);

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

  public async transfer(
    to: string,
    amount: string,
    denom: Denom,
    options?: SendOptions,
    sendAll?: boolean,
    dryRun?: boolean,
  ) {
    const memo: string = (options && options.memo) || '';
    //console.log('sending from', this.terraWallet.key.accAddress);

    if (sendAll) {
      // Place holder so that gas esitmation will not fail
      amount = '1';
    }
    if (denom == null) {
      denom = 'uluna';
    }
    let coin = new Coin(denom, amount);
    let coins = new Coins([coin]);

    let send = new MsgSend(this.terraWallet.key.accAddress, to, coins);

    const gasPriceCoin = new Coin(denom, 0.015);
    const gasPriceCoins = new Coins([gasPriceCoin]);
    // console.log('gasPriceCoins', gasPriceCoins);

    // Create tx with fees and amounts
    let tx = await this.terraWallet.createTx({
      msgs: [send],
      fee: new StdFee(1, new Coins([new Coin(denom, 1)])),
    });

    // Actual right way to calculate fees
    let fee = await this.terraWallet.lcd.tx.estimateFee(tx, {
      gasPrices: gasPriceCoins,
    });
    // console.log('Tx', tx.toJSON());
    // console.log('GasPriceCoin', gasPriceCoins.toJSON());
    // console.log('Fee coin', fee.amount);

    if (sendAll) {
      // TODO fail sending if gas is more that balance
      const balance = await this.getBalance();

      const balanceCoins = balance.filter((res) => res.denom === denom);

      // console.log('Initial amout', coins);
      let amountSubFee = balanceCoins.sub(fee.amount);
      // console.log('Amount sub fee', amountSubFee);

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
    }

    // Create a new Tx with propper gas estimation
    tx = await this.terraWallet.createTx({
      msgs: [send],
      fee: fee,
    });

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

    // Combined message for broadcasting
    const stdTx = new StdTx(tx.msgs, tx.fee, [stdSig], tx.memo);

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

export function addressGenerator() {
  for (let i = 0; i < 70000; i++) {
    const mk = new MnemonicKey();
    console.log('"' + mk.accAddress + '",');
  }
}
