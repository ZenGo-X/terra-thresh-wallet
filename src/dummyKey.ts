import { Key } from '@terra-money/terra.js';

export class DummyKey extends Key {
  async sign(payload: Buffer): Promise<Buffer> {
    return payload;
  }
}
