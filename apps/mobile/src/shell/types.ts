/** Records the shell keeps in secure storage (PAN-4837 D-6). */

/** The `account` secret: the overdeck.ai device token from the PKCE sign-in. */
export interface AccountRecord {
  token: string;
  deviceId: string;
  label: string;
}

/** One entry of the `machines` secret: a machine this phone paired with, and its own link key for it. */
export interface PairedMachine {
  environmentId: string;
  label: string;
  /** The machine's X25519 public key, 64 lowercase hex. */
  machineKeyHex: string;
  /** This phone's link key pair for this machine (C-1), 64 lowercase hex each. */
  linkPublicKeyHex: string;
  linkSecretKeyHex: string;
  /** The machine's phone-kind access token and its id. */
  token: string;
  tokenId: string;
  /** ISO-8601 UTC. */
  pairedAt: string;
}
