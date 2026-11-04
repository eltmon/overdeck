/**
 * Long-term machine key for secure channels (PAN-4645 WI-1, D-4645-1).
 *
 * One X25519 key pair per machine, stored at `${OVERDECK_HOME}/machine-key.json`
 * with mode 0600. Like `environment-identity.ts`, the file is created once
 * (temp file in the same directory, then `link()` so a concurrent creator loses
 * instead of overwriting) and never rewritten. A corrupt file is never replaced:
 * every machine that pinned this key would lose its link, so reads fail loudly
 * naming the file and recovery is an explicit operator action.
 *
 * Every key in this module is encoded as 64 lowercase hex characters. The public
 * half goes in the environment descriptor (`GET /api/environment`); the secret
 * half never leaves this file.
 *
 * Imports only Node built-ins, `../paths.js` and the `noise-handshake/dh`
 * module (X25519 via libsodium), so a standalone CLI can load it without the
 * dashboard or Effect runtime layers.
 */
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';

export const MACHINE_KEY_FILENAME = 'machine-key.json';

/** 64 lowercase hex characters: a raw 32-byte key. */
const KEY_HEX = /^[0-9a-f]{64}$/;
const KEY_BYTES = 32;

export interface MachineKeyFile {
  v: 1;
  /** X25519 public key, 64 lowercase hex. */
  publicKey: string;
  /** X25519 secret key, 64 lowercase hex. Never leaves the file. */
  secretKey: string;
  /** ISO-8601 UTC timestamp of creation. */
  createdAt: string;
}

export interface MachineKeyPair {
  publicKey: Buffer;
  secretKey: Buffer;
}

interface NoiseDhModule {
  generateKeyPair(): { publicKey: Buffer; secretKey: Buffer };
}

const _require = createRequire(import.meta.url);

function loadDh(): NoiseDhModule {
  return _require('noise-handshake/dh') as NoiseDhModule;
}

/** Absolute path of the machine key file under the current OVERDECK_HOME. */
export function machineKeyPath(): string {
  return join(getOverdeckHome(), MACHINE_KEY_FILENAME);
}

function isMachineKeyFile(value: unknown): value is MachineKeyFile {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === 1 &&
    typeof record.publicKey === 'string' &&
    KEY_HEX.test(record.publicKey) &&
    typeof record.secretKey === 'string' &&
    KEY_HEX.test(record.secretKey) &&
    typeof record.createdAt === 'string'
  );
}

function toPair(file: MachineKeyFile): MachineKeyPair {
  return {
    publicKey: Buffer.from(file.publicKey, 'hex'),
    secretKey: Buffer.from(file.secretKey, 'hex'),
  };
}

/** The 64-lowercase-hex form of a raw 32-byte key. */
export function publicKeyHex(key: Buffer | Uint8Array | MachineKeyPair): string {
  const raw = key instanceof Uint8Array ? key : key.publicKey;
  if (raw.length !== KEY_BYTES) {
    throw new Error(`Machine key must be ${KEY_BYTES} bytes, got ${raw.length}`);
  }
  return Buffer.from(raw).toString('hex');
}

function rawKey(key: Buffer | Uint8Array | string): Buffer {
  if (typeof key === 'string') {
    if (!KEY_HEX.test(key)) {
      throw new Error('Machine key must be 64 lowercase hex characters');
    }
    return Buffer.from(key, 'hex');
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`Machine key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return Buffer.from(key);
}

/**
 * Human-checkable fingerprint of a machine public key: the first 10 bytes of
 * SHA-256 over the raw 32-byte key, as five dash-separated groups of four
 * lowercase hex characters (`1a2b-3c4d-5e6f-7a8b-9c0d`).
 */
export function machineKeyFingerprint(publicKey: Buffer | Uint8Array | string): string {
  const digest = createHash('sha256').update(rawKey(publicKey)).digest('hex').slice(0, 20);
  return [0, 4, 8, 12, 16].map((offset) => digest.slice(offset, offset + 4)).join('-');
}

/**
 * Read the machine key. Returns `null` when the file does not exist.
 * Throws an Error naming the file path when it exists but is unreadable,
 * unparseable, or has the wrong shape. Never writes.
 */
export async function readMachineKey(): Promise<MachineKeyPair | null> {
  const path = machineKeyPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read machine key file ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Machine key file ${path} is not valid JSON: ${(error as Error).message}. ` +
        'It is never replaced automatically; recovery is an explicit operator action.',
    );
  }
  if (!isMachineKeyFile(parsed)) {
    throw new Error(
      `Machine key file ${path} has an unexpected shape. ` +
        'It is never replaced automatically; recovery is an explicit operator action.',
    );
  }
  return toPair(parsed);
}

/**
 * Read the machine key, creating it when absent. A corrupt existing file
 * propagates the read error; nothing is re-minted. Two concurrent callers
 * on an empty home both return the key that won the `link()` race.
 */
export async function ensureMachineKey(): Promise<MachineKeyPair> {
  const existing = await readMachineKey();
  if (existing) return existing;

  const generated = loadDh().generateKeyPair();
  const file: MachineKeyFile = {
    v: 1,
    publicKey: publicKeyHex(generated.publicKey),
    secretKey: Buffer.from(generated.secretKey).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  const home = getOverdeckHome();
  const target = join(home, MACHINE_KEY_FILENAME);
  const temp = join(home, `${MACHINE_KEY_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(home, { recursive: true });
  try {
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    // link() fails with EEXIST when another process minted the key between
    // our read and now; rename() would silently replace it.
    await link(temp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await unlink(temp).catch(() => undefined);
      const raced = await readMachineKey();
      if (raced) return raced;
    }
    await unlink(temp).catch(() => undefined);
    throw error;
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return toPair(file);
}
