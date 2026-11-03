/** Ambient types for `noise-handshake` (Holepunch), which ships none. Only the surface `noise.ts` drives. */
declare module 'noise-handshake' {
  export interface NoiseState {
    initialise(prologue: Uint8Array, remoteStatic?: Uint8Array): void;
    send(payload?: Uint8Array): Uint8Array;
    recv(message: Uint8Array): Uint8Array;
    complete: boolean;
    rs: Uint8Array | null;
    tx: Uint8Array | null;
    rx: Uint8Array | null;
    hash: Uint8Array | null;
  }

  export interface NoiseConstructor {
    new (
      pattern: 'IK' | 'XX' | 'XXpsk0',
      initiator: boolean,
      staticKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array },
      opts?: { psk?: Uint8Array },
    ): NoiseState;
  }

  const Noise: NoiseConstructor;
  export default Noise;
}

declare module 'noise-handshake/dh.js' {
  const dh: { generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } };
  export default dh;
}
