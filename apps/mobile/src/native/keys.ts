/**
 * The `OverdeckKeys` native plugin (PAN-4837 FR-3, D-6, C-1): the install's client id and push
 * public key, and named secrets in the iOS Keychain or Android encrypted storage. The push secret
 * key never crosses the bridge. Link keys are per machine and live in the `machines` secret.
 */
import { registerPlugin } from '@capacitor/core';

export type SecretName = 'account' | 'machines';

export interface DeviceIdentity {
  clientId: string;
  pushPublicKeyHex: string;
}

export interface OverdeckKeysPlugin {
  ensureKeys(): Promise<DeviceIdentity>;
  getSecret(options: { name: SecretName }): Promise<{ value: string | null }>;
  setSecret(options: { name: SecretName; value: string }): Promise<void>;
  removeSecret(options: { name: SecretName }): Promise<void>;
  /** Deletes the identity, the push key pair and every secret (sign-out). */
  reset(): Promise<void>;
}

export const OverdeckKeys = registerPlugin<OverdeckKeysPlugin>('OverdeckKeys', {
  web: () => import('./keys-web').then((m) => new m.OverdeckKeysWeb()),
});

const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_KEY_RE = /^[0-9a-f]{64}$/;

/** Checks an identity from key storage: a lowercase UUID v4 client id and a 64-hex push key. */
function validateIdentity(identity: DeviceIdentity): DeviceIdentity {
  if (!CLIENT_ID_RE.test(identity.clientId) || !PUBLIC_KEY_RE.test(identity.pushPublicKeyHex)) {
    throw new Error('Key storage returned an invalid identity');
  }
  return { clientId: identity.clientId, pushPublicKeyHex: identity.pushPublicKeyHex };
}

/** The install's identity, created on first call. */
export async function loadIdentity(plugin: OverdeckKeysPlugin = OverdeckKeys): Promise<DeviceIdentity> {
  return validateIdentity(await plugin.ensureKeys());
}
