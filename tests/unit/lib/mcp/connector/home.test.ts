import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateStaticKeyPair } from '@overdeck/anywhere-channel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectorHome,
  ensureIdentity,
  ensureLocalToken,
  readIdentity,
  readLocalToken,
  readPairing,
  removeConnectorFiles,
  replaceLinkKey,
  writeAccount,
  writePairing,
  type ConnectorPairing,
} from '../../../../../src/lib/mcp/connector/home.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PAIRING: ConnectorPairing = {
  v: 1,
  environmentId: 'env-1',
  machineKeyHex: 'a'.repeat(64),
  machineLabel: 'studio',
  token: `odk_${'b'.repeat(64)}`,
  tokenId: 'tok-1',
  scopes: ['read:state'],
  pairedAt: '2026-11-04T00:00:00.000Z',
};

let root: string;
let home: string;
let savedHome: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'connector-home-'));
  home = join(root, 'connector');
  savedHome = process.env.HOME;
  process.env.HOME = join(root, 'fake-user');
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  await rm(root, { recursive: true, force: true });
});

const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

describe('connectorHome', () => {
  it('uses OVERDECK_CONNECTOR_HOME when set', () => {
    expect(connectorHome({ OVERDECK_CONNECTOR_HOME: '/srv/bot/connector' })).toBe('/srv/bot/connector');
  });

  it('defaults to ~/.overdeck-connector', () => {
    // beforeEach points HOME at a temp dir, and connectorHome follows HOME.
    const expected = join(root, 'fake-user', '.overdeck-connector');
    expect(connectorHome({})).toBe(expected);
    expect(connectorHome({ OVERDECK_CONNECTOR_HOME: '  ' })).toBe(expected);
  });
});

describe('files and modes', () => {
  it('creates the home 0700 and identity.json and local-token 0600', async () => {
    await ensureIdentity(home);
    await ensureLocalToken(home);
    expect(await modeOf(home)).toBe(0o700);
    expect(await modeOf(join(home, 'identity.json'))).toBe(0o600);
    expect(await modeOf(join(home, 'local-token'))).toBe(0o600);
    expect((await readdir(home)).sort()).toEqual(['identity.json', 'local-token']);
  });

  it('writes account.json and pairing.json 0600', async () => {
    await writeAccount(home, {
      v: 1,
      baseUrl: 'https://account.overdeck.ai',
      directoryUrl: 'https://connect.overdeck.ai',
      accessToken: `odd_${'c'.repeat(64)}`,
      deviceId: 'dev-1',
      label: 'bot box',
      githubLogin: null,
      signedInAt: '2026-11-04T00:00:00.000Z',
    });
    await writePairing(home, PAIRING);
    expect(await modeOf(join(home, 'account.json'))).toBe(0o600);
    expect(await modeOf(join(home, 'pairing.json'))).toBe(0o600);
    expect(await readPairing(home)).toEqual(PAIRING);
  });

  it('refuses a group-readable file with the chmod message', async () => {
    await writePairing(home, PAIRING);
    await chmod(join(home, 'pairing.json'), 0o644);
    await expect(readPairing(home)).rejects.toThrow('chmod 600');
  });

  it('refuses malformed pairing.json with the logout message', async () => {
    await writePairing(home, PAIRING);
    await writeFile(join(home, 'pairing.json'), '{not json', { mode: 0o600 });
    await expect(readPairing(home)).rejects.toThrow('pan mcp connector logout');
    await writeFile(join(home, 'pairing.json'), JSON.stringify({ ...PAIRING, scopes: 'read:state' }), { mode: 0o600 });
    await expect(readPairing(home)).rejects.toThrow('pan mcp connector logout');
  });

  it('returns null for absent records', async () => {
    expect(await readPairing(home)).toBeNull();
    expect(await readIdentity(home)).toBeNull();
    expect(await readLocalToken(home)).toBeNull();
  });
});

describe('identity', () => {
  it('is stable across calls and has a UUID v4 clientId and hex keys', async () => {
    const first = await ensureIdentity(home);
    const second = await ensureIdentity(home);
    expect(second).toEqual(first);
    expect(first.clientId).toMatch(UUID_V4);
    for (const key of [first.linkPublicKey, first.linkSecretKey, first.installPublicKey, first.installSecretKey]) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(first.linkPublicKey).not.toBe(first.installPublicKey);
  });

  it('replaceLinkKey swaps only the link key', async () => {
    const identity = await ensureIdentity(home);
    const pair = generateStaticKeyPair();
    const next = await replaceLinkKey(home, identity, pair);
    expect(next.linkPublicKey).toBe(Buffer.from(pair.publicKey).toString('hex'));
    expect(next.clientId).toBe(identity.clientId);
    expect(next.installPublicKey).toBe(identity.installPublicKey);
    expect(await readIdentity(home)).toEqual(next);
  });
});

describe('local token', () => {
  it('returns the same value on every call', async () => {
    const first = await ensureLocalToken(home);
    expect(first).toMatch(/^odl_[0-9a-f]{64}$/);
    expect(await ensureLocalToken(home)).toBe(first);
    expect(await readLocalToken(home)).toBe(first);
  });

  it('replaces a malformed file', async () => {
    await ensureLocalToken(home);
    await writeFile(join(home, 'local-token'), 'odl_short', { mode: 0o600 });
    const token = await ensureLocalToken(home);
    expect(token).toMatch(/^odl_[0-9a-f]{64}$/);
    expect(await readLocalToken(home)).toBe(token);
  });
});

describe('removeConnectorFiles', () => {
  it('removes all four files and tolerates an empty home', async () => {
    await ensureIdentity(home);
    await ensureLocalToken(home);
    await writePairing(home, PAIRING);
    await writeAccount(home, {
      v: 1,
      baseUrl: 'https://account.overdeck.ai',
      directoryUrl: 'https://connect.overdeck.ai',
      accessToken: `odd_${'c'.repeat(64)}`,
      deviceId: 'dev-1',
      label: 'bot box',
      githubLogin: 'octo',
      signedInAt: '2026-11-04T00:00:00.000Z',
    });
    await removeConnectorFiles(home);
    expect(await readdir(home)).toEqual([]);
    await expect(removeConnectorFiles(home)).resolves.toBeUndefined();
  });
});

it('never touches ~/.overdeck', async () => {
  await ensureIdentity(home);
  await ensureLocalToken(home);
  await writePairing(home, PAIRING);
  await removeConnectorFiles(home);
  expect(existsSync(join(root, 'fake-user', '.overdeck'))).toBe(false);
});
