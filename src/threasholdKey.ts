import {
  EcdsaParty2 as Party2,
  EcdsaParty2Share as Party2Share,
  EcdsaSignature as MPCSignature,
} from '@kzen-networks/thresh-sig';
import SHA256 from 'crypto-js/sha256';

import { Key } from '@terra-money/terra.js';

const HD_COIN_INDEX = 0;
/**
 * An implementation of the Key interfaces that uses a raw private key.  */

/**
 * Raw private key, in bytes.
 */

export class ThreasholdKey extends Key {
  private p2: Party2;
  private p2MasterKeyShare: Party2Share;
  private addressIndex: number;

  constructor(masterKey: Party2Share, p2: Party2, addressIndex: number = 0) {
    const publicKey = getPublicKey(masterKey, p2, addressIndex);
    const publicKeyHex = publicKey.encode('hex', true);
    const publicKeyBuffer = Buffer.from(publicKeyHex, 'hex');
    super(publicKeyBuffer);
    this.p2MasterKeyShare = masterKey;
    this.p2 = p2;
    this.addressIndex = addressIndex;
  }

  public async sign(payload: Buffer): Promise<Buffer> {
    const p2ChildShare: Party2Share = this.p2.getChildShare(
      this.p2MasterKeyShare,
      HD_COIN_INDEX,
      this.addressIndex,
    );

    const hash = Buffer.from(SHA256(payload.toString()).toString(), 'hex');

    const signatureMPC: MPCSignature = await this.p2.sign(
      hash,
      p2ChildShare,
      HD_COIN_INDEX,
      this.addressIndex,
    );
    const signature = signatureMPC.toBuffer();
    return signature;
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
