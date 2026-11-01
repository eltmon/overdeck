/**
 * PAN-4645 WI-15 (D-4645-12): require_token_mint is on whenever any remote
 * access exists, whatever the YAML says; the YAML value is reported separately.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, MACHINE_TOKEN_SCOPES, revokeAccessToken } from '../../access-tokens.js';
import { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, markLinkRevoked, upsertLink } from '../../anywhere/link-store.js';
import { invalidateRemoteAccessConfig, readRemoteAccessConfig } from '../config.js';
import { addSavedTrustedOrigin } from '../trusted-origins.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function writeYaml(body: string): Promise<void> {
  await writeFile(join(home, 'config.yaml'), body, 'utf8');
  invalidateRemoteAccessConfig();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-auto-mint-'));
  process.env.OVERDECK_HOME = home;
  invalidateRemoteAccessConfig();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  await _settleLinkStoreWritesForTests();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  invalidateRemoteAccessConfig();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('require_token_mint turns itself on (PAN-4645 WI-15)', () => {
  it('ac2: with nothing remote and the key unset it is off', () => {
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: false, configured: false, autoReasons: [] });
  });

  it('ac1: one active machine link turns it on with reason machine-link; revoking the link turns it off again', async () => {
    const { link } = await upsertLink({
      environmentId: 'env-peer', label: 'peer', machineKey: 'a1'.repeat(32), token: `odk_${'9'.repeat(64)}`, access: 'operator', routes: [],
    });
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: true, configured: false, autoReasons: ['machine-link'] });
    await markLinkRevoked(link.id);
    expect(readRemoteAccessConfig().requireTokenMint).toBe(false);
  });

  it('an inbound machine token (another machine links here) counts as a machine link', async () => {
    const { record } = await createAccessToken({
      name: 'machine:peer', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
      machineKey: 'b2'.repeat(32), environmentId: 'env-peer', access: 'operator',
    });
    expect(readRemoteAccessConfig().autoReasons).toEqual(['machine-link']);
    await revokeAccessToken(record.id);
    expect(readRemoteAccessConfig().requireTokenMint).toBe(false);
  });

  it('ac3: YAML false plus an active paired device stays on, while configured reports false', async () => {
    await writeYaml('dashboard:\n  require_token_mint: false\n');
    const { record } = await createAccessToken({ name: 'phone', kind: 'device', scopes: ['admin'] });
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: true, configured: false, autoReasons: ['paired-device'] });
    await revokeAccessToken(record.id);
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: false, configured: false, autoReasons: [] });
  });

  it('a saved non-loopback trusted address turns it on after the cache is invalidated; YAML true needs no reason', async () => {
    expect(readRemoteAccessConfig().autoReasons).toEqual([]); // primes the cached facts
    const added = await addSavedTrustedOrigin('https://desk.tail1234.ts.net', []);
    expect(added.ok).toBe(true);
    expect(readRemoteAccessConfig().autoReasons).toEqual([]); // still the cached facts until invalidated
    invalidateRemoteAccessConfig();
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: true, configured: false, autoReasons: ['trusted-address'] });

    await writeYaml('dashboard:\n  require_token_mint: true\n');
    expect(readRemoteAccessConfig()).toMatchObject({ requireTokenMint: true, configured: true });
  });

  it('a non-remote trusted address (localhost) widens nothing', async () => {
    await writeFile(join(home, 'trusted-origins.json'), JSON.stringify({ v: 1, origins: ['http://localhost:3011'] }), 'utf8');
    invalidateRemoteAccessConfig();
    expect(readRemoteAccessConfig().autoReasons).toEqual([]);
  });
});
