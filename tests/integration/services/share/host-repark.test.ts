/**
 * Host re-park after a dashboard restart through the real share Worker on workerd (PRD PAN-4479 WI-9).
 *
 * The Worker bundle, Miniflare construction, account stub, `startHost` and `Subscriber` are copied
 * from `join-manager.test.ts` (not imported: that file owns its own lifecycle). A "restart" is
 * `stop()` on one ShareManager and `resume()` on a new one over the same OVERDECK_HOME, so the second
 * manager sees only the share record file. The Subscriber hands every host offer to a new
 * LoopbackViewer, like the browser does after a lost peer (PAN-4475 D-11). The expired 5-minute
 * window is stood in for by deleting the room (D-9). Every wait resolves on an event or
 * `vi.waitFor`; nothing sleeps.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import type { ConversationPayload, JoinEvent, JoinState, RoomSnapshot, SignalData } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../src/lib/account/store.js';
import {
  putShareRecord,
  readShareRecords,
  removeShareRecord,
} from '../../../../src/lib/sharing/share-record.js';
import { createRoom, deleteRoom } from '../../../../src/lib/sharing/share-service.js';
import { defaultOpenSocket, ShareManager } from '../../../../src/dashboard/server/services/share-host.js';
import { JoinManager } from '../../../../src/dashboard/server/services/share-join.js';
import { parseEntireConversation } from '../../../../src/dashboard/server/services/conversation/parser.js';
import { ConversationBridge } from '../../../../src/dashboard/server/sharing/conversation-bridge.js';
import { PeerHub, type HubPeerConnection } from '../../../../src/dashboard/server/sharing/peer-hub.js';
import { LoopbackViewer } from '../../../../src/dashboard/server/sharing/__tests__/loopback-viewer.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../../..');
const SERVICE_DIR = join(ROOT, 'services/share');

// miniflare and wrangler are devDependencies of the services/share workspace, not of the root.
const serviceRequire = createRequire(join(SERVICE_DIR, 'package.json'));
type MiniflareModule = typeof import('../../../../services/share/node_modules/miniflare');
const { Miniflare } = serviceRequire('miniflare') as MiniflareModule;
type Miniflare = InstanceType<MiniflareModule['Miniflare']>;

const SLOW = 120_000;
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

function account(user: { id: number; login: string }): AccountRecord {
  return {
    v: 1,
    baseUrl: 'https://overdeck.ai',
    accessToken: tokenFor(user.id),
    deviceId: `d${user.id}`,
    label: user.login,
    githubLogin: user.login,
    githubId: user.id,
    signedInAt: '2026-11-02T00:00:00.000Z',
  };
}

let tmp = '';
let home = '';
let mf: Miniflare;
let localUrl = '';
const originalHome = process.env.OVERDECK_HOME;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-share-repark-mf-'));
  home = await mkdtemp(join(tmpdir(), 'overdeck-share-repark-home-'));
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

const WAIT = { timeout: 20_000, interval: 25 };

function userLine(text: string, uuid: string, timestamp: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp, uuid });
}

interface Host {
  manager: ShareManager;
}

/** One host dashboard process: a ShareManager on the shared record file, reconnecting at once. */
async function startHost(conversationId: string): Promise<Host> {
  const file = join(tmp, `${conversationId}.jsonl`);
  await writeFile(
    file,
    `${userLine('first fixture message', 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine('second fixture message', 'u-2', '2026-11-03T00:00:01.000Z')}\n`,
  );
  const manager = new ShareManager({
    readAccount: async () => account(OWNER),
    readShareUrl: async () => ({ url: localUrl }),
    createRoom,
    deleteRoom,
    records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
    openSocket: defaultOpenSocket,
    now: () => new Date(),
    reconnectDelaysMs: [0],
    createHub: (ctx) => new PeerHub(ctx, {
      createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as HubPeerConnection,
      bridge: new ConversationBridge(ctx.scope.conversationId, {
        resolveSessionFile: async () => file,
        parseInitial: (sessionFile) => parseEntireConversation(sessionFile, { flushPendingToolUse: false }),
        watch: () => ({ stop: () => undefined }),
      }),
      queue: {
        deliver: async () => ({ status: 200, body: {} }),
        activity: async () => ({ working: false, lastMessageId: null }),
        now: () => Date.now(),
      },
      terminal: { attach: async () => () => undefined, close: () => undefined },
      streamLabel: async () => 'Fixture',
      now: () => Date.now(),
    }),
  });
  return { manager };
}

function viewerManager(): JoinManager {
  return new JoinManager({
    readAccount: async () => account(VIEWER_A),
    readShareUrl: async () => ({ url: localUrl }),
    openSocket: defaultOpenSocket,
    now: () => Date.now(),
    reconnectDelaysMs: [0],
  });
}

async function snapshotWhere(manager: ShareManager, shortCode: string, match: (s: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
  return vi.waitFor(async () => {
    const view = (await manager.list()).find((v) => v.shortCode === shortCode);
    const snapshot = view?.snapshot;
    if (view?.connection !== 'connected' || !snapshot || !match(snapshot)) throw new Error(`waiting: ${JSON.stringify(view)}`);
    return snapshot;
  }, WAIT);
}

/** One viewer-browser stand-in: every host offer gets a new LoopbackViewer, closing the previous one. */
class Subscriber {
  readonly events: JoinEvent[] = [];
  readonly viewers: LoopbackViewer[] = [];
  readonly unsubscribe: () => void;

  constructor(private readonly joins: JoinManager, private readonly shortCode: string) {
    const unsubscribe = joins.subscribe(shortCode, (event) => {
      this.events.push(event);
      if (event.type === 'signal') this.onSignal(event.data);
    });
    if (!unsubscribe) throw new Error('no join');
    this.unsubscribe = unsubscribe;
  }

  get viewer(): LoopbackViewer | undefined {
    return this.viewers.at(-1);
  }

  states(): JoinState[] {
    return this.events.flatMap((event) => (event.type === 'state' ? [event.view.state] : []));
  }

  offers(): number {
    return this.events.filter((event) => event.type === 'signal' && event.data.sdp?.type === 'offer').length;
  }

  async waitState(state: JoinState): Promise<void> {
    await vi.waitFor(() => {
      if (!this.states().includes(state)) throw new Error(`waiting for ${state}`);
    }, WAIT);
  }

  /** The LoopbackViewer for the latest host offer, once one arrived. */
  async waitViewer(): Promise<LoopbackViewer> {
    return vi.waitFor(() => {
      const viewer = this.viewer;
      if (!viewer) throw new Error('waiting for an offer');
      return viewer;
    }, WAIT);
  }

  async close(): Promise<void> {
    for (const viewer of this.viewers) await viewer.close();
  }

  private onSignal(data: SignalData): void {
    if (data.sdp?.type === 'offer') {
      void this.viewer?.close();
      const next = new LoopbackViewer();
      next.onOutgoingSignal((out) => this.joins.signal(this.shortCode, out));
      this.viewers.push(next);
    }
    void this.viewer?.onSignal(data);
  }
}

async function historyOf(viewer: LoopbackViewer): Promise<string[] | null> {
  const payload = (await viewer.waitFor((channel) => channel === 'conversation')).payload as ConversationPayload;
  return payload.kind === 'history' ? payload.messages.map((m) => m.text) : null;
}

describe('ShareManager re-park through the share service on real workerd (PAN-4479)', () => {
  it('a host restart inside the window restores the admitted viewer without the lobby', async () => {
    const hostA = await startHost('conv-repark-1');
    const joins = viewerManager();
    let hostB: Host | null = null;
    let subscriber: Subscriber | null = null;
    let shortCode = '';
    try {
      const created = await hostA.manager.create({ kind: 'conversation', conversationId: 'conv-repark-1' });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      shortCode = created.view.shortCode;
      await snapshotWhere(hostA.manager, shortCode, (s) => s.hostConnected);

      await joins.join(shortCode);
      subscriber = new Subscriber(joins, shortCode);
      await subscriber.waitState('lobby');
      await hostA.manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id });
      await subscriber.waitState('admitted');
      const firstViewer = await subscriber.waitViewer();
      expect(await historyOf(firstViewer)).toEqual(['first fixture message', 'second fixture message']);

      // The restart: this process's host goes away, a new one re-parks from the record file.
      hostA.manager.stop();
      await subscriber.waitState('host-disconnected');
      hostB = await startHost('conv-repark-1');
      expect(await hostB.manager.resume()).toEqual([shortCode]);

      await snapshotWhere(hostB.manager, shortCode, (s) =>
        s.participants.some((p) => p.githubId === VIEWER_A.id && p.state === 'admitted' && p.connected));
      await vi.waitFor(() => {
        const now = subscriber!.states();
        if (now.lastIndexOf('admitted') < now.lastIndexOf('host-disconnected')) throw new Error(`waiting: ${now.join(',')}`);
      }, WAIT);
      expect(subscriber.states().slice(subscriber.states().indexOf('admitted'))).not.toContain('lobby');
      expect(joins.get(shortCode)?.state).toBe('admitted');

      // D-4: the seeded content gate lets the re-parked hub offer the admitted viewer again.
      await vi.waitFor(() => {
        if (subscriber!.offers() < 2 || subscriber!.viewer === firstViewer) throw new Error('waiting for a second offer');
      }, WAIT);
      const hello = await subscriber.viewer!.waitFor((channel) => channel === 'control');
      expect(hello.payload).toMatchObject({ kind: 'hello', hello: { scope: { kind: 'conversation', conversationId: 'conv-repark-1' } } });
      expect(await historyOf(subscriber.viewer!)).toEqual(['first fixture message', 'second fixture message']);
    } finally {
      joins.stop();
      // End the share so its record does not reach the next case's resume(); end() also works on a
      // stopped manager's stale record.
      if (shortCode) await (hostB ?? hostA).manager.end(shortCode).catch(() => undefined);
      hostA.manager.stop();
      hostB?.manager.stop();
      await subscriber?.close();
    }
  }, SLOW);

  it('after the room is gone, re-park removes the record and re-joining goes through the lobby', async () => {
    const hostA = await startHost('conv-repark-2');
    const joins = viewerManager();
    let hostB: Host | null = null;
    let subscriber: Subscriber | null = null;
    try {
      const created = await hostA.manager.create({ kind: 'conversation', conversationId: 'conv-repark-2' });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      const { shortCode } = created.view;
      await snapshotWhere(hostA.manager, shortCode, (s) => s.hostConnected);

      await joins.join(shortCode);
      subscriber = new Subscriber(joins, shortCode);
      await subscriber.waitState('lobby');
      await hostA.manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id });
      await subscriber.waitState('admitted');

      hostA.manager.stop();
      // D-9: deleting the room stands in for the share service's expired 5-minute alarm.
      const record = (await readShareRecords())[shortCode];
      expect(record).toBeDefined();
      expect((await deleteRoom(localUrl, shortCode, record!.hostToken)).ok).toBe(true);
      await subscriber.waitState('ended');

      hostB = await startHost('conv-repark-2');
      await hostB.manager.resume();
      await vi.waitFor(async () => {
        const views = await hostB!.manager.list();
        const records = await readShareRecords();
        if (views.length > 0 || shortCode in records) throw new Error(`waiting: ${JSON.stringify(views)}`);
      }, WAIT);

      const again = await hostB.manager.create({ kind: 'conversation', conversationId: 'conv-repark-2' });
      expect(again.kind).toBe('created');
      if (again.kind !== 'created') return;
      expect(again.view.shortCode).not.toBe(shortCode);
      await snapshotWhere(hostB.manager, again.view.shortCode, (s) => s.hostConnected);
      expect((await joins.join(again.view.shortCode)).kind).toBe('created');
      await vi.waitFor(() => {
        if (joins.get(again.view.shortCode)?.state !== 'lobby') throw new Error('waiting for lobby');
      }, WAIT);
    } finally {
      joins.stop();
      hostA.manager.stop();
      hostB?.manager.stop();
      await subscriber?.close();
    }
  }, SLOW);
});
