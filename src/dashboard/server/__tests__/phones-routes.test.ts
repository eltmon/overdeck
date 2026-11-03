/**
 * PAN-4835 WI-7: POST /api/phones/exchange mints the phone token bound to the
 * pairing channel's remote key, refuses plain sockets and link channels, and
 * revokes a previous active phone record with the same clientId; a key
 * already held by an active phone record gets 409.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  listActiveRecordsOfKind,
  PHONE_TOKEN_SCOPES,
  verifyAccessToken,
} = await import('../../../lib/access-tokens.js');
const { remoteGateRejection } = await import('../remote-request-gate.js');
const { handlePhonesExchange } = await import('../routes/phones.js');
type ChannelMarker = import('../channel-peer.js').ChannelMarker;

const KEY_A = 'a1'.repeat(32);
const PAIRING: ChannelMarker = { mode: 'pairing', remoteKeyHex: KEY_A, pairingId: 'cd'.repeat(16) };
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY_A, pairingId: null };
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, clientId: CLIENT_ID, label: 'iris', pushKeyHex: 'c3'.repeat(32), ...overrides });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4835-phones-routes-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/phones/exchange (PAN-4835 WI-7)', () => {
  it('ac7: mints a phone token bound to the channel key with the eight scopes and the push key', async () => {
    const { status, json } = await read(await handlePhonesExchange(body(), PAIRING));
    expect(status).toBe(200);
    expect(json.v).toBe(1);
    expect(json.token).toMatch(/^odk_/);
    const verified = verifyAccessToken(json.token as string);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.record).toMatchObject({
      id: json.tokenId, kind: 'phone', phoneKey: KEY_A, clientId: CLIENT_ID, pushKey: 'c3'.repeat(32), name: 'iris',
    });
    expect(verified.record.scopes).toEqual([...PHONE_TOKEN_SCOPES]);
    expect((json.descriptor as { capabilities: Record<string, unknown> }).capabilities).toBeTruthy();
  });

  it('ac7: without a pairing channel marker the route answers 403, link channels included; no marker also 403', async () => {
    expect((await read(await handlePhonesExchange(body(), null))).status).toBe(403);
    expect((await read(await handlePhonesExchange(body(), LINK))).status).toBe(403);
    expect(listActiveRecordsOfKind('phone')).toEqual([]);
  });

  it('ac7: rejects a bad clientId, an over-long label and a bad pushKeyHex with 400, minting nothing', async () => {
    expect((await read(await handlePhonesExchange(body({ clientId: 'not-a-uuid' }), PAIRING))).status).toBe(400);
    expect((await read(await handlePhonesExchange(body({ label: 'x'.repeat(65) }), PAIRING))).status).toBe(400);
    expect((await read(await handlePhonesExchange(body({ pushKeyHex: 'nope' }), PAIRING))).status).toBe(400);
    expect((await read(await handlePhonesExchange('not json', PAIRING))).status).toBe(400);
    expect(listActiveRecordsOfKind('phone')).toEqual([]);
  });

  it('ac7: a second exchange with the same clientId and a new key revokes the first; only one active record remains', async () => {
    const first = await read(await handlePhonesExchange(body(), PAIRING));
    expect(first.status).toBe(200);

    const otherKey = 'b2'.repeat(32);
    const second = await read(await handlePhonesExchange(body(), { mode: 'pairing', remoteKeyHex: otherKey, pairingId: 'ef'.repeat(16) }));
    expect(second.status).toBe(200);

    expect(verifyAccessToken(first.json.token as string)).toEqual({ ok: false });
    const active = listActiveRecordsOfKind('phone');
    expect(active.map((record) => record.id)).toEqual([second.json.tokenId]);
    expect(active[0]!.phoneKey).toBe(otherKey);
  });

  it('ac7: an exchange whose channel key already belongs to an active phone record gets 409 and the record stays active', async () => {
    const first = await read(await handlePhonesExchange(body(), PAIRING));
    expect(first.status).toBe(200);

    const repeat = await read(await handlePhonesExchange(body({ clientId: '22222222-2222-4222-8222-222222222222' }), PAIRING));
    expect(repeat.status).toBe(409);
    expect(repeat.json.code).toBe('link-key-in-use');
    expect(verifyAccessToken(first.json.token as string).ok).toBe(true);
    expect(listActiveRecordsOfKind('phone')).toHaveLength(1);
  });

  it('remoteGateRejection admits the exchange on a pairing marker and refuses it on a plain request', async () => {
    const { HttpServerRequest } = await import('effect/unstable/http');
    const { Option } = await import('effect');
    const request = (peer: string | undefined) => HttpServerRequest
      .fromWeb(new Request('http://dashboard.test/api/phones/exchange', { method: 'POST' }))
      .modify({ remoteAddress: peer ? Option.some(peer) : Option.none() });
    expect(remoteGateRejection(request(undefined), PAIRING)).toBeNull();
    expect(remoteGateRejection(request('127.0.0.1'), null)).toEqual({ status: 401 });
  });
});
