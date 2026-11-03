/**
 * The viewer server's JoinManager through the real share Worker on workerd (PRD PAN-4475 WI-10).
 *
 * The Worker bundle, Miniflare construction and account stub are copied from `peer-hub.test.ts`
 * (not imported: that file owns its own lifecycle). The host is a real ShareManager with the real
 * HTTP client and a real PeerHub on werift whose ConversationBridge parses a JSONL fixture with the
 * production parser and a fake watch. The viewer is a real JoinManager with `defaultOpenSocket`; its
 * one subscriber forwards `signal` events to a werift LoopbackViewer, whose outgoing signals go back
 * through `JoinManager.signal`. So every SDP and ICE message crosses both dashboards' share sockets
 * and the Worker. Every wait resolves on an event or `vi.waitFor`; nothing sleeps.
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
import type { ParseResult } from '../../../../src/dashboard/server/services/conversation/types.js';
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
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-share-join-mf-'));
  home = await mkdtemp(join(tmpdir(), 'overdeck-share-join-home-'));
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

function delta(text: string): ParseResult {
  return {
    messages: [{ id: 'm3', role: 'assistant', text, createdAt: '2026-11-03T00:00:02.000Z' }],
    workLog: [],
    byteOffset: 10_000_000,
    streaming: false,
    totalCost: 0,
    totalTokens: 0,
    latestAssistantUsage: null,
    observedEffort: null,
    contextBoundaryOffset: 0,
    contextActiveBytes: 0,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: 0,
    mtimeMs: 0,
  };
}

interface Host {
  manager: ShareManager;
  watch(): ((result: ParseResult) => void | Promise<void>) | null;
}

async function startHost(conversationId: string): Promise<Host> {
  const file = join(tmp, `${conversationId}.jsonl`);
  await writeFile(
    file,
    `${userLine('first fixture message', 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine('second fixture message', 'u-2', '2026-11-03T00:00:01.000Z')}\n`,
  );
  let watchCallback: ((result: ParseResult) => void | Promise<void>) | null = null;
  const manager = new ShareManager({
    readAccount: async () => account(OWNER),
    readShareUrl: async () => ({ url: localUrl }),
    createRoom,
    deleteRoom,
    records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
    openSocket: defaultOpenSocket,
    now: () => new Date(),
    createHub: (ctx) => new PeerHub(ctx, {
      createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as HubPeerConnection,
      bridge: new ConversationBridge(ctx.scope.conversationId, {
        resolveSessionFile: async () => file,
        parseInitial: (sessionFile) => parseEntireConversation(sessionFile, { flushPendingToolUse: false }),
        watch: (_file, callback) => {
          watchCallback = callback;
          return { stop: () => undefined };
        },
      }),
      queue: {
        deliver: async () => ({ status: 200, body: {} }),
        activity: async () => ({ working: false, lastMessageId: null }),
        now: () => Date.now(),
      },
      streamLabel: async () => 'Fixture',
      now: () => Date.now(),
    }),
  });
  return { manager, watch: () => watchCallback };
}

function viewerManager(): JoinManager {
  return new JoinManager({
    readAccount: async () => account(VIEWER_A),
    readShareUrl: async () => ({ url: localUrl }),
    openSocket: defaultOpenSocket,
    now: () => Date.now(),
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

/** One viewer-browser stand-in: a subscriber that relays signals to and from a LoopbackViewer. */
class Subscriber {
  readonly events: JoinEvent[] = [];
  readonly viewer = new LoopbackViewer();
  readonly unsubscribe: () => void;

  constructor(joins: JoinManager, shortCode: string) {
    const unsubscribe = joins.subscribe(shortCode, (event) => {
      this.events.push(event);
      if (event.type === 'signal') void this.viewer.onSignal(event.data);
    });
    if (!unsubscribe) throw new Error('no join');
    this.unsubscribe = unsubscribe;
    this.viewer.onOutgoingSignal((data) => joins.signal(shortCode, data));
  }

  signals(): SignalData[] {
    return this.events.flatMap((event) => (event.type === 'signal' ? [event.data] : []));
  }

  async waitState(state: JoinState): Promise<void> {
    await vi.waitFor(() => {
      if (!this.events.some((event) => event.type === 'state' && event.view.state === state)) throw new Error(`waiting for ${state}`);
    }, WAIT);
  }
}

describe('JoinManager through the share service on real workerd (PAN-4475)', () => {
  it('lobby gets no signals; admission streams hello, history and append; a resubscribe gets a fresh offer; kick ends it', async () => {
    const host = await startHost('conv-join-1');
    const joins = viewerManager();
    const subscribers: Subscriber[] = [];
    try {
      const created = await host.manager.create({ kind: 'conversation', conversationId: 'conv-join-1' });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      const { shortCode } = created.view;
      await snapshotWhere(host.manager, shortCode, (s) => s.hostConnected);

      expect((await joins.join(shortCode)).kind).toBe('created');
      const first = new Subscriber(joins, shortCode);
      subscribers.push(first);
      await first.waitState('lobby');
      await snapshotWhere(host.manager, shortCode, (s) => s.participants.some((p) => p.githubId === VIEWER_A.id && p.state === 'lobby'));
      expect(first.signals()).toEqual([]);

      await host.manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id });
      await first.waitState('admitted');
      const hello = await first.viewer.waitFor((channel) => channel === 'control');
      expect(hello.payload).toMatchObject({ kind: 'hello', hello: { scope: { kind: 'conversation', conversationId: 'conv-join-1' } } });
      const history = (await first.viewer.waitFor((channel) => channel === 'conversation')).payload as ConversationPayload;
      expect(history.kind === 'history' ? history.messages.map((m) => m.text) : null).toEqual([
        'first fixture message',
        'second fixture message',
      ]);
      expect(first.signals().some((data) => data.sdp?.type === 'offer')).toBe(true);

      await vi.waitFor(() => {
        if (!host.watch()) throw new Error('watch not started');
      }, WAIT);
      void host.watch()?.(delta('live message'));
      const append = await first.viewer.waitFor(
        (channel, envelope) => channel === 'conversation' && (envelope.payload as ConversationPayload).kind === 'append',
      );
      expect(append.payload).toMatchObject({ kind: 'append', message: { id: 'm3', text: 'live message' } });

      // D-5: a new subscriber on an admitted join restarts the join socket, so the host offers again.
      first.unsubscribe();
      await first.viewer.close();
      const second = new Subscriber(joins, shortCode);
      subscribers.push(second);
      await vi.waitFor(() => {
        if (!second.signals().some((data) => data.sdp?.type === 'offer')) throw new Error('waiting for a second offer');
      }, WAIT);
      const secondHistory = (await second.viewer.waitFor((channel) => channel === 'conversation')).payload as ConversationPayload;
      expect(secondHistory.kind).toBe('history');
      expect(joins.get(shortCode)?.state).toBe('admitted');

      await host.manager.command(shortCode, { type: 'kick', githubId: VIEWER_A.id });
      await second.waitState('kicked');
      expect(joins.get(shortCode)).toMatchObject({ state: 'kicked', closeCode: 4010 });
    } finally {
      joins.stop();
      host.manager.stop();
      for (const subscriber of subscribers) await subscriber.viewer.close();
    }
  }, SLOW);

  it('leave ends the join as left and the host no longer lists the viewer', async () => {
    const host = await startHost('conv-join-2');
    const joins = viewerManager();
    let subscriber: Subscriber | null = null;
    try {
      const created = await host.manager.create({ kind: 'conversation', conversationId: 'conv-join-2' });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      const { shortCode } = created.view;
      await snapshotWhere(host.manager, shortCode, (s) => s.hostConnected);

      await joins.join(shortCode);
      subscriber = new Subscriber(joins, shortCode);
      await subscriber.waitState('lobby');
      await snapshotWhere(host.manager, shortCode, (s) => s.participants.some((p) => p.githubId === VIEWER_A.id));

      expect(joins.leave(shortCode)).toBe('left');
      await subscriber.waitState('left');
      await snapshotWhere(host.manager, shortCode, (s) => !s.participants.some((p) => p.githubId === VIEWER_A.id));
      expect(joins.get(shortCode)?.state).toBe('left');
    } finally {
      joins.stop();
      host.manager.stop();
      await subscriber?.viewer.close();
    }
  }, SLOW);
});
