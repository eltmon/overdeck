/**
 * PAN-4949 W-4: connector pairing intents — issue a code whose pairing string
 * names this machine, remember its intent by pairingId, take it once, and
 * keep a lapsed intent long enough that its code never pairs anything else.
 * W-7: the browser, machine and phone exchanges refuse a connector code.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  cancelConnectorRequest,
  dismissConnectorNotice,
  hasConnectorIntent,
  isConnectorCode,
  issueConnectorPairing,
  listConnectorNotices,
  listConnectorRequests,
  markConnectorRequestPaired,
  takeConnectorIntent,
} from '../connector-pairing.js';
import {
  _resetPairingCredentialsForTests,
  issuePairingCredential,
  pairingCredentialState,
  revokePairingById,
  takePairingById,
} from '../pairing-credentials.js';
import { buildEnvironmentDescriptor } from '../routes/environment.js';

const MINUTE_MS = 60_000;
const originalHome = process.env.OVERDECK_HOME;
let home: string;

/** Issue a connector pairing and return its raw code, pairingId and requestId. */
async function issue(name = 'bot:desk'): Promise<{ code: string; pairingId: string; requestId: string }> {
  const { pairingString, requestId } = await issueConnectorPairing({ name, scopes: ['read:state', 'tell'] });
  const code = parseConnectorPairLink(pairingString)!.code;
  return { code, pairingId: pairingSecrets(nodeCrypto, code).pairingId, requestId };
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

  it('names this machine by its environment identity label (PAN-5069 FR-8)', async () => {
    const environmentId = '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b';
    await writeFile(join(home, 'environment-id.json'), JSON.stringify({ v: 1, environmentId, label: "Ed's desk", createdAt: '2026-11-05T00:00:00.000Z' }));
    const { pairingString } = await issueConnectorPairing({ name: 'bot:desk', scopes: ['read:state'] });
    expect(parseConnectorPairLink(pairingString)).toMatchObject({ environmentId, machineLabel: "Ed's desk" });
  });

  it('recognizes a connector code and not a plain pairing code', async () => {
    const { code } = await issue();
    expect(isConnectorCode(code)).toBe(true);
    expect(isConnectorCode(issuePairingCredential().credential)).toBe(false);
  });

  it('hands out an intent once and keeps the request', async () => {
    const { pairingId, requestId } = await issue('bot:once');
    expect(takeConnectorIntent(pairingId)).toEqual({ requestId, name: 'bot:once', scopes: ['read:state', 'tell'] });
    expect(takeConnectorIntent(pairingId)).toBeNull();
    expect(hasConnectorIntent(pairingId)).toBe(true);
  });

  it('lists an untaken request as live, then expired 30 min + 1 ms later, then drops it at retention', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const issuedAt = Date.parse('2026-11-04T00:00:00.000Z');
    vi.setSystemTime(new Date(issuedAt));
    const lapsed = await issue();
    expect(listConnectorRequests()).toMatchObject([{ id: lapsed.requestId, state: 'live' }]);

    vi.setSystemTime(new Date(issuedAt + 30 * MINUTE_MS + 1));
    expect(listConnectorRequests()).toMatchObject([{ id: lapsed.requestId, state: 'expired' }]);
    expect(hasConnectorIntent(lapsed.pairingId)).toBe(true);

    vi.setSystemTime(new Date(issuedAt + 30 * MINUTE_MS + 24 * 60 * MINUTE_MS + 1));
    expect(listConnectorRequests()).toEqual([]);
    expect(hasConnectorIntent(lapsed.pairingId)).toBe(false);
  });

  it('lists a taken-but-unpaired request, and one whose code was consumed, as used with no pairing string', async () => {
    const taken = await issue('bot:taken');
    takeConnectorIntent(taken.pairingId);
    const takenView = listConnectorRequests().find((view) => view.id === taken.requestId);
    expect(takenView).toMatchObject({ state: 'used' });
    expect(takenView?.pairingString).toBeUndefined();

    const consumed = await issue('bot:consumed');
    takePairingById(consumed.pairingId);
    const consumedView = listConnectorRequests().find((view) => view.id === consumed.requestId);
    expect(consumedView).toMatchObject({ state: 'used' });
    expect(consumedView?.pairingString).toBeUndefined();
  });

  it('cancelConnectorRequest burns the code and removes the row; a second cancel returns null', async () => {
    const { pairingId, requestId } = await issue('bot:cancel');
    expect(cancelConnectorRequest(requestId)).toEqual({ name: 'bot:cancel' });
    expect(takePairingById(pairingId)).toBe('unknown');
    expect(listConnectorRequests()).toEqual([]);
    expect(cancelConnectorRequest(requestId)).toBeNull();
  });

  it('moves a paired request from requests to notices, dismisses it, and drops it 24 h after pairing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const pairedAt = Date.parse('2026-11-04T00:00:00.000Z');
    vi.setSystemTime(new Date(pairedAt));
    const { pairingId, requestId } = await issue('bot:paired');
    takeConnectorIntent(pairingId);
    markConnectorRequestPaired(requestId, 'connector-1');

    expect(listConnectorRequests()).toEqual([]);
    expect(listConnectorNotices()).toMatchObject([{ id: requestId, connectorId: 'connector-1', name: 'bot:paired' }]);

    expect(dismissConnectorNotice(requestId)).toBe(true);
    expect(listConnectorNotices()).toEqual([]);

    const other = await issue('bot:paired-2');
    takeConnectorIntent(other.pairingId);
    markConnectorRequestPaired(other.requestId, 'connector-2');
    vi.setSystemTime(new Date(pairedAt + 24 * 60 * MINUTE_MS + 1));
    expect(listConnectorNotices()).toEqual([]);
  });

  it('issues a connector pairing whose expiresAt is exactly 30 minutes after issue (PAN-5070 FR-13)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
    const { expiresAt } = await issueConnectorPairing({ name: 'bot:desk', scopes: ['read:state'] });
    expect(Date.parse(expiresAt)).toBe(Date.parse('2026-11-11T00:00:00.000Z') + 30 * MINUTE_MS);
  });

  it('leaves the plain pairing credential at a 10-minute expiry (PAN-5070 FR-25)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
    const { expiresAt } = issuePairingCredential();
    expect(Date.parse(expiresAt)).toBe(Date.parse('2026-11-11T00:00:00.000Z') + 10 * MINUTE_MS);
  });

  it('pairingCredentialState tracks live, expired, then gone without consuming (PAN-5070 FR-25)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T00:00:00.000Z'));
    const { pairingId } = await issue();
    expect(pairingCredentialState(pairingId)).toBe('live');

    vi.setSystemTime(new Date(Date.now() + 30 * MINUTE_MS + 1));
    expect(pairingCredentialState(pairingId)).toBe('expired');

    expect(takePairingById(pairingId)).not.toBe('unknown');
    expect(pairingCredentialState(pairingId)).toBe('gone');
  });

  it('revokePairingById burns a credential once and leaves a second call a no-op (PAN-5070 FR-25)', async () => {
    const { pairingId } = await issue();
    expect(revokePairingById(pairingId)).toBe(true);
    expect(revokePairingById(pairingId)).toBe(false);
    expect(takePairingById(pairingId)).toBe('unknown');
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
    expect((await listAccessTokens()).filter((record) => (record.kind ?? 'device') === 'device')).toHaveLength(1);
  });
});
