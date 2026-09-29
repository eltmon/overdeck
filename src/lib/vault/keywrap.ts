/**
 * Session Vault passphrase unlock (PAN-4328, anywhere-accounts design 6.5).
 *
 * The vault key `K` is wrapped under a human passphrase and stored on the
 * backend as the reserved slot `keywrap/v1`, so a new machine can join by
 * typing the passphrase instead of the 24-word recovery phrase. The encoding
 * is UTF-8 JSON with exactly eight keys:
 *
 *     {"v":1,"kdf":"scrypt","N":131072,"r":8,"p":1,"salt":"<b64 16>","nonce":"<b64 12>","ct":"<b64 48>"}
 *
 * - KEK = scrypt(normalize(passphrase), salt, 32, {N, r, p, maxmem: 256 MiB}).
 * - ct = AES-256-GCM(KEK, nonce, K, aad "overdeck-vault-keywrap-v1") || tag.
 * - The blob is validated before any scrypt call, so a malicious backend
 *   cannot make the client allocate more than 256 MiB.
 *
 * The backend only ever sees the GCM ciphertext; `K`, the KEK and the
 * passphrase never leave the machine. `node:crypto` only, async scrypt (never
 * `scryptSync`). Imports only Node built-ins and sibling vault modules.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomInt, scrypt, type ScryptOptions } from 'node:crypto';
import { EFF_LONG_WORDS } from './eff-wordlist.js';

export const KEYWRAP_AAD = 'overdeck-vault-keywrap-v1';
export const KEYWRAP_MAXMEM = 256 * 1024 * 1024;
export const DEFAULT_KEYWRAP_PARAMS = { N: 131072, r: 8, p: 1 } as const;
export const PASSPHRASE_MIN_LENGTH = 16;
export const GENERATED_PASSPHRASE_WORDS = 6;

export const PASSPHRASE_LENGTH_MESSAGE = 'A vault passphrase must be at least 16 characters.';
export const PASSPHRASE_COMMON_MESSAGE = 'That passphrase is too common or repetitive. Choose another, or use a generated one.';
export const PASSPHRASE_MISMATCH_MESSAGE = 'The passphrase did not unlock this vault.';
export const KEYWRAP_UNREADABLE_MESSAGE = 'The passphrase unlock object on this backend is unreadable; use the recovery phrase.';
export const PASSPHRASE_LATER_HINT = 'Tip: run pan vault passphrase set to unlock new machines with a passphrase instead of the 24 words.';

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEYWRAP_KEYS = ['N', 'ct', 'kdf', 'nonce', 'p', 'r', 'salt', 'v'];
const MIN_DISTINCT_CHARACTERS = 6;

/** Compared after lowercasing and dropping every character outside [a-z0-9]. */
const PASSPHRASE_BLOCKLIST: ReadonlySet<string> = new Set([
  'correcthorsebatterystaple',
  'passwordpassword',
  'password12345678',
  'password123456789',
  '1234567890123456',
  '12345678901234567890',
  'qwertyuiopasdfgh',
  'qwertyuiopasdfghjkl',
  'abcdefghijklmnop',
  'abcdefghijklmnopqrstuvwxyz',
  'iloveyouiloveyou',
  'letmeinletmein',
  'trustno1trustno1',
  'thequickbrownfoxjumpsoverthelazydog',
  'changemechangeme',
  'overdeckoverdeck',
  'overdecksessionvault',
  'myvaultpassphrase',
  'thisismypassphrase',
  'sessionvaultpassphrase',
]);

export interface KeywrapParams {
  N: number;
  r: number;
  p: number;
}

export interface Keywrap {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
  ct: string;
}

/** The `keywrap/v1` bytes are not a valid keywrap; the caller should fall back to the recovery phrase. */
export class KeywrapFormatError extends Error {
  override readonly name = 'KeywrapFormatError';
}

export type StrengthResult = { ok: true } | { ok: false; message: string };

function deriveKek(passphrase: string, salt: Buffer, params: KeywrapParams): Promise<Buffer> {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: KEYWRAP_MAXMEM };
  return new Promise((resolve, reject) => {
    scrypt(normalizePassphrase(passphrase), salt, KEY_BYTES, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/** NFKC, trimmed, every whitespace run collapsed to one space. Wrap, unwrap and the strength check all use it. */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function checkPassphraseStrength(passphrase: string): StrengthResult {
  const normalized = normalizePassphrase(passphrase);
  const characters = [...normalized];
  if (characters.length < PASSPHRASE_MIN_LENGTH) return { ok: false, message: PASSPHRASE_LENGTH_MESSAGE };
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (PASSPHRASE_BLOCKLIST.has(compact) || new Set(characters).size < MIN_DISTINCT_CHARACTERS) {
    return { ok: false, message: PASSPHRASE_COMMON_MESSAGE };
  }
  return { ok: true };
}

/** Six words drawn uniformly from the EFF long wordlist (≈ 77.5 bits), joined by single spaces. */
export function generatePassphrase(): string {
  const words: string[] = [];
  for (let i = 0; i < GENERATED_PASSPHRASE_WORDS; i++) words.push(EFF_LONG_WORDS[randomInt(EFF_LONG_WORDS.length)]!);
  return words.join(' ');
}

function assertParams(params: KeywrapParams): void {
  const { N, r, p } = params;
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    throw new KeywrapFormatError('Keywrap scrypt parameters must be integers');
  }
  if (N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0) {
    throw new KeywrapFormatError(`Keywrap scrypt N must be a power of two in [2^14, 2^20], got ${N}`);
  }
  if (r < 1 || r > 16) throw new KeywrapFormatError(`Keywrap scrypt r must be in [1, 16], got ${r}`);
  if (p < 1 || p > 4) throw new KeywrapFormatError(`Keywrap scrypt p must be in [1, 4], got ${p}`);
  if (128 * N * r * p > KEYWRAP_MAXMEM) throw new KeywrapFormatError('Keywrap scrypt parameters exceed the memory limit');
}

function decodeField(value: unknown, field: string, bytes: number): Buffer {
  if (typeof value !== 'string') throw new KeywrapFormatError(`Keywrap ${field} must be a base64 string`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== bytes || decoded.toString('base64') !== value) {
    throw new KeywrapFormatError(`Keywrap ${field} must be ${bytes} base64-encoded bytes`);
  }
  return decoded;
}

/** Validate a `keywrap/v1` blob. Throws KeywrapFormatError; never runs scrypt. */
export function parseKeywrap(bytes: Uint8Array): Keywrap {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new KeywrapFormatError('Keywrap is not JSON', { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new KeywrapFormatError('Keywrap must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== KEYWRAP_KEYS.length || keys.some((key, i) => key !== KEYWRAP_KEYS[i])) {
    throw new KeywrapFormatError(`Keywrap must have exactly the keys ${KEYWRAP_KEYS.join(', ')}`);
  }
  if (record.v !== 1) throw new KeywrapFormatError(`Unsupported keywrap version ${JSON.stringify(record.v)}`);
  if (record.kdf !== 'scrypt') throw new KeywrapFormatError(`Unsupported keywrap kdf ${JSON.stringify(record.kdf)}`);
  const params = { N: record.N, r: record.r, p: record.p } as KeywrapParams;
  assertParams(params);
  decodeField(record.salt, 'salt', SALT_BYTES);
  decodeField(record.nonce, 'nonce', NONCE_BYTES);
  decodeField(record.ct, 'ct', KEY_BYTES + TAG_BYTES);
  return {
    v: 1,
    kdf: 'scrypt',
    ...params,
    salt: record.salt as string,
    nonce: record.nonce as string,
    ct: record.ct as string,
  };
}

/** Wrap the vault key under `passphrase`; returns the encoded `keywrap/v1` bytes. */
export async function wrapVaultKey(
  key: Uint8Array,
  passphrase: string,
  params: KeywrapParams = DEFAULT_KEYWRAP_PARAMS,
): Promise<Uint8Array> {
  if (key.length !== KEY_BYTES) throw new Error(`Vault key must be ${KEY_BYTES} bytes, got ${key.length}`);
  assertParams(params);
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const kek = await deriveKek(passphrase, salt, params);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  cipher.setAAD(Buffer.from(KEYWRAP_AAD, 'utf8'));
  const ct = Buffer.concat([cipher.update(key), cipher.final(), cipher.getAuthTag()]);
  const wrap: Keywrap = {
    v: 1,
    kdf: 'scrypt',
    N: params.N,
    r: params.r,
    p: params.p,
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    ct: ct.toString('base64'),
  };
  return Buffer.from(JSON.stringify(wrap), 'utf8');
}

/**
 * Recover the vault key from `keywrap/v1` bytes. Returns null when the
 * passphrase is wrong (GCM authentication fails locally); throws
 * KeywrapFormatError when the blob itself is malformed.
 */
export async function unwrapVaultKey(bytes: Uint8Array, passphrase: string): Promise<Buffer | null> {
  const wrap = parseKeywrap(bytes);
  const ct = Buffer.from(wrap.ct, 'base64');
  const kek = await deriveKek(passphrase, Buffer.from(wrap.salt, 'base64'), wrap);
  const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(wrap.nonce, 'base64'));
  decipher.setAAD(Buffer.from(KEYWRAP_AAD, 'utf8'));
  decipher.setAuthTag(ct.subarray(KEY_BYTES));
  try {
    return Buffer.concat([decipher.update(ct.subarray(0, KEY_BYTES)), decipher.final()]);
  } catch {
    return null;
  }
}
