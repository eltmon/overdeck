/**
 * PAN-4949 W-4: connector pairing intents — issue a code whose pairing string
 * names this machine, remember its intent by pairingId, take it once, and
 * keep a lapsed intent long enough that its code never pairs anything else.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pairingSecrets } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import { parseConnectorPairLink } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetConnectorPairingForTests,
  hasConnectorIntent,
  isConnectorCode,
  issueConnectorPairing,
  takeConnectorIntent,
} from '../connector-pairing.js';
import { _resetPairingCredentialsForTests, issuePairingCredential } from '../pairing-credentials.js';
import { buildEnvironmentDescriptor } from '../routes/environment.js';

const MINUTE_MS = 60_000;
const originalHome = process.env.OVERDECK_HOME;
let home: string;

/** Issue a connector pairing and return its raw code and pairingId. */
async function issue(name = 'bot:desk'): Promise<{ code: string; pairingId: string }> {
  const { pairingString } = await issueConnectorPairing({ name, scopes: ['read:state', 'tell'] });
  const code = parseConnectorPairLink(pairingString)!.code;
  return { code, pairingId: pairingSecrets(nodeCrypto, code).pairingId };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4949-connector-pairing-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  vi.useRealTimers();
  _resetPairingCredentialsForTests();
  _resetConnectorPairingForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('connector pairing intents (PAN-4949 D-6, D-7)', () => {
  it('returns a pairing string naming this machine environment id and key', async () => {
    const { pairingString, expiresAt } = await issueConnectorPairing({ name: 'bot:desk', scopes: ['read:state'] });
    const parsed = parseConnectorPairLink(pairingString);
    const descriptor = await buildEnvironmentDescriptor();
    expect(parsed).not.toBeNull();
    expect(parsed!.environmentId).toBe(descriptor.environmentId);
    expect(parsed!.machineKeyHex).toBe(descriptor.machineKey);
    expect(Number.isNaN(Date.parse(expiresAt))).toBe(false);
  });

  it('recognizes a connector code and not a plain pairing code', async () => {
    const { code } = await issue();
    expect(isConnectorCode(code)).toBe(true);
    expect(isConnectorCode(issuePairingCredential().credential)).toBe(false);
  });

  it('hands out an intent once and then forgets it', async () => {
    const { pairingId } = await issue('bot:once');
    expect(takeConnectorIntent(pairingId)).toMatchObject({ name: 'bot:once', scopes: ['read:state', 'tell'] });
    expect(takeConnectorIntent(pairingId)).toBeNull();
    expect(hasConnectorIntent(pairingId)).toBe(false);
  });

  it('refuses an expired intent but keeps marking its code until a later issue prunes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'));
    const lapsed = await issue();
    const taken = await issue();

    vi.setSystemTime(new Date(Date.now() + 10 * MINUTE_MS + 1));
    expect(takeConnectorIntent(taken.pairingId)).toBeNull();
    expect(hasConnectorIntent(lapsed.pairingId)).toBe(true);

    vi.setSystemTime(new Date(Date.parse('2026-11-04T00:00:00.000Z') + 20 * MINUTE_MS));
    await issue();
    expect(hasConnectorIntent(lapsed.pairingId)).toBe(true);

    vi.setSystemTime(new Date(Date.now() + 1));
    await issue();
    expect(hasConnectorIntent(lapsed.pairingId)).toBe(false);
  });
});
