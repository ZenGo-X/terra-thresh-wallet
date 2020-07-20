import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

import {
  EcdsaParty2 as Party2,
  EcdsaParty2Share as Party2Share,
  EcdsaSignature as MPCSignature,
} from '@kzen-networks/thresh-sig';

import { Key, AccAddress } from '@terra-money/terra.js';

const P1_ENDPOINT = 'http://localhost:8000';
const HD_COIN_INDEX = 0;
/**
 * An implementation of the Key interfaces that uses a raw private key.  */ export class ThreasholdKey extends Key {
  /**
   * Raw private key, in bytes.
   */
  private p2: Party2;
  private p2MasterKeyShare: Party2Share;

  constructor(masterKey: Party2Share, p2: Party2, addressIndex: number = 0) {
    const publicKey = getPublicKey(masterKey, p2, addressIndex);
    const publicKeyHex = publicKey.encode('hex', true);
    const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
    super(publicKeyBuffer);
    this.p2MasterKeyShare = masterKey;
    this.p2 = p2;
  }

  public sign(payload: Buffer): Buffer {
    return payload;
    // const signatureMPC: MPCSignature = await this.p2.sign(
    //   payload,
    //   p2ChildShare,
    //   HD_COIN_INDEX,
    //   addressIndex,
    // );
    // client_debug('Signature', MPCSignature);
    // const signature = signatureMPC.toBuffer();
    // const publicKeyBasePoint = this.getPublicKey(addressIndex);
    // const publicKeyHex = publicKeyBasePoint.encode('hex', true);
    // const publicKey = Buffer.from(publicKeyHex, 'hex');
    // return { signature, publicKey };
  }
}
/**
 * @return {Elliptic.PublicKey} PubKey
 */
function getPublicKey(
  p2MasterKeyShare: Party2Share,
  p2: Party2,
  addressIndex: number,
) {
  // assuming a single default address
  const p2ChildShare = p2.getChildShare(
    p2MasterKeyShare,
    HD_COIN_INDEX,
    addressIndex,
  );
  return p2ChildShare.getPublicKey();
}
