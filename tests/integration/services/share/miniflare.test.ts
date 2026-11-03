/**
 * The share service on real workerd (PRD PAN-658 WI-1.5, "Local development and tests").
 *
 * Bundles the Worker with wrangler's `--dry-run` deploy (no credentials, no upload) and runs it in
 * Miniflare beside an inline account stub that exports `AccountRpc`, bound by named entrypoint
 * exactly as production binds PAN-4293's account Worker. One end-to-end flow drives a room through
 * the lobby, admission, signaling, kick, revoke/unrevoke and deletion over real WebSockets.
 * Nothing sleeps: every wait resolves on a WebSocket event. The 5-minute alarm is covered by the
 * reducer unit tests on an injected clock.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../../..');
const SERVICE_DIR = join(ROOT, 'services/share');

// miniflare and wrangler are devDependencies of the services/share workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/share/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const BASE = 'https://share.test';
const SLOW = 60_000;
const OWNER = { id: 1, login: 'owner' };
const VIEWER_A = { id: 100, login: 'alice' };
const tokenFor = (githubId: number) => 'odd_' + githubId.toString(16).padStart(64, '0');

/** Device tokens the account stub accepts, mapped to the identity it returns. */
const ACCOUNT_STUB = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const USERS = ${JSON.stringify(
  Object.fromEntries([OWNER, VIEWER_A].map((u) => [tokenFor(u.id), { githubId: u.id, githubLogin: u.login }])),
)};
export class AccountRpc extends WorkerEntrypoint {
  async verifyDevice(token) {
    const user = USERS[token];
    if (!user) return { ok: false, error: 'invalid_token' };
    return { ok: true, userId: 'u' + user.githubId, githubId: user.githubId, githubLogin: user.githubLogin, deviceId: 'd' + user.githubId };
  }
  // PAN-4481 browser sign-in: the code odc_test redeems to viewer A's device token.
  async redeemWebCode(input) {
    if (input.code !== 'odc_test') return { ok: false, error: 'invalid_grant' };
    return { ok: true, accessToken: ${JSON.stringify(tokenFor(VIEWER_A.id))}, deviceId: 'd${VIEWER_A.id}', label: 'Web browser' };
  }
  async signOutDevice() {
    return { ok: true };
  }
}
export default { fetch() { return new Response('account stub'); } };
`;

const ACCOUNT_BASE = 'https://account.test';
const WEB_SESSION_KEY = 'ab'.repeat(32);

const TURN_KEY_ID = 'turn-key-test';
const TURN_API_TOKEN = 'turn-api-token-test';
const STUB_ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  { urls: ['turns:turn.cloudflare.com:443?transport=tcp'], username: 'stub-user', credential: 'stub-cred' },
];

let tmp = '';
let mf: Miniflare;
const unexpectedOutbound: string[] = [];
/** Requests that reached the stubbed Cloudflare TURN credential API. */
const turnRequests: Array<{ authorization: string | null; body: string }> = [];

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-share-mf-'));
  const wrangler = join(SERVICE_DIR, 'node_modules/wrangler/bin/wrangler.js');
  await execFileAsync(wrangler, ['deploy', '--dry-run', '--outdir', tmp], {
    cwd: SERVICE_DIR,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const bundle = await readFile(join(tmp, 'index.js'), 'utf8');
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'overdeck-share',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: bundle } } },
          env: {
            ROOMS: { type: 'durable-object', worker: 'overdeck-share', exportName: 'ShareRoom' },
            ACCOUNT: { type: 'worker', worker: 'account-stub', exportName: 'AccountRpc' },
            PUBLIC_BASE_URL: { type: 'text', value: BASE },
            TURN_KEY_ID: { type: 'text', value: TURN_KEY_ID },
            TURN_KEY_API_TOKEN: { type: 'text', value: TURN_API_TOKEN }, // a Worker secret in production; same string binding at runtime
            ACCOUNT_BASE_URL: { type: 'text', value: ACCOUNT_BASE },
            WEB_SESSION_KEY: { type: 'text', value: WEB_SESSION_KEY }, // a Worker secret in production
          },
          exports: { ShareRoom: { type: 'durable-object', storage: 'sqlite' } },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (request: Request) => {
              const url = new URL(request.url);
              if (
                request.method === 'POST' &&
                url.href === `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`
              ) {
                turnRequests.push({ authorization: request.headers.get('Authorization'), body: await request.text() });
                return new Response(JSON.stringify({ iceServers: STUB_ICE_SERVERS }), {
                  status: 201,
                  headers: { 'Content-Type': 'application/json' },
                });
              }
              unexpectedOutbound.push(`${request.method} ${request.url}`);
              return new Response('unexpected outbound request', { status: 599 });
            },
          },
        },
      },
      {
        config: {
          name: 'account-stub',
          compatibilityDate: '2026-09-01',
          manifest: { mainModule: 'stub.js', modules: { 'stub.js': { type: 'esm', contents: ACCOUNT_STUB } } },
        },
      },
    ],
  });
  await mf.ready;
}, 180_000);

afterAll(async () => {
  await mf?.dispose();
  if (tmp) await rm(tmp, { recursive: true, force: true });
}, 60_000);

type Frame = Record<string, unknown>;

/** One client socket: records every frame and the close, and resolves waits on events only. */
class Peer {
  readonly frames: Frame[] = [];
  /** Every message as received, including non-JSON text such as the `pong` auto-response. */
  readonly texts: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private wake: Array<() => void> = [];

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const text = String(event.data);
      this.texts.push(text);
      if (text.startsWith('{')) this.frames.push(JSON.parse(text) as Frame);
      this.notify();
    });
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.notify();
    });
    ws.accept();
  }

  private notify(): void {
    const waiting = this.wake;
    this.wake = [];
    for (const resolve of waiting) resolve();
  }

  private async until(done: () => boolean): Promise<void> {
    while (!done()) await new Promise<void>((resolve) => this.wake.push(resolve));
  }

  send(frame: Frame): void {
    this.ws.send(JSON.stringify(frame));
  }

  sendText(text: string): void {
    this.ws.send(text);
  }

  /** Waits until at least `count` messages have arrived (JSON or not). */
  async waitForTexts(count: number): Promise<string[]> {
    await this.until(() => this.texts.length >= count || this.closed !== null);
    if (this.texts.length < count) throw new Error(`socket closed (${JSON.stringify(this.closed)}) after ${JSON.stringify(this.texts)}`);
    return this.texts;
  }

  /** Waits for the first frame from index `from` matching `match`, and returns it. */
  async waitFor(match: (frame: Frame) => boolean, from = 0): Promise<Frame> {
    let found: Frame | undefined;
    await this.until(() => {
      found = this.frames.slice(from).find(match);
      return found !== undefined || this.closed !== null;
    });
    if (!found) throw new Error(`socket closed (${JSON.stringify(this.closed)}) before a matching frame; got ${JSON.stringify(this.frames)}`);
    return found;
  }

  async waitClose(): Promise<{ code: number; reason: string }> {
    await this.until(() => this.closed !== null);
    return this.closed as { code: number; reason: string };
  }
}

function req(path: string, init: RequestInit = {}): Promise<Response> {
  return mf.dispatchFetch(`${BASE}${path}`, init as never) as unknown as Promise<Response>;
}

async function openSocket(path: string, authorization: string): Promise<Peer> {
  const res = (await req(path, { headers: { Upgrade: 'websocket', Authorization: authorization } })) as Response & { webSocket: WebSocket | null };
  expect(res.status, `${path} upgrade`).toBe(101);
  expect(res.webSocket).not.toBeNull();
  return new Peer(res.webSocket as WebSocket);
}

/** The `name=value` part of the response's Set-Cookie for `name`. */
function cookiePair(res: Response, name: string): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? '';
  return header.split(';')[0] ?? '';
}

const isType = (type: string) => (f: Frame) => f['type'] === type;
const status = (value: string) => (f: Frame) => f['type'] === 'status' && f['status'] === value;
type Snapshot = { participants: Array<{ githubId: number; state: string; contributor: boolean; connected: boolean }>; blocked: Array<{ githubId: number }> };
const snapshotOf = (f: Frame) => f['snapshot'] as Snapshot;
const offer = { sdp: { type: 'offer', sdp: 'v=0' } };
const answer = { sdp: { type: 'answer', sdp: 'v=0' } };

describe('share service on real workerd (PAN-658 share-room-do)', () => {
  it('GET /healthz reports configured: true, turn: true and web: true', async () => {
    const res = await req('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: true, web: true });
  }, SLOW);

  it('refuses a non-upgrade request with 426 and an unknown protocol version with 400', async () => {
    const auth = { Authorization: `Bearer odh_${'a'.repeat(64)}` };
    expect((await req('/v1/rooms/BCDFGHJK/host?v=1', { headers: auth })).status).toBe(426);
    expect((await req('/v1/rooms/BCDFGHJK/host?v=2', { headers: { ...auth, Upgrade: 'websocket' } })).status).toBe(400);
    const unknownRoom = await req('/v1/rooms/BCDFGHJK/host?v=1', { headers: { ...auth, Upgrade: 'websocket' } });
    expect(unknownRoom.status).toBe(404);
  }, SLOW);

  it('drives a room through lobby, admission, signaling, kick, revoke, unrevoke and deletion', async () => {
    // Create the room.
    const created = await req('/v1/rooms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(OWNER.id)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: { kind: 'conversation', conversationId: 'conv-1' } }),
    });
    expect(created.status).toBe(201);
    const { shortCode, hostToken, joinUrl } = (await created.json()) as { shortCode: string; hostToken: string; joinUrl: string };
    expect(joinUrl).toBe(`${BASE}/s/${shortCode}`);
    expect((await req(`/s/${shortCode}`)).status).toBe(200);

    // The host connects and receives a room snapshot.
    const host = await openSocket(`/v1/rooms/${shortCode}/host?v=1`, `Bearer ${hostToken}`);
    const first = await host.waitFor(isType('room'));
    expect(snapshotOf(first).participants).toEqual([]);

    // Viewer A joins: exactly one frame, status lobby; the host's snapshot lists A in the lobby.
    const joinPath = `/v1/rooms/${shortCode}/join?v=1`;
    const viewerAuth = `Bearer ${tokenFor(VIEWER_A.id)}`;
    let a = await openSocket(joinPath, viewerAuth);
    await a.waitFor(status('lobby'));
    const lobbySnap = await host.waitFor((f) => f['type'] === 'room' && snapshotOf(f).participants.length === 1);
    expect(snapshotOf(lobbySnap).participants[0]).toMatchObject({ githubId: VIEWER_A.id, state: 'lobby', connected: true });

    // A host signal to a lobby viewer is refused to the host, and nothing reaches A.
    let mark = host.frames.length;
    host.send({ type: 'signal', githubId: VIEWER_A.id, data: offer });
    expect(await host.waitFor(isType('error'), mark)).toEqual({ type: 'error', code: 'not_admitted', githubId: VIEWER_A.id });
    // Fence on A's channel: A's own ice-servers request is refused, so everything sent to A before it has arrived.
    a.send({ type: 'ice-servers' });
    await a.waitFor(isType('error'));
    expect(a.frames).toEqual([{ type: 'status', status: 'lobby' }, { type: 'error', code: 'not_admitted' }]);
    // The lobby viewer's ice-servers request never reached the TURN API.
    expect(turnRequests).toEqual([]);

    // The host gets fresh ICE servers from the TURN credential API.
    mark = host.frames.length;
    host.send({ type: 'ice-servers' });
    expect(await host.waitFor(isType('ice-servers'), mark)).toEqual({ type: 'ice-servers', iceServers: STUB_ICE_SERVERS });
    expect(turnRequests).toEqual([{ authorization: `Bearer ${TURN_API_TOKEN}`, body: '{"ttl":3600}' }]);

    // Admit A as a contributor.
    host.send({ type: 'admit', githubId: VIEWER_A.id, contributor: true });
    expect(await a.waitFor(status('admitted'))).toEqual({ type: 'status', status: 'admitted', contributor: true });

    // Signals relay in both directions.
    mark = host.frames.length;
    host.send({ type: 'signal', githubId: VIEWER_A.id, data: offer });
    expect(await a.waitFor(isType('signal'))).toEqual({ type: 'signal', data: offer });
    a.send({ type: 'signal', data: answer, extra: 'dropped' });
    expect(await host.waitFor(isType('signal'), mark)).toEqual({ type: 'signal', githubId: VIEWER_A.id, data: answer });

    // A `ping` text frame is answered `pong` by the runtime and never reaches the frame decoder (PAN-4481 FR-10).
    const before = a.texts.length;
    a.sendText('ping');
    expect((await a.waitForTexts(before + 1)).slice(before)).toEqual(['pong']);

    // Once admitted, A gets ICE servers too; the frame after the ping decodes normally and no invalid_frame arrives.
    a.send({ type: 'ice-servers' });
    expect(await a.waitFor(isType('ice-servers'))).toEqual({ type: 'ice-servers', iceServers: STUB_ICE_SERVERS });
    expect(a.texts.slice(before)).toHaveLength(2);
    expect(a.texts[before]).toBe('pong');
    expect(a.frames.filter(isType('error'))).toEqual([{ type: 'error', code: 'not_admitted' }]);
    expect(turnRequests).toHaveLength(2);

    // Kick: A's socket closes 4010 and a rejoin lands in the lobby.
    host.send({ type: 'kick', githubId: VIEWER_A.id });
    expect((await a.waitClose()).code).toBe(4010);
    a = await openSocket(joinPath, viewerAuth);
    await a.waitFor(status('lobby'));
    expect(a.frames).toEqual([{ type: 'status', status: 'lobby' }]);

    // Revoke: 4011; a rejoin is closed 4003 after the upgrade.
    host.send({ type: 'revoke', githubId: VIEWER_A.id });
    expect((await a.waitClose()).code).toBe(4011);
    a = await openSocket(joinPath, viewerAuth);
    expect((await a.waitClose()).code).toBe(4003);
    expect(a.frames).toEqual([]);

    // Unrevoke: the host's snapshot drops the block, and a rejoin lands in the lobby again.
    mark = host.frames.length;
    host.send({ type: 'unrevoke', githubId: VIEWER_A.id });
    await host.waitFor((f) => f['type'] === 'room' && snapshotOf(f).blocked.length === 0, mark);
    a = await openSocket(joinPath, viewerAuth);
    await a.waitFor(status('lobby'));

    // Delete with the host token: every socket closes 4004 and the landing page is gone.
    const deleted = await req(`/v1/rooms/${shortCode}`, { method: 'DELETE', headers: { Authorization: `Bearer ${hostToken}` } });
    expect(deleted.status).toBe(204);
    expect((await a.waitClose()).code).toBe(4004);
    expect((await host.waitClose()).code).toBe(4004);
    expect((await req(`/s/${shortCode}`)).status).toBe(404);

    expect(unexpectedOutbound).toEqual([]);
  }, 120_000);
});

describe('hosted web join on real workerd (PAN-4481 share-web-join-route)', () => {
  it('signs a browser in, opens the web-join socket with the session cookie and lands in the lobby', async () => {
    const created = await req('/v1/rooms', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(OWNER.id)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: { kind: 'conversation', conversationId: 'conv-web' } }),
    });
    expect(created.status).toBe(201);
    const { shortCode, hostToken } = (await created.json()) as { shortCode: string; hostToken: string };
    const host = await openSocket(`/v1/rooms/${shortCode}/host?v=1`, `Bearer ${hostToken}`);
    await host.waitFor(isType('room'));

    // Sign-in: a sealed sign-in cookie and a 302 to the account Worker with the share redirect.
    const signin = await req(`/auth/signin?code=${shortCode}`, { redirect: 'manual' });
    expect(signin.status).toBe(302);
    const start = new URL(signin.headers.get('Location') ?? '');
    expect(start.origin + start.pathname).toBe(`${ACCOUNT_BASE}/auth/start`);
    expect(start.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/callback`);
    expect(start.searchParams.get('platform')).toBe('web');
    const signinCookie = cookiePair(signin, '__Host-ods_signin');

    // Callback: the code is redeemed over the service binding and the session cookie is set.
    const callback = await req(`/auth/callback?code=odc_test&state=${start.searchParams.get('state')}`, { redirect: 'manual', headers: { Cookie: signinCookie } });
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`/s/${shortCode}`);
    const session = cookiePair(callback, '__Host-ods_session');
    expect(session).toMatch(/^__Host-ods_session=[A-Za-z0-9_-]+$/);

    const me = await req('/v1/web/session', { headers: { Cookie: session } });
    expect(await me.json()).toEqual({ signedIn: true, githubId: VIEWER_A.id, login: VIEWER_A.login, avatarUrl: `https://avatars.githubusercontent.com/u/${VIEWER_A.id}` });

    // A foreign Origin is refused before any upgrade.
    const evil = await req(`/v1/rooms/${shortCode}/web-join?v=1`, { headers: { Upgrade: 'websocket', Origin: 'https://evil.test', Cookie: session } });
    expect(evil.status).toBe(403);

    // The browser's socket lands in the lobby, and the host sees the viewer.
    const res = (await req(`/v1/rooms/${shortCode}/web-join?v=1`, { headers: { Upgrade: 'websocket', Origin: BASE, Cookie: session } })) as Response & { webSocket: WebSocket | null };
    expect(res.status).toBe(101);
    const browser = new Peer(res.webSocket as WebSocket);
    await browser.waitFor(status('lobby'));
    const snap = await host.waitFor((f) => f['type'] === 'room' && snapshotOf(f).participants.length === 1);
    expect(snapshotOf(snap).participants[0]).toMatchObject({ githubId: VIEWER_A.id, state: 'lobby', connected: true });

    const deleted = await req(`/v1/rooms/${shortCode}`, { method: 'DELETE', headers: { Authorization: `Bearer ${hostToken}` } });
    expect(deleted.status).toBe(204);
    expect((await browser.waitClose()).code).toBe(4004);
    expect(unexpectedOutbound).toEqual([]);
  }, 120_000);
});
