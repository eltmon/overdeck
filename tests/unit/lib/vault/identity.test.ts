import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BIP39_ENGLISH_WORDS } from '../../../../src/lib/vault/bip39-english.js';
import {
  createVaultKey,
  deriveSubkeys,
  keyToPhrase,
  loadVaultKey,
  phraseToKey,
  saveVaultKey,
  vaultKeyPath,
} from '../../../../src/lib/vault/identity.js';

describe('vault identity: recovery phrase', () => {
  it('wordlist has 2048 distinct lowercase words in canonical order', () => {
    expect(BIP39_ENGLISH_WORDS).toHaveLength(2048);
    expect(new Set(BIP39_ENGLISH_WORDS).size).toBe(2048);
    expect(BIP39_ENGLISH_WORDS[0]).toBe('abandon');
    expect(BIP39_ENGLISH_WORDS[2047]).toBe('zoo');
    expect(BIP39_ENGLISH_WORDS.every((word) => /^[a-z]+$/.test(word))).toBe(true);
  });

  it('ac1: 32 zero bytes encode to "abandon" x23 + "art"', () => {
    const phrase = keyToPhrase(Buffer.alloc(32, 0));
    expect(phrase).toBe(`${Array(23).fill('abandon').join(' ')} art`);
  });

  it('ac2: 32 bytes of 0x7f encode to the standard vector ending in "title"', () => {
    const base = 'legal winner thank year wave sausage worth useful';
    const expected = `${base} ${base} ${base}`.split(' ');
    expected[23] = 'title';
    expect(keyToPhrase(Buffer.alloc(32, 0x7f))).toBe(expected.join(' '));
  });

  it('ac3: phraseToKey(keyToPhrase(key)) round-trips a random key byte for byte', () => {
    for (let i = 0; i < 20; i++) {
      const key = createVaultKey();
      expect(key).toHaveLength(32);
      const phrase = keyToPhrase(key);
      expect(phrase.split(' ')).toHaveLength(24);
      expect(phraseToKey(phrase).equals(key)).toBe(true);
    }
  });

  it('ac4: a changed word fails the checksum naming the word position', () => {
    const words = keyToPhrase(Buffer.alloc(32, 0)).split(' ');
    words[4] = 'zoo';
    expect(() => phraseToKey(words.join(' '))).toThrow(/word 24/);
  });

  it('ac4: an unknown word is rejected naming its position', () => {
    const words = keyToPhrase(createVaultKey()).split(' ');
    words[6] = 'notaword';
    expect(() => phraseToKey(words.join(' '))).toThrow(/word 7 \("notaword"\)/);
    expect(() => phraseToKey('abandon abandon')).toThrow(/24 words, got 2/);
  });

  it('accepts extra whitespace and uppercase input', () => {
    const key = createVaultKey();
    const phrase = keyToPhrase(key);
    expect(phraseToKey(`  ${phrase.toUpperCase().replace(/ /g, '   ')}\n`).equals(key)).toBe(true);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => keyToPhrase(Buffer.alloc(16))).toThrow(/32 bytes, got 16/);
    expect(() => deriveSubkeys(Buffer.alloc(31))).toThrow(/32 bytes, got 31/);
  });
});

describe('vault identity: sub-keys', () => {
  it('derives three distinct deterministic 32-byte sub-keys', () => {
    const key = createVaultKey();
    const a = deriveSubkeys(key);
    const b = deriveSubkeys(key);
    for (const name of ['K_enc', 'K_id', 'K_ref'] as const) {
      expect(a[name]).toHaveLength(32);
      expect(a[name].equals(b[name])).toBe(true);
    }
    expect(a.K_enc.equals(a.K_id)).toBe(false);
    expect(a.K_enc.equals(a.K_ref)).toBe(false);
    expect(a.K_id.equals(a.K_ref)).toBe(false);
    expect(deriveSubkeys(createVaultKey()).K_enc.equals(a.K_enc)).toBe(false);
  });
});

describe('vault identity: key file', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-identity-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('ac5: saveVaultKey persists raw bytes with mode 0600 and loadVaultKey reads them back', async () => {
    expect(await loadVaultKey()).toBeNull();
    const key = createVaultKey();
    const path = await saveVaultKey(key);
    expect(path).toBe(vaultKeyPath());
    expect(path).toBe(join(root, '.overdeck', 'vault', 'key'));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path).equals(key)).toBe(true);
    expect(readdirSync(join(root, '.overdeck', 'vault'))).toEqual(['key']);
    expect((await loadVaultKey())!.equals(key)).toBe(true);
  });

  it('loadVaultKey rejects a wrong-length key file naming the path', async () => {
    mkdirSync(join(root, '.overdeck', 'vault'), { recursive: true });
    writeFileSync(vaultKeyPath(), Buffer.alloc(5));
    await expect(loadVaultKey()).rejects.toThrow(vaultKeyPath());
  });
});
