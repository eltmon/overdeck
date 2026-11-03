/**
 * The dashboard's ShareManager against the share service on real workerd (PRD PAN-4473 WI-6).
 *
 * The Worker bundle, Miniflare construction and account stub are copied from `miniflare.test.ts`
 * (not imported: that file owns its own lifecycle). A real ShareManager talks to the Miniflare URL
 * with the real HTTP client, the real `ws` host socket and a real record file in a temp
 * OVERDECK_HOME. A stub viewer, connected through `mf.dispatchFetch`, walks through the lobby while
 * the manager admits, kicks, revokes, unrevokes and ends. Every wait resolves on a socket event or
 * polls `manager.list()` with `vi.waitFor`; nothing sleeps.
 *
 * D-11 checkpoint: the test also proves workerd answers a WebSocket protocol ping on the host
 * socket with a pong, which the manager's keepalive relies on.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot, ShareView } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../src/lib/account/store.js';
import {
  putShareRecord,
  readShareRecords,
  removeShareRecord,
} from '../../../../src/lib/sharing/share-record.js';
import { createRoom, deleteRoom } from '../../../../src/lib/sharing/share-service.js';
import { defaultOpenSocket, ShareManager, type ShareSocket } from '../../../../src/dashboard/server/services/share-host.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../../..');
const SERVICE_DIR = join(ROOT, 'services/share');

// miniflare and wrangler are devDependencies of the services/share workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/share/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const BASE = 'https://share.test';
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

const ACCOUNT: AccountRecord = {
  v: 1,
  baseUrl: 'https://overdeck.ai',
  accessToken: tokenFor(OWNER.id),
  deviceId: 'd1',
  label: 'host',
  githubLogin: OWNER.login,
  githubId: OWNER.id,
  signedInAt: '2026-11-02T00:00:00.000Z',
};

let tmp = '';
let home = '';
let mf: Miniflare;
let localUrl = '';
const originalHome = process.env.OVERDECK_HOME;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-share-host-mf-'));
  home = await mkdtemp(join(tmpdir(), 'overdeck-share-host-home-'));
  process.env.OVERDECK_HOME = home;
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
  localUrl = String(await mf.ready).replace(/\/$/, '');
}, 180_000);

afterAll(async () => {
  await mf?.dispose();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tmp) await rm(tmp, { recursive: true, force: true });
  if (home) await rm(home, { recursive: true, force: true });
}, 60_000);

/** The stub viewer's signaling socket: records its frames and close, resolving waits on events only. */
class Viewer {
  readonly frames: Array<Record<string, unknown>> = [];
  closed: { code: number } | null = null;
  private wake: Array<() => void> = [];

  constructor(ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
      this.notify();
    });
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code };
      this.notify();
    });
    ws.accept();
  }

  private notify(): void {
    const waiting = this.wake;
    this.wake = [];
    for (const resolveWait of waiting) resolveWait();
  }

  async waitClose(): Promise<number> {
    while (this.closed === null) await new Promise<void>((resolveWait) => this.wake.push(resolveWait));
    return this.closed.code;
  }
}

async function joinAsViewer(shortCode: string): Promise<Viewer> {
  const res = (await mf.dispatchFetch(`${BASE}/v1/rooms/${shortCode}/join?v=1`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${tokenFor(VIEWER_A.id)}` },
  })) as unknown as Response & { webSocket: WebSocket | null };
  expect(res.status).toBe(101);
  return new Viewer(res.webSocket as WebSocket);
}

const WAIT = { timeout: 20_000, interval: 25 };

async function viewOf(manager: ShareManager, shortCode: string): Promise<ShareView> {
  const view = (await manager.list()).find((v) => v.shortCode === shortCode);
  if (!view) throw new Error(`no share ${shortCode}`);
  return view;
}

async function snapshotWhere(manager: ShareManager, shortCode: string, match: (s: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
  return vi.waitFor(async () => {
    const view = await viewOf(manager, shortCode);
    const snapshot = view.snapshot;
    if (view.connection !== 'connected' || !snapshot || !match(snapshot)) throw new Error(`waiting: ${JSON.stringify(view)}`);
    return snapshot;
  }, WAIT);
}

describe('ShareManager against the share service on real workerd (PAN-4473)', () => {
  it('admits, kicks, revokes, unrevokes and ends a stub viewer through the lobby', async () => {
    const hostSockets: ShareSocket[] = [];
    const manager = new ShareManager({
      readAccount: async () => ACCOUNT,
      readShareUrl: async () => ({ url: localUrl }),
      createRoom,
      deleteRoom,
      records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
      openSocket: (url, headers) => {
        const socket = defaultOpenSocket(url, headers);
        hostSockets.push(socket);
        return socket;
      },
      now: () => new Date(),
    });

    try {
      const created = await manager.create({ kind: 'conversation', conversationId: 'conv-1' });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      const { shortCode } = created.view;
      expect(created.view.joinUrl).toBe(`${BASE}/s/${shortCode}`);
      expect(Object.keys(await readShareRecords())).toEqual([shortCode]);

      await snapshotWhere(manager, shortCode, (s) => s.hostConnected);

      // D-11 checkpoint: workerd answers a protocol ping on the host socket.
      const hostSocket = hostSockets[0] as ShareSocket;
      const pong = new Promise<void>((resolvePong) => hostSocket.on('pong', () => resolvePong()));
      hostSocket.ping();
      await pong;

      // The viewer joins and waits in the lobby (ac1).
      let viewer = await joinAsViewer(shortCode);
      let snap = await snapshotWhere(manager, shortCode, (s) => s.participants.length === 1);
      expect(snap.participants[0]).toMatchObject({ githubId: VIEWER_A.id, login: VIEWER_A.login, state: 'lobby', connected: true });

      // Admit as contributor in one command (ac2).
      expect(await manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id, contributor: true })).toEqual({ status: 202, body: { ok: true } });
      snap = await snapshotWhere(manager, shortCode, (s) => s.participants[0]?.state === 'admitted');
      expect(snap.participants[0]).toMatchObject({ githubId: VIEWER_A.id, state: 'admitted', contributor: true });

      // Kick: the viewer's socket closes 4010 and it leaves the snapshot (ac3).
      await manager.command(shortCode, { type: 'kick', githubId: VIEWER_A.id });
      expect(await viewer.waitClose()).toBe(4010);
      await snapshotWhere(manager, shortCode, (s) => s.participants.length === 0);

      // Rejoin lands in the lobby; revoke blocks it, unrevoke clears the block (ac4).
      viewer = await joinAsViewer(shortCode);
      await snapshotWhere(manager, shortCode, (s) => s.participants[0]?.state === 'lobby');
      await manager.command(shortCode, { type: 'revoke', githubId: VIEWER_A.id });
      expect(await viewer.waitClose()).toBe(4011);
      snap = await snapshotWhere(manager, shortCode, (s) => s.blocked.length === 1);
      expect(snap.blocked[0]).toMatchObject({ githubId: VIEWER_A.id, login: VIEWER_A.login });
      await manager.command(shortCode, { type: 'unrevoke', githubId: VIEWER_A.id });
      await snapshotWhere(manager, shortCode, (s) => s.blocked.length === 0);

      // End: the record file holds no rooms and the waiting viewer is closed 4004 (ac5).
      viewer = await joinAsViewer(shortCode);
      await snapshotWhere(manager, shortCode, (s) => s.participants.length === 1);
      expect(await manager.end(shortCode)).toEqual({ status: 204 });
      expect(await viewer.waitClose()).toBe(4004);
      expect(await readShareRecords()).toEqual({});
      expect(JSON.parse(await readFile(join(home, 'shared-sessions.json'), 'utf8'))).toEqual({ version: 1, rooms: {} });
      expect(await manager.list()).toEqual([]);
    } finally {
      manager.stop();
    }
  }, 120_000);
});
