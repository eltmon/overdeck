/** Ambient types for `@hyperswarm/secret-stream`, which ships none. Only the surface the web channel uses. */
declare module '@hyperswarm/secret-stream' {
  import { Duplex } from 'streamx';

  export default class SecretStream extends Duplex {
    constructor(
      isInitiator: boolean,
      rawStream: unknown,
      opts: {
        handshake: { tx: Uint8Array; rx: Uint8Array; hash: Uint8Array; publicKey: Uint8Array; remotePublicKey: Uint8Array };
        data?: Uint8Array;
      },
    );
  }
}
