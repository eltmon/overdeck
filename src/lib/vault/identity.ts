/**
 * Session Vault key identity (PAN-2609, PRD "Encryption (D-3)" and decision P-2).
 *
 * - Vault key `K`: 32 random bytes, stored raw at `${OVERDECK_HOME}/vault/key` (mode 0600,
 *   atomic temp-file + rename write).
 * - Recovery phrase: the BIP-39 encoding of `K` itself (256 bits of entropy + 8-bit SHA-256
 *   checksum = 264 bits = 24 words of 11 bits). It is an encoding, not a seed derivation, so
 *   `phraseToKey(keyToPhrase(K))` returns `K` byte for byte.
 * - Sub-keys via HKDF-SHA256: `K_enc`, `K_id`, `K_ref`.
 *
 * `node:crypto` only (NFR-9). Imports only Node built-ins and sibling vault modules.
 */
import { createHash, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIP39_ENGLISH_WORDS } from './bip39-english.js';
import { vaultDir } from './config.js';

export const VAULT_KEY_BYTES = 32;
export const VAULT_KEY_FILENAME = 'key';
export const RECOVERY_PHRASE_WORDS = 24;

const WORD_BITS = 11;
const CHECKSUM_BITS = (VAULT_KEY_BYTES * 8) / 32; // 8 bits for 256-bit entropy

export interface VaultSubkeys {
  /** AES-256-GCM object encryption key. */
  K_enc: Buffer;
  /** HMAC key for content-derived chunk ids. */
  K_id: Buffer;
  /** HMAC key for ref names. */
  K_ref: Buffer;
  /** PAN-4333: sub-keys of retired keys, newest first; only chunk and WIP-part decoding reads them. */
  previous?: VaultSubkeys[];
}

export function vaultKeyPath(): string {
  return join(vaultDir(), VAULT_KEY_FILENAME);
}

/** 32 random bytes from `node:crypto`. */
export function createVaultKey(): Buffer {
  return randomBytes(VAULT_KEY_BYTES);
}

function assertKeyLength(key: Uint8Array, what: string): void {
  if (key.length !== VAULT_KEY_BYTES) {
    throw new Error(`${what} must be ${VAULT_KEY_BYTES} bytes, got ${key.length}`);
  }
}

/** Persist the key as raw bytes with mode 0600, atomically. */
export async function saveVaultKey(key: Uint8Array): Promise<string> {
  assertKeyLength(key, 'Vault key');
  const dir = vaultDir();
  const target = vaultKeyPath();
  const temp = join(dir, `${VAULT_KEY_FILENAME}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(temp, key, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return target;
}

/** Load the key; `null` when no key file exists. A wrong-length file throws naming the path. */
export async function loadVaultKey(): Promise<Buffer | null> {
  const path = vaultKeyPath();
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read vault key ${path}: ${(error as Error).message}`);
  }
  if (bytes.length !== VAULT_KEY_BYTES) {
    throw new Error(`Vault key ${path} must be ${VAULT_KEY_BYTES} bytes, got ${bytes.length}`);
  }
  return bytes;
}

function toBits(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits;
}

function checksumBits(entropy: Uint8Array): string {
  const digest = createHash('sha256').update(entropy).digest();
  return toBits(digest).slice(0, CHECKSUM_BITS);
}

/** Encode a 32-byte key as 24 BIP-39 English words (entropy + SHA-256 checksum). */
export function keyToPhrase(key: Uint8Array): string {
  assertKeyLength(key, 'Vault key');
  const bits = toBits(key) + checksumBits(key);
  const words: string[] = [];
  for (let i = 0; i < bits.length; i += WORD_BITS) {
    const index = parseInt(bits.slice(i, i + WORD_BITS), 2);
    words.push(BIP39_ENGLISH_WORDS[index]!);
  }
  return words.join(' ');
}

/**
 * Decode a 24-word phrase back to the 32-byte key. Unknown words and checksum
 * failures throw an Error naming the 1-based word position.
 */
export function phraseToKey(phrase: string): Buffer {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length !== RECOVERY_PHRASE_WORDS) {
    throw new Error(
      `Recovery phrase must have ${RECOVERY_PHRASE_WORDS} words, got ${words.length}`,
    );
  }
  let bits = '';
  words.forEach((word, i) => {
    const index = BIP39_ENGLISH_WORDS.indexOf(word);
    if (index < 0) {
      throw new Error(`Recovery phrase word ${i + 1} ("${word}") is not a BIP-39 word`);
    }
    bits += index.toString(2).padStart(WORD_BITS, '0');
  });
  const entropyBits = bits.slice(0, VAULT_KEY_BYTES * 8);
  const givenChecksum = bits.slice(VAULT_KEY_BYTES * 8);
  const key = Buffer.alloc(VAULT_KEY_BYTES);
  for (let i = 0; i < VAULT_KEY_BYTES; i++) {
    key[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }
  if (checksumBits(key) !== givenChecksum) {
    throw new Error(
      `Recovery phrase checksum does not match: word ${RECOVERY_PHRASE_WORDS} ` +
        `("${words[RECOVERY_PHRASE_WORDS - 1]}") is inconsistent with the other words`,
    );
  }
  return key;
}

const HKDF_INFO = {
  K_enc: 'overdeck-vault enc',
  K_id: 'overdeck-vault id',
  K_ref: 'overdeck-vault ref',
} as const;

/** Derive the three sub-keys from `K` with HKDF-SHA256 (empty salt, fixed info strings). */
export function deriveSubkeys(key: Uint8Array): VaultSubkeys {
  assertKeyLength(key, 'Vault key');
  const derive = (info: string): Buffer =>
    Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), info, VAULT_KEY_BYTES));
  return {
    K_enc: derive(HKDF_INFO.K_enc),
    K_id: derive(HKDF_INFO.K_id),
    K_ref: derive(HKDF_INFO.K_ref),
  };
}
