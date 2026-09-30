import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { EFF_LONG_WORDS } from '../../../../src/lib/vault/eff-wordlist.js';
import {
  DEFAULT_KEYWRAP_PARAMS,
  KeywrapFormatError,
  PASSPHRASE_COMMON_MESSAGE,
  PASSPHRASE_LENGTH_MESSAGE,
  checkPassphraseStrength,
  generatePassphrase,
  parseKeywrap,
  unwrapVaultKey,
  wrapVaultKey,
} from '../../../../src/lib/vault/keywrap.js';

// 16 MiB per derivation: the format is the same, only the cost is lower.
const FAST = { N: 2 ** 14, r: 8, p: 1 };
const PASSPHRASE = 'correct  Passphrase for\tthe vault';

function encode(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

async function validWrap(): Promise<Record<string, unknown>> {
  return JSON.parse(Buffer.from(await wrapVaultKey(randomBytes(32), PASSPHRASE, FAST)).toString('utf8'));
}

describe('keywrap', () => {
  it('round-trips the key byte for byte and accepts the normalized passphrase', async () => {
    const key = randomBytes(32);
    const blob = await wrapVaultKey(key, `  ${PASSPHRASE}  `, FAST);
    expect((await unwrapVaultKey(blob, `  ${PASSPHRASE}  `))!.equals(key)).toBe(true);
    expect((await unwrapVaultKey(blob, 'correct Passphrase for the vault'))!.equals(key)).toBe(true);
    // NFKC: a fullwidth letter normalizes to its ASCII form.
    expect((await unwrapVaultKey(blob, 'correct Passphrase for the vaulｔ'))!.equals(key)).toBe(true);
  });

  it('returns null for a wrong passphrase', async () => {
    const blob = await wrapVaultKey(randomBytes(32), PASSPHRASE, FAST);
    expect(await unwrapVaultKey(blob, 'correct passphrase for the vault')).toBeNull();
  });

  it('encodes exactly the eight documented fields with the documented sizes', async () => {
    const parsed = await validWrap();
    expect(Object.keys(parsed).sort()).toEqual(['N', 'ct', 'kdf', 'nonce', 'p', 'r', 'salt', 'v']);
    expect(parsed).toMatchObject({ v: 1, kdf: 'scrypt', N: FAST.N, r: 8, p: 1 });
    expect(Buffer.from(parsed.salt as string, 'base64')).toHaveLength(16);
    expect(Buffer.from(parsed.nonce as string, 'base64')).toHaveLength(12);
    expect(Buffer.from(parsed.ct as string, 'base64')).toHaveLength(48);
  });

  it('uses a fresh salt and nonce for every wrap', async () => {
    const key = randomBytes(32);
    const a = JSON.parse(Buffer.from(await wrapVaultKey(key, PASSPHRASE, FAST)).toString('utf8'));
    const b = JSON.parse(Buffer.from(await wrapVaultKey(key, PASSPHRASE, FAST)).toString('utf8'));
    expect(a.salt).not.toBe(b.salt);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ct).not.toBe(b.ct);
  });

  it('parseKeywrap rejects malformed blobs before any scrypt call', async () => {
    const good = await validWrap();
    expect(parseKeywrap(encode(good))).toMatchObject({ v: 1, kdf: 'scrypt' });
    const bad: Array<Record<string, unknown>> = [
      { ...good, extra: 1 },
      { ...good, v: 2 },
      { ...good, kdf: 'argon2' },
      { ...good, N: 3 },
      { ...good, N: 2 ** 21 },
      { ...good, r: 32 },
      { ...good, salt: randomBytes(15).toString('base64') },
    ];
    for (const value of bad) expect(() => parseKeywrap(encode(value))).toThrow(KeywrapFormatError);
    expect(() => parseKeywrap(Buffer.from('not json'))).toThrow(KeywrapFormatError);
    await expect(unwrapVaultKey(encode({ ...good, N: 2 ** 21 }), PASSPHRASE)).rejects.toBeInstanceOf(KeywrapFormatError);
  });

  it('checkPassphraseStrength refuses short, common and repetitive passphrases', () => {
    expect(checkPassphraseStrength('twelve chars')).toEqual({ ok: false, message: PASSPHRASE_LENGTH_MESSAGE });
    expect(checkPassphraseStrength('Correct Horse Battery Staple')).toEqual({ ok: false, message: PASSPHRASE_COMMON_MESSAGE });
    expect(checkPassphraseStrength('aaaaaaaaaaaaaaaaaaaa')).toEqual({ ok: false, message: PASSPHRASE_COMMON_MESSAGE });
    expect(checkPassphraseStrength('Blue7 kettle Harbor9')).toEqual({ ok: true });
  });

  it('generatePassphrase draws six EFF words that pass the strength check', () => {
    const words = new Set(EFF_LONG_WORDS);
    for (let i = 0; i < 20; i++) {
      const passphrase = generatePassphrase();
      const parts = passphrase.split(' ');
      expect(parts).toHaveLength(6);
      for (const word of parts) expect(words.has(word)).toBe(true);
      expect(checkPassphraseStrength(passphrase)).toEqual({ ok: true });
    }
  });

  it('round-trips at the production parameters (maxmem is set)', async () => {
    const key = randomBytes(32);
    const blob = await wrapVaultKey(key, PASSPHRASE);
    expect(parseKeywrap(blob)).toMatchObject(DEFAULT_KEYWRAP_PARAMS);
    expect((await unwrapVaultKey(blob, PASSPHRASE))!.equals(key)).toBe(true);
  });
});
