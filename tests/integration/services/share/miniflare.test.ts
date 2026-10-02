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
}
export default { fetch() { return new Response('account stub'); } };
`;

let tmp = '';
let mf: Miniflare;
const unexpectedOutbound: string[] = [];

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
          },
          exports: { ShareRoom: { type: 'durable-object', storage: 'sqlite' } },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (request: Request) => {
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
  closed: { code: number; reason: string } | null = null;
  private wake: Array<() => void> = [];

  constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.frames.push(JSON.parse(String(event.data)) as Frame);
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

const isType = (type: string) => (f: Frame) => f['type'] === type;
const status = (value: string) => (f: Frame) => f['type'] === 'status' && f['status'] === value;
type Snapshot = { participants: Array<{ githubId: number; state: string; contributor: boolean; connected: boolean }>; blocked: Array<{ githubId: number }> };
const snapshotOf = (f: Frame) => f['snapshot'] as Snapshot;
const offer = { sdp: { type: 'offer', sdp: 'v=0' } };
const answer = { sdp: { type: 'answer', sdp: 'v=0' } };

describe('share service on real workerd (PAN-658 share-room-do)', () => {
  it('GET /healthz reports configured: true and turn: false', async () => {
    const res = await req('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: false });
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

    // Admit A as a contributor.
    host.send({ type: 'admit', githubId: VIEWER_A.id, contributor: true });
    expect(await a.waitFor(status('admitted'))).toEqual({ type: 'status', status: 'admitted', contributor: true });

    // Signals relay in both directions.
    mark = host.frames.length;
    host.send({ type: 'signal', githubId: VIEWER_A.id, data: offer });
    expect(await a.waitFor(isType('signal'))).toEqual({ type: 'signal', data: offer });
    a.send({ type: 'signal', data: answer, extra: 'dropped' });
    expect(await host.waitFor(isType('signal'), mark)).toEqual({ type: 'signal', githubId: VIEWER_A.id, data: answer });

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
