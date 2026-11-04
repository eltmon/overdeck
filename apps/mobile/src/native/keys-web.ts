/**
 * Browser stand-in for `OverdeckKeys`, for development in a desktop browser only. It keeps the
 * identity and secrets in `localStorage`, which is not secret storage; the native plugins replace
 * it on iOS and Android.
 */
import { WebPlugin } from '@capacitor/core';
import { generateStaticKeyPair } from '@overdeck/anywhere-channel';

import type { DeviceIdentity, OverdeckKeysPlugin, SecretName } from './keys';

const IDENTITY_KEY = 'overdeck.dev.identity';
const SECRET_PREFIX = 'overdeck.dev.secret.';
const SECRET_NAMES: readonly SecretName[] = ['account', 'machines'];

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export class OverdeckKeysWeb extends WebPlugin implements OverdeckKeysPlugin {
  async ensureKeys(): Promise<DeviceIdentity> {
    const stored = localStorage.getItem(IDENTITY_KEY);
    if (stored !== null) return JSON.parse(stored) as DeviceIdentity;
    // Only the public half is kept: the push secret key has no use in a browser.
    const identity: DeviceIdentity = {
      clientId: crypto.randomUUID(),
      pushPublicKeyHex: toHex(generateStaticKeyPair().publicKey),
    };
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  }

  async getSecret({ name }: { name: SecretName }): Promise<{ value: string | null }> {
    return { value: localStorage.getItem(SECRET_PREFIX + name) };
  }

  async setSecret({ name, value }: { name: SecretName; value: string }): Promise<void> {
    localStorage.setItem(SECRET_PREFIX + name, value);
  }

  async removeSecret({ name }: { name: SecretName }): Promise<void> {
    localStorage.removeItem(SECRET_PREFIX + name);
  }

  async reset(): Promise<void> {
    localStorage.removeItem(IDENTITY_KEY);
    for (const name of SECRET_NAMES) localStorage.removeItem(SECRET_PREFIX + name);
  }

  async pushEnvironment() {
    return { apsEnvironment: 'sandbox' as const };
  }
}
