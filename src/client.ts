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
  StdSignature,
  StdTx,
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
  private mk: Key;
  private p2: Party2;
  private p2MasterKeyShare: Party2Share;
  private terraWallet: Wallet;

  constructor(mainnet: boolean = false) {
    this.p2 = new Party2(P1_ENDPOINT);
  }

  public async getBalance(address: string): Promise<any> {
    if (address == null) {
      address = this.mk.accAddress;
    }
    return this.terraWallet.lcd.bank.balance(address);
    //return get(chainName, `/bank/balances/${address}`);
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
    console.log('sending from', this.terraWallet.key.accAddress);

    if (denom == null) {
      denom = 'uluna';
    }

    const send = new MsgSend(this.terraWallet.key.accAddress, to, {
      denom: amount,
    });

    const tx = await this.terraWallet.createTx({
      msgs: [send],
    });

    let sigData = await this.terraWallet.key.sign(Buffer.from(tx.toJSON()));
    let stdSig = StdSignature.fromData({
      signature: sigData.toString('base64'),
      pub_key: {
        type: 'tendermint/PubKeySecp256k1',
        value: this.terraWallet.key.publicKey.toString('base64'),
      },
    });

    const stdTx = new StdTx(tx.msgs, tx.fee, [stdSig], tx.memo);

    if (dryRun) {
      console.log('------ Dry Run ----- ');
      console.log(tx.toJSON());
    } else {
      console.log(' ===== Executing ===== ');
      console.log(tx.toJSON());
      let resp = await this.terraWallet.lcd.tx.broadcast(stdTx);
      console.log(resp);
    }
  }

  public async init(path: string = `${CLIENT_DB_PATH}/db.json`) {
    this.initDb();
    let masterKeyShare = await this.initMasterKey();
    this.p2MasterKeyShare = masterKeyShare;

    const terraClient = new LCDClient({
      URL: 'https://soju-lcd.terra.dev',
      chainID: 'soju-0014',
    });

    // TODO: Ge pass the address and get the index of the address from hd

    const key = new ThreasholdKey(masterKeyShare, this.p2);
    this.terraWallet = terraClient.wallet(key);

    // THIS IS WHERE WE NEED TO REPLACE WITH TREASHOLD KEY
    // const mk = new MnemonicKey({
    //   mnemonic:
    //     'addict achieve regret denial what title test tell fade test modify ship same torch blame general unit extend program dove few melody rack dry',
    // });
    // console.log('Key Mnemonic', mk);
    // this.terraWallet = terraClient.wallet(mk);
    // console.log('Wallet Mnemonic', this.terraWallet);
    // this.terraWallet = terraClient.wallet(mk);
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
