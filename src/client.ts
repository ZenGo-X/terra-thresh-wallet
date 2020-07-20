import { DEFULT_GAS_PRICE, DEFAULT_GAS_COEFFICIENT, Denom } from './constants';

import {
  Key,
  MnemonicKey,
  AccAddress,
  LCDClient,
  Wallet,
  MsgSend,
} from '@terra-money/terra.js';

import fs from 'fs';
import path from 'path';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

type SendOptions = {
  memo?: string;
  feeDenom?: Denom;
};

const CLIENT_DB_PATH = path.join(__dirname, '../../client_db');

export class TerraThreshSigClient {
  private mainnet: boolean;
  private db: any;
  private mk: Key;
  private terraWallet: Wallet;

  constructor(mainnet: boolean = false) {}

  public async init(path: string = `${CLIENT_DB_PATH}/db.json`) {
    this.initDb(path);
    this.mk = await this.restoreOrGenerate();

    const terraClient = new LCDClient({
      URL: 'https://soju-lcd.terra.dev',
      chainID: 'soju-0014',
    });
    const mk = new MnemonicKey({
      mnemonic:
        'addict achieve regret denial what title test tell fade test modify ship same torch blame general unit extend program dove few melody rack dry',
    });
    // this.terraWallet = terraClient.wallet(this.mk);
    this.terraWallet = terraClient.wallet(mk);
  }

  public async getBalance(address: string): Promise<any> {
    if (address == null) {
      address = this.mk.accAddress;
    }
    return this.terraWallet.lcd.bank.balance(address);
    //return get(chainName, `/bank/balances/${address}`);
  }

  public async transfer(
    from: string,
    to: string,
    amount: string,
    denom: Denom,
    options?: SendOptions,
    sendAll?: boolean,
    dryRun?: boolean,
  ) {
    const memo: string = (options && options.memo) || '';

    console.log('memo=', memo);

    const send = new MsgSend(this.terraWallet.key.accAddress, to, {
      uluna: 1000,
    });

    const tx = await this.terraWallet.createAndSignTx({
      msgs: [send],
      memo: 'Hello',
    });

    if (dryRun) {
      console.log('------ Dry Run ----- ');
      console.log(tx);
    } else {
      console.log(' ===== Executing ===== ');
      console.log(tx);
      let resp = await this.terraWallet.lcd.tx.broadcast(tx);
      console.log(resp);
    }
  }

  private async restoreOrGenerate(): Promise<Key> {
    let addr = await this.db.get('mkShare').value();
    if (addr) {
      return addr;
    }
    return this.generateAddress();
  }

  public getAddress(): AccAddress {
    return this.mk.accAddress;
  }

  private async generateAddress(): Promise<Key> {
    const mk = new MnemonicKey();
    this.db.set('mkShare', mk).write();
    return mk;
  }

  private initDb(path: string) {
    ensureDirSync(CLIENT_DB_PATH);
    const adapter = new FileSync(path);
    this.db = low(adapter);
    this.db.defaults().write();
  }
}

function ensureDirSync(dirpath: string) {
  try {
    fs.mkdirSync(dirpath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}
