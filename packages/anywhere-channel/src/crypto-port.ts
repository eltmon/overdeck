/**
 * The crypto port: the three primitives the channel protocol needs, so the
 * same protocol source runs on Node (`nodeCrypto`) and in a browser
 * (`webCrypto`). See pan-4823 D-7.
 */
export interface CryptoPort {
  sha256(data: Uint8Array): Uint8Array;
  randomBytes(n: number): Uint8Array;
  /** Constant-time equality; `false` when the lengths differ. */
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
