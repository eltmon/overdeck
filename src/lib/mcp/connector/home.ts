/**
 * The Overdeck connector's home directory (PAN-4927 W-CONN2, PAN-4950 FR-1, NFR-1).
 *
 * All connector state lives in `$OVERDECK_CONNECTOR_HOME` (default
 * `~/.overdeck-connector`), mode 0700, in four files, each mode 0600 and written
 * atomically (temp file in the same directory, then rename):
 *
 *  - `account.json`: the overdeck.ai device token and both service URLs.
 *  - `identity.json`: the directory `clientId` plus the link and install X25519
 *    key pairs (64 lowercase hex each).
 *  - `pairing.json`: the paired machine and the `odk_` connector token.
 *  - `local-token`: the `odl_` bearer a bot sends to the loopback endpoint.
 *
 * Readers return `null` for an absent file and throw for a malformed file or one
 * that group or other users may read, so a leaked or corrupt secret is never
 * used silently. This module never reads or writes `~/.overdeck` (OVERDECK_HOME):
 * the connector can run on an Overdeck machine without touching its sign-in,
 * keys or config. Async fs only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { generateStaticKeyPair, type StaticKeyPair } from '@overdeck/anywhere-channel';

export const CONNECTOR_HOME_ENV = 'OVERDECK_CONNECTOR_HOME';
export const DEFAULT_CONNECTOR_PORT = 7466;
export const LOCAL_TOKEN_RE = /^odl_[0-9a-f]{64}$/;

export const ACCOUNT_FILE = 'account.json';
export const IDENTITY_FILE = 'identity.json';
export const PAIRING_FILE = 'pairing.json';
export const LOCAL_TOKEN_FILE = 'local-token';

const KEY_HEX = /^[0-9a-f]{64}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ConnectorAccount {
  v: 1;
  baseUrl: string;
  directoryUrl: string;
  accessToken: string;
  deviceId: string;
  label: string;
  githubLogin: string | null;
  signedInAt: string;
}

/** Keys are 64 lowercase hex characters. */
export interface ConnectorIdentity {
  v: 1;
  clientId: string;
  linkPublicKey: string;
  linkSecretKey: string;
  installPublicKey: string;
  installSecretKey: string;
}

export interface ConnectorPairing {
  v: 1;
  environmentId: string;
  machineKeyHex: string;
  machineLabel: string;
  token: string;
  tokenId: string;
  scopes: string[];
  pairedAt: string;
}

/** The connector home: `$OVERDECK_CONNECTOR_HOME`, else `~/.overdeck-connector`. */
export function connectorHome(env: NodeJS.ProcessEnv = process.env): string {
  return env[CONNECTOR_HOME_ENV]?.trim() || join(homedir(), '.overdeck-connector');
}

export async function ensureHome(home: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
}

export async function writeSecretFile(home: string, name: string, text: string): Promise<void> {
  await ensureHome(home);
  const target = join(home, name);
  const temp = join(home, `${name}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** The file's text, or `null` when it is absent. Throws when group or other users may access it. */
async function readSecretFile(home: string, name: string): Promise<string | null> {
  const path = join(home, name);
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const { mode } = await handle.stat();
    if ((mode & 0o077) !== 0) throw new Error(`${name} must be mode 0600: chmod 600 ${path}`);
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function malformed(name: string, home: string): Error {
  return new Error(`${name} in ${home} is malformed; run pan mcp connector logout and start again`);
}

async function readRecord<T>(home: string, name: string, isValid: (value: unknown) => value is T): Promise<T | null> {
  const text = await readSecretFile(home, name);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw malformed(name, home);
  }
  if (!isValid(value)) throw malformed(name, home);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isConnectorAccount(value: unknown): value is ConnectorAccount {
  return (
    isObject(value) &&
    value.v === 1 &&
    isNonEmptyString(value.baseUrl) &&
    isNonEmptyString(value.directoryUrl) &&
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.deviceId) &&
    typeof value.label === 'string' &&
    (value.githubLogin === null || typeof value.githubLogin === 'string') &&
    typeof value.signedInAt === 'string'
  );
}

function isConnectorIdentity(value: unknown): value is ConnectorIdentity {
  return (
    isObject(value) &&
    value.v === 1 &&
    typeof value.clientId === 'string' &&
    UUID_V4_RE.test(value.clientId) &&
    [value.linkPublicKey, value.linkSecretKey, value.installPublicKey, value.installSecretKey].every(
      (key) => typeof key === 'string' && KEY_HEX.test(key),
    )
  );
}

function isConnectorPairing(value: unknown): value is ConnectorPairing {
  return (
    isObject(value) &&
    value.v === 1 &&
    isNonEmptyString(value.environmentId) &&
    typeof value.machineKeyHex === 'string' &&
    KEY_HEX.test(value.machineKeyHex) &&
    typeof value.machineLabel === 'string' &&
    isNonEmptyString(value.token) &&
    isNonEmptyString(value.tokenId) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === 'string') &&
    typeof value.pairedAt === 'string'
  );
}

export function readAccount(home: string): Promise<ConnectorAccount | null> {
  return readRecord(home, ACCOUNT_FILE, isConnectorAccount);
}

export function readIdentity(home: string): Promise<ConnectorIdentity | null> {
  return readRecord(home, IDENTITY_FILE, isConnectorIdentity);
}

export function readPairing(home: string): Promise<ConnectorPairing | null> {
  return readRecord(home, PAIRING_FILE, isConnectorPairing);
}

function writeRecord(home: string, name: string, record: object): Promise<void> {
  return writeSecretFile(home, name, `${JSON.stringify(record, null, 2)}\n`);
}

export function writeAccount(home: string, account: ConnectorAccount): Promise<void> {
  return writeRecord(home, ACCOUNT_FILE, account);
}

export function writePairing(home: string, pairing: ConnectorPairing): Promise<void> {
  return writeRecord(home, PAIRING_FILE, pairing);
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** The home's identity, created (new `clientId`, link and install key pairs) when absent. */
export async function ensureIdentity(home: string): Promise<ConnectorIdentity> {
  const existing = await readIdentity(home);
  if (existing) return existing;
  const link = generateStaticKeyPair();
  const install = generateStaticKeyPair();
  const identity: ConnectorIdentity = {
    v: 1,
    clientId: randomUUID(),
    linkPublicKey: hex(link.publicKey),
    linkSecretKey: hex(link.secretKey),
    installPublicKey: hex(install.publicKey),
    installSecretKey: hex(install.secretKey),
  };
  await writeRecord(home, IDENTITY_FILE, identity);
  return identity;
}

/** Writes and returns `identity` with `pair` as its link key; `clientId` and the install key stay. */
export async function replaceLinkKey(home: string, identity: ConnectorIdentity, pair: StaticKeyPair): Promise<ConnectorIdentity> {
  const next: ConnectorIdentity = { ...identity, linkPublicKey: hex(pair.publicKey), linkSecretKey: hex(pair.secretKey) };
  await writeRecord(home, IDENTITY_FILE, next);
  return next;
}

/** The local token, or `null` when the file is absent or does not hold an `odl_` token. */
export async function readLocalToken(home: string): Promise<string | null> {
  const text = await readSecretFile(home, LOCAL_TOKEN_FILE);
  const token = text?.trim() ?? null;
  return token !== null && LOCAL_TOKEN_RE.test(token) ? token : null;
}

/** The existing local token when valid; otherwise a new one, written to `local-token`. */
export async function ensureLocalToken(home: string): Promise<string> {
  const existing = await readLocalToken(home);
  if (existing) return existing;
  const token = `odl_${randomBytes(32).toString('hex')}`;
  await writeSecretFile(home, LOCAL_TOKEN_FILE, token);
  return token;
}

/** Deletes the four connector files; absent files are fine. The directory stays. */
export async function removeConnectorFiles(home: string): Promise<void> {
  for (const name of [PAIRING_FILE, LOCAL_TOKEN_FILE, IDENTITY_FILE, ACCOUNT_FILE]) {
    await unlink(join(home, name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
