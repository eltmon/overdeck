import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateRoomResponse, ShareScope } from '@overdeck/contracts';

import {
  createRoom,
  DEFAULT_SHARE_URL,
  deleteRoom,
  hostSocketUrl,
  joinSocketUrl,
  parseShareUrl,
  readShareUrl,
  SHARE_HTTP_TIMEOUT_MS,
  shareOrigin,
} from '../../../../src/lib/sharing/share-service.js';

const originalHome = process.env.OVERDECK_HOME;
let home = '';

const BASE = 'https://share.overdeck.ai';
const DEVICE_TOKEN = `odd_${'a'.repeat(64)}`;
const HOST_TOKEN = `odh_${'b'.repeat(64)}`;
const SCOPE: ShareScope = { kind: 'conversation', conversationId: 'conv-a' };

function room(overrides: Partial<CreateRoomResponse> = {}): CreateRoomResponse {
  const identity = { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1' };
  return {
    shortCode: 'BCDFGHJK',
    hostToken: HOST_TOKEN,
    joinUrl: 'https://share.overdeck.ai/s/BCDFGHJK',
    snapshot: {
      shortCode: 'BCDFGHJK',
      scope: SCOPE,
      dataOwner: identity,
      controllerGithubId: 1,
      hostConnected: false,
      participants: [],
      blocked: [],
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4473-share-url-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('anywhere.share_url', () => {
  it('parseShareUrl defaults, accepts https and loopback http, strips the trailing slash, and rejects the rest', () => {
    expect(parseShareUrl(undefined)).toEqual({ url: DEFAULT_SHARE_URL });
    expect(parseShareUrl('')).toEqual({ url: DEFAULT_SHARE_URL });
    expect(parseShareUrl('https://share.example.org/base/')).toEqual({ url: 'https://share.example.org/base' });
    expect(parseShareUrl('http://127.0.0.1:8787/')).toEqual({ url: 'http://127.0.0.1:8787' });
    expect(parseShareUrl('http://example.com')).toEqual({ error: 'anywhere.share_url must use https:, or http: to a loopback host' });
    expect(parseShareUrl('https://share.example.org/?x=1')).toHaveProperty('error');
    expect(parseShareUrl('https://u:p@share.example.org')).toHaveProperty('error');
    expect(parseShareUrl(42)).toHaveProperty('error');
  });

  it('readShareUrl returns the default without the key and an error for http://example.com (ac5)', async () => {
    expect(await readShareUrl()).toEqual({ url: DEFAULT_SHARE_URL });
    await writeFile(join(home, 'config.yaml'), 'anywhere:\n  directory_url: https://connect.overdeck.ai\n');
    expect(await readShareUrl()).toEqual({ url: DEFAULT_SHARE_URL });
    await writeFile(join(home, 'config.yaml'), 'anywhere:\n  share_url: http://example.com\n');
    expect(await readShareUrl()).toHaveProperty('error');
    await writeFile(join(home, 'config.yaml'), 'anywhere:\n  share_url: http://localhost:8788/\n');
    expect(await readShareUrl()).toEqual({ url: 'http://localhost:8788' });
  });

  it('hostSocketUrl maps https to wss and http to ws (ac1)', () => {
    expect(hostSocketUrl('https://share.overdeck.ai', 'BCDFGHJK')).toBe('wss://share.overdeck.ai/v1/rooms/BCDFGHJK/host?v=1');
    expect(hostSocketUrl('http://127.0.0.1:8787', 'BCDFGHJK')).toBe('ws://127.0.0.1:8787/v1/rooms/BCDFGHJK/host?v=1');
  });

  it('joinSocketUrl maps https to wss and http to ws', () => {
    expect(joinSocketUrl('https://share.overdeck.ai', 'BCDFGHJK')).toBe('wss://share.overdeck.ai/v1/rooms/BCDFGHJK/join?v=1');
    expect(joinSocketUrl('http://127.0.0.1:8787', 'BCDFGHJK')).toBe('ws://127.0.0.1:8787/v1/rooms/BCDFGHJK/join?v=1');
  });

  it('shareOrigin returns the origin of a parsed share URL', () => {
    expect(shareOrigin('https://share.overdeck.ai')).toBe('https://share.overdeck.ai');
    expect(shareOrigin('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });
});

describe('createRoom', () => {
  it('posts the scope with the device token and returns the room on 201 (ac2)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(room(), 201));
    const result = await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch });

    expect(result).toEqual({ ok: true, room: room() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/rooms`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ scope: SCOPE });
  });

  it('accepts a loopback http joinUrl that differs from the base', async () => {
    const local = room({ joinUrl: 'http://localhost:8788/s/BCDFGHJK' });
    const fetchMock = vi.fn(async () => jsonResponse(local, 201));
    expect(await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch })).toEqual({ ok: true, room: local });
  });

  it('maps error bodies and statuses', async () => {
    for (const [status, error] of [[401, 'invalid_token'], [429, 'rate_limited'], [503, 'room_unavailable']] as const) {
      const fetchMock = vi.fn(async () => jsonResponse({ error }, status));
      expect(await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch })).toEqual({ ok: false, status, error });
    }
    const plain = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: plain as unknown as typeof fetch })).toEqual({ ok: false, status: 500, error: 'http_500' });
  });

  it('returns bad_response for a malformed 201', async () => {
    for (const body of [{ ...room(), hostToken: 'odh_short' }, { ...room(), joinUrl: 'https://share.overdeck.ai/s/OTHERCOD' }, { ...room(), snapshot: null }]) {
      const fetchMock = vi.fn(async () => jsonResponse(body, 201));
      expect(await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch })).toEqual({ ok: false, status: 201, error: 'bad_response' });
    }
  });

  it('returns unreachable when fetch throws', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch })).toEqual({ ok: false, status: null, error: 'unreachable' });
  });

  it('returns timeout after SHARE_HTTP_TIMEOUT_MS with a fetch that never resolves (ac3)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    const pending = createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(SHARE_HTTP_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, status: null, error: 'timeout' });
  });

  it('never puts a token in a failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'invalid_token' }, 401));
    const result = await createRoom(BASE, DEVICE_TOKEN, SCOPE, { fetch: fetchMock as unknown as typeof fetch });
    expect(JSON.stringify(result)).not.toMatch(/odd_|odh_/);
  });
});

describe('deleteRoom', () => {
  it('sends the host token and treats 204 and 404 as ok, 503 as a failure (ac4)', async () => {
    const ok = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await deleteRoom(BASE, 'BCDFGHJK', HOST_TOKEN, { fetch: ok as unknown as typeof fetch })).toEqual({ ok: true });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/rooms/BCDFGHJK`);
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${HOST_TOKEN}`);

    const gone = vi.fn(async () => jsonResponse({ error: 'not_found' }, 404));
    expect(await deleteRoom(BASE, 'BCDFGHJK', HOST_TOKEN, { fetch: gone as unknown as typeof fetch })).toEqual({ ok: true });

    const down = vi.fn(async () => jsonResponse({ error: 'internal_error' }, 503));
    expect(await deleteRoom(BASE, 'BCDFGHJK', HOST_TOKEN, { fetch: down as unknown as typeof fetch })).toEqual({ ok: false, status: 503, error: 'internal_error' });
  });
});
