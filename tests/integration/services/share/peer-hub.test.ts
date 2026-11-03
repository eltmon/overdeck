/**
 * The host WebRTC hub through the real share Worker on workerd (PRD PAN-4474 WI-10).
 *
 * The Worker bundle, Miniflare construction and account stub are copied from `host-manager.test.ts`
 * (not imported: that file owns its own lifecycle). A real ShareManager with the real HTTP client and
 * `ws` host socket builds a real PeerHub on werift; its ConversationBridge parses a JSONL fixture with
 * the production parser and a fake watch. The viewer joins through `mf.dispatchFetch` and answers
 * with a werift LoopbackViewer whose signals travel over its join socket, so every SDP and ICE
 * message crosses the share service. No TURN key is bound, so `ice-servers` answers
 * `turn_unavailable` and both sides use host candidates. Every wait resolves on an event or
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
import type { ConversationPayload, RoomSnapshot, SignalData } from '@overdeck/contracts';

import type { AccountRecord } from '../../../../src/lib/account/store.js';
import {
  putShareRecord,
  readShareRecords,
  removeShareRecord,
} from '../../../../src/lib/sharing/share-record.js';
import { createRoom, deleteRoom } from '../../../../src/lib/sharing/share-service.js';
import { defaultOpenSocket, ShareManager } from '../../../../src/dashboard/server/services/share-host.js';
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
const CONVERSATION = 'conv-1';
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
  tmp = await mkdtemp(join(tmpdir(), 'overdeck-share-hub-mf-'));
  home = await mkdtemp(join(tmpdir(), 'overdeck-share-hub-home-'));
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

/** The viewer's join socket: records frames, relays `signal` frames to the loopback viewer and back. */
class JoinSocket {
  readonly frames: Array<Record<string, unknown>> = [];
  closed: { code: number } | null = null;
  private wake: Array<() => void> = [];

  constructor(
    private readonly ws: WebSocket,
    viewer: LoopbackViewer,
  ) {
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
      this.frames.push(frame);
      if (frame.type === 'signal') void viewer.onSignal(frame.data as SignalData);
      this.notify();
    });
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code };
      this.notify();
    });
    ws.accept();
    viewer.onOutgoingSignal((data) => this.ws.send(JSON.stringify({ type: 'signal', data })));
  }

  private notify(): void {
    const waiting = this.wake;
    this.wake = [];
    for (const resolveWait of waiting) resolveWait();
  }

  async waitFrame(match: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    for (;;) {
      const found = this.frames.find(match);
      if (found) return found;
      await new Promise<void>((resolveWait) => this.wake.push(resolveWait));
    }
  }

  async waitClose(): Promise<number> {
    while (this.closed === null) await new Promise<void>((resolveWait) => this.wake.push(resolveWait));
    return this.closed.code;
  }
}

async function joinAsViewer(shortCode: string, viewer: LoopbackViewer): Promise<JoinSocket> {
  const res = (await mf.dispatchFetch(`${BASE}/v1/rooms/${shortCode}/join?v=1`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${tokenFor(VIEWER_A.id)}` },
  })) as unknown as Response & { webSocket: WebSocket | null };
  expect(res.status).toBe(101);
  return new JoinSocket(res.webSocket as WebSocket, viewer);
}

const WAIT = { timeout: 20_000, interval: 25 };

async function snapshotWhere(manager: ShareManager, shortCode: string, match: (s: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
  return vi.waitFor(async () => {
    const view = (await manager.list()).find((v) => v.shortCode === shortCode);
    const snapshot = view?.snapshot;
    if (view?.connection !== 'connected' || !snapshot || !match(snapshot)) throw new Error(`waiting: ${JSON.stringify(view)}`);
    return snapshot;
  }, WAIT);
}

/** Resolves when the viewer's peer connection or its control channel has closed. */
function peerClosed(viewer: LoopbackViewer): Promise<void> {
  return new Promise((resolveClosed) => {
    const isClosed = () =>
      ['closed', 'failed'].includes(viewer.pc.connectionState) || viewer.channels.get('control')?.readyState === 'closed';
    if (isClosed()) {
      resolveClosed();
      return;
    }
    viewer.pc.connectionStateChange.subscribe(() => {
      if (isClosed()) resolveClosed();
    });
    viewer.channels.get('control')?.stateChanged.subscribe(() => {
      if (isClosed()) resolveClosed();
    });
  });
}

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

describe('PeerHub through the share service on real workerd (PAN-4474)', () => {
  it('offers only after admission, streams history and a live append, and drops the peer on kick', async () => {
    const file = join(tmp, 'session.jsonl');
    await writeFile(
      file,
      `${userLine('first fixture message', 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine('second fixture message', 'u-2', '2026-11-03T00:00:01.000Z')}\n`,
    );
    let watchCallback: ((result: ParseResult) => void | Promise<void>) | null = null;
    let hub: PeerHub | null = null;
    const manager = new ShareManager({
      readAccount: async () => ACCOUNT,
      readShareUrl: async () => ({ url: localUrl }),
      createRoom,
      deleteRoom,
      records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
      openSocket: defaultOpenSocket,
      now: () => new Date(),
      createHub: (ctx) => {
        hub = new PeerHub(ctx, {
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
        });
        return hub;
      },
    });
    const viewer = new LoopbackViewer();

    try {
      const created = await manager.create({ kind: 'conversation', conversationId: CONVERSATION });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      const { shortCode } = created.view;
      await snapshotWhere(manager, shortCode, (s) => s.hostConnected);

      // In the lobby the viewer hears only its status; no offer reaches it.
      const join = await joinAsViewer(shortCode, viewer);
      await snapshotWhere(manager, shortCode, (s) => s.participants[0]?.state === 'lobby');
      await join.waitFrame((f) => f.type === 'status' && f.status === 'lobby');
      expect(join.frames.some((f) => f.type === 'signal')).toBe(false);

      // Admission: the host offers through the service and the channels open.
      await manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id });
      await join.waitFrame((f) => f.type === 'status' && f.status === 'admitted');
      const offer = await join.waitFrame((f) => f.type === 'signal' && (f.data as SignalData).sdp?.type === 'offer');
      expect(offer).toBeDefined();

      const hello = await viewer.waitFor((channel) => channel === 'control');
      expect(hello.payload).toEqual({
        kind: 'hello',
        hello: { v: 1, scopeKinds: ['conversation'], scope: { kind: 'conversation', conversationId: CONVERSATION } },
      });

      const history = (await viewer.waitFor((channel) => channel === 'conversation')).payload as ConversationPayload;
      expect(history.kind === 'history' ? history.messages.map((m) => m.text) : null).toEqual([
        'first fixture message',
        'second fixture message',
      ]);

      // A live delta arrives as an append.
      await vi.waitFor(() => {
        if (!watchCallback) throw new Error('watch not started');
      }, WAIT);
      void watchCallback?.(delta('live message'));
      const append = await viewer.waitFor(
        (channel, envelope) => channel === 'conversation' && (envelope.payload as ConversationPayload).kind === 'append',
      );
      expect(append.payload).toMatchObject({ kind: 'append', message: { id: 'm3', text: 'live message' } });
      expect(append.streamId).toBe(CONVERSATION);

      // Kick: the join socket closes 4010, the peer connection goes down and the hub holds no peer.
      const closed = peerClosed(viewer);
      await manager.command(shortCode, { type: 'kick', githubId: VIEWER_A.id });
      expect(await join.waitClose()).toBe(4010);
      await closed;
      expect((hub as PeerHub | null)?.peerCount()).toBe(0);
    } finally {
      manager.stop();
      await viewer.close();
    }
  }, SLOW);
});
