/**
 * PAN-4949 W-4: connector pairing intents — issue a code whose pairing string
 * names this machine, remember its intent by pairingId, take it once, and
 * keep a lapsed intent long enough that its code never pairs anything else.
 * W-7: the browser, machine and phone exchanges refuse a connector code.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { pairingSecrets } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import { parseConnectorPairLink } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, listAccessTokens } from '../../../lib/access-tokens.js';
import type { ChannelMarker } from '../channel-peer.js';
import { handleConnectorsExchange } from '../routes/connectors.js';
import { handleMachinesExchange } from '../routes/machines-peer.js';
import { pairingRouteLayer } from '../routes/pairing.js';
import { handlePhonesExchange } from '../routes/phones.js';

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
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
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

async function readJson(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

/** `POST /api/pairing/exchange` from a loopback browser, driven through the route layer. */
async function browserExchange(credential: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = HttpServerRequest.fromWeb(new Request('http://localhost/api/pairing/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3011' },
    body: JSON.stringify({ credential, label: 'Browser on test', delivery: 'bearer' }),
  })).modify({ remoteAddress: Option.some('127.0.0.1') });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(pairingRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
  )));
  return readJson(response);
}

describe('other exchanges refuse a connector code (PAN-4949 D-10)', () => {
  const CLIENT_ID = '77777777-7777-4777-8777-777777777777';
  const KEY = 'c4'.repeat(32);

  it('the browser exchange refuses it before consuming it, so the connector still pairs', async () => {
    const { code, pairingId } = await issue();
    const refused = await browserExchange(code);
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('connector-code');
    expect((await listAccessTokens()).filter((record) => (record.kind ?? 'device') === 'device')).toEqual([]);

    const marker: ChannelMarker = { mode: 'pairing', remoteKeyHex: KEY, pairingId };
    const paired = await readJson(await handleConnectorsExchange(JSON.stringify({ v: 1, clientId: CLIENT_ID, label: 'host' }), marker));
    expect(paired.status).toBe(200);
  });

  it('the machine and phone exchanges refuse a connector intent and create no record', async () => {
    const { pairingId } = await issue();
    const marker: ChannelMarker = { mode: 'pairing', remoteKeyHex: KEY, pairingId };
    const machine = await readJson(await handleMachinesExchange('{}', marker));
    expect(machine.status).toBe(403);
    expect(machine.json.code).toBe('connector-code');
    const phone = await readJson(await handlePhonesExchange('{}', marker));
    expect(phone.status).toBe(403);
    expect(phone.json.code).toBe('connector-code');
    expect(await listAccessTokens()).toEqual([]);
  });

  it('a plain code still pairs a browser', async () => {
    const plain = await browserExchange(issuePairingCredential().credential);
    expect(plain.status).toBe(200);
  });
});
