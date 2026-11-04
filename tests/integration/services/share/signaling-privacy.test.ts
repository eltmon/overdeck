/**
 * The share service never sees content (PRD PAN-4482 WI-3; PAN-658 NFR-1 and AC-17).
 *
 * One share runs end to end on real workerd and real werift: a ShareManager with a PeerHub on the host
 * side, and two JoinManagers with LoopbackViewers on the viewer side, all talking to the bundled share
 * Worker through `startShareWorker`. A unique canary sits in every kind of content: history, a live
 * append, the stream label, a draft, a contributor submit, a host send, a viewer-controller send and
 * both terminal payloads. `SignalingCapture` records every frame and HTTP body the two local servers
 * exchange with the share service. The test proves each canary arrived over a DataChannel (positive
 * control), that none appears in signaling (plain, case-folded or base64), that every frame matches the
 * documented protocol, and that the capture sat on the live path. Viewer B stays in the lobby throughout
 * and receives only `status lobby` until the share ends with 4004 (AC-4).
 * Every wait resolves on an event or `vi.waitFor`; nothing sleeps.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import type {
  ConversationPayload,
  ControlPayload,
  JoinEvent,
  JoinState,
  PresencePayload,
  RoomSnapshot,
  SignalData,
  TerminalPayload,
} from '@overdeck/contracts';

import type { AccountRecord } from '../../../../src/lib/account/store.js';
import { putShareRecord, readShareRecords, removeShareRecord } from '../../../../src/lib/sharing/share-record.js';
import { defaultOpenSocket, ShareManager } from '../../../../src/dashboard/server/services/share-host.js';
import { JoinManager } from '../../../../src/dashboard/server/services/share-join.js';
import { parseEntireConversation } from '../../../../src/dashboard/server/services/conversation/parser.js';
import type { ParseResult } from '../../../../src/dashboard/server/services/conversation/types.js';
import { ConversationBridge } from '../../../../src/dashboard/server/sharing/conversation-bridge.js';
import { PeerHub, type HubPeerConnection } from '../../../../src/dashboard/server/sharing/peer-hub.js';
import type { TerminalSink } from '../../../../src/dashboard/server/sharing/terminal-bridge.js';
import { LoopbackViewer } from '../../../../src/dashboard/server/sharing/__tests__/loopback-viewer.js';
import { startShareWorker, tokenFor, type ShareTestUser, type ShareWorker } from '../../../helpers/share/share-worker.js';
import { findLeaks, frameViolations, SignalingCapture, summarize } from '../../../helpers/share/signaling-capture.js';

const OWNER: ShareTestUser = { id: 1, login: 'owner' };
const VIEWER_A: ShareTestUser = { id: 100, login: 'alice' };
const VIEWER_B: ShareTestUser = { id: 200, login: 'bob' };
const CONVERSATION_ID = 'conv-privacy-1';
const WAIT = { timeout: 30_000, interval: 25 };

const run = randomUUID();
const CANARY = {
  history: `PRIVACY-CANARY-HISTORY-${run}`,
  append: `PRIVACY-CANARY-APPEND-${run}`,
  label: `PRIVACY-CANARY-LABEL-${run}`,
  draft: `PRIVACY-CANARY-DRAFT-${run}`,
  submit: `PRIVACY-CANARY-SUBMIT-${run}`,
  hostSend: `PRIVACY-CANARY-HOSTSEND-${run}`,
  viewerSend: `PRIVACY-CANARY-VIEWERSEND-${run}`,
  terminalSnapshot: `PRIVACY-CANARY-TERMINALSNAPSHOT-${run}`,
  terminalOutput: `PRIVACY-CANARY-TERMINALOUTPUT-${run}`,
} as const;

function account(user: ShareTestUser): AccountRecord {
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

let worker: ShareWorker;
let home = '';
const originalHome = process.env.OVERDECK_HOME;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'overdeck-share-privacy-home-'));
  process.env.OVERDECK_HOME = home;
  worker = await startShareWorker({ users: [OWNER, VIEWER_A, VIEWER_B] });
}, 180_000);

afterAll(async () => {
  await worker?.dispose();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (home) await rm(home, { recursive: true, force: true });
}, 60_000);

describe('signaling privacy on real workerd and werift (PAN-4482, NFR-1, AC-17)', () => {
  it('every content kind arrives over a DataChannel and none crosses the share service', async () => {
    const file = join(home, `${CONVERSATION_ID}.jsonl`);
    await writeFile(
      file,
      `${userLine(CANARY.history, 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine('second fixture message', 'u-2', '2026-11-03T00:00:01.000Z')}\n`,
    );
    const capture = new SignalingCapture();
    const delivered: string[] = [];
    let watchCallback: ((result: ParseResult) => void | Promise<void>) | null = null;
    let terminalSink: TerminalSink | null = null;

    const manager = new ShareManager({
      readAccount: async () => account(OWNER),
      readShareUrl: async () => ({ url: worker.url }),
      createRoom: capture.createRoom,
      deleteRoom: capture.deleteRoom,
      records: { read: readShareRecords, put: putShareRecord, remove: removeShareRecord },
      openSocket: capture.openSocket('host', OWNER.login, defaultOpenSocket),
      now: () => new Date(),
      createHub: (ctx) =>
        new PeerHub(ctx, {
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
            deliver: async (text) => {
              delivered.push(text);
              return { status: 200, body: {} };
            },
            // A new lastMessageId per delivery lets the queue see each turn start at once.
            activity: async () => ({ working: false, lastMessageId: `delivered-${delivered.length}` }),
            now: () => Date.now(),
          },
          terminal: {
            attach: async (sink) => {
              terminalSink = sink;
              sink.send({ kind: 'snapshot', cols: 80, rows: 24, data: CANARY.terminalSnapshot });
              return () => {
                terminalSink = null;
              };
            },
            close: () => undefined,
          },
          streamLabel: async () => CANARY.label,
          now: () => Date.now(),
        }),
    });
    const viewerJoins = (user: ShareTestUser) =>
      new JoinManager({
        readAccount: async () => account(user),
        readShareUrl: async () => ({ url: worker.url }),
        openSocket: capture.openSocket('viewer', user.login, defaultOpenSocket),
        now: () => Date.now(),
      });
    const joinsA = viewerJoins(VIEWER_A);
    const joinsB = viewerJoins(VIEWER_B);
    const subscribers: Subscriber[] = [];

    const snapshotWhere = (shortCode: string, match: (s: RoomSnapshot) => boolean) =>
      vi.waitFor(async () => {
        const view = (await manager.list()).find((v) => v.shortCode === shortCode);
        if (view?.connection !== 'connected' || !view.snapshot || !match(view.snapshot)) throw new Error('waiting for snapshot');
        return view.snapshot;
      }, WAIT);

    try {
      // 1. Create the share; the host socket connects.
      const created = await manager.create({ kind: 'conversation', conversationId: CONVERSATION_ID });
      expect(created.kind).toBe('created');
      if (created.kind !== 'created') return;
      const { shortCode } = created.view;
      await snapshotWhere(shortCode, (s) => s.hostConnected);

      // 2. Both viewers join and wait in the lobby.
      expect((await joinsA.join(shortCode)).kind).toBe('created');
      expect((await joinsB.join(shortCode)).kind).toBe('created');
      const a = new Subscriber(joinsA, shortCode);
      const b = new Subscriber(joinsB, shortCode);
      subscribers.push(a, b);
      await a.waitState('lobby');
      await b.waitState('lobby');
      const inLobby = (s: RoomSnapshot, id: number) => s.participants.some((p) => p.githubId === id && p.state === 'lobby');
      await snapshotWhere(shortCode, (s) => inLobby(s, VIEWER_A.id) && inLobby(s, VIEWER_B.id));

      // 3. Admit A as a contributor.
      expect((await manager.command(shortCode, { type: 'admit', githubId: VIEWER_A.id, contributor: true })).status).toBe(202);
      await a.waitState('admitted');
      const viewer = a.viewer;

      // 4. History and the stream label arrive over DataChannels.
      const history = (await viewer.waitFor((ch) => ch === 'conversation')).payload as ConversationPayload;
      expect(history.kind === 'history' ? history.messages.map((m) => m.text) : null).toContain(CANARY.history);
      const presence = await viewer.waitFor(
        (ch, env) => ch === 'presence' && (env.payload as PresencePayload).streams[0]?.label === CANARY.label,
      );
      expect((presence.payload as PresencePayload).streams[0]?.label).toBe(CANARY.label);

      // 5. A live append.
      await vi.waitFor(() => {
        if (!watchCallback) throw new Error('watch not started');
      }, WAIT);
      void watchCallback!(delta(CANARY.append));
      const append = await viewer.waitFor(
        (ch, env) => ch === 'conversation' && (env.payload as ConversationPayload).kind === 'append',
      );
      expect(append.payload).toMatchObject({ kind: 'append', message: { text: CANARY.append } });

      // 6. A draft reaches the host.
      await vi.waitFor(() => viewer.send('drafts', { text: CANARY.draft }), WAIT);
      await vi.waitFor(async () => {
        const drafts = (await manager.list())[0]?.drafts ?? [];
        if (!drafts.some((d) => d.text === CANARY.draft)) throw new Error('waiting for the draft');
      }, WAIT);

      // 7. A contributor submit is delivered.
      viewer.send('control', { kind: 'submit', clientId: 'submit-1', text: CANARY.submit });
      await viewer.waitFor((ch, env) => {
        const p = env.payload as ControlPayload;
        return ch === 'control' && p.kind === 'submit-ack' && p.clientId === 'submit-1' && p.status === 'sent';
      });
      expect(delivered).toContain(CANARY.submit);

      // 8. A host controller send is delivered.
      expect((await manager.sendPrompt(shortCode, { text: CANARY.hostSend })).status).toBe(202);
      await vi.waitFor(() => {
        if (!delivered.includes(CANARY.hostSend)) throw new Error('waiting for the host send');
      }, WAIT);

      // 9. Hand control to A; A sends; the owner reclaims.
      expect((await manager.command(shortCode, { type: 'set-controller', githubId: VIEWER_A.id })).status).toBe(202);
      await viewer.waitFor((ch, env) => ch === 'presence' && (env.payload as PresencePayload).controllerGithubId === VIEWER_A.id);
      viewer.send('control', { kind: 'controller-send', clientId: 'send-1', text: CANARY.viewerSend });
      await viewer.waitFor((ch, env) => {
        const p = env.payload as ControlPayload;
        return ch === 'control' && p.kind === 'command-ack' && p.clientId === 'send-1' && p.status === 'accepted';
      });
      await vi.waitFor(() => {
        if (!delivered.includes(CANARY.viewerSend)) throw new Error('waiting for the viewer send');
      }, WAIT);
      expect((await manager.command(shortCode, { type: 'set-controller', githubId: OWNER.id })).status).toBe(202);

      // 10. The read-only terminal: snapshot, then live output.
      viewer.send('control', { kind: 'terminal-watch', watch: true });
      const snapshot = await viewer.waitFor((ch, env) => ch === 'terminal' && (env.payload as TerminalPayload).kind === 'snapshot');
      expect(snapshot.payload).toMatchObject({ kind: 'snapshot', data: CANARY.terminalSnapshot });
      await vi.waitFor(() => {
        if (!terminalSink) throw new Error('terminal not attached');
      }, WAIT);
      terminalSink!.send({ kind: 'output', data: CANARY.terminalOutput });
      const output = await viewer.waitFor((ch, env) => ch === 'terminal' && (env.payload as TerminalPayload).kind === 'output');
      expect(output.payload).toMatchObject({ kind: 'output', data: CANARY.terminalOutput });

      // 11. End the share; both joins end and the lobby socket closes with 4004.
      expect((await manager.end(shortCode)).status).toBe(204);
      await a.waitState('ended');
      await b.waitState('ended');
      await vi.waitFor(() => {
        if (!capture.entries.some((e) => e.kind === 'ws-close' && e.label === VIEWER_B.login && e.code === 4004)) {
          throw new Error('waiting for the lobby socket to close');
        }
      }, WAIT);

      // No canary and no undocumented frame or key crossed the share service.
      expect(findLeaks(capture.entries, Object.values(CANARY))).toEqual([]);
      expect(frameViolations(capture.entries)).toEqual([]);

      // The capture sat on the live path.
      const summary = summarize(capture.entries);
      expect(summary.offers).toBeGreaterThanOrEqual(1);
      expect(summary.answers).toBeGreaterThanOrEqual(1);
      expect(summary.hostCandidates).toBeGreaterThanOrEqual(1);
      expect(summary.viewerCandidates).toBeGreaterThanOrEqual(1);
      expect(summary.roomSnapshots).toBeGreaterThanOrEqual(1);
      expect(summary.posts).toBe(1);
      expect(summary.deletes).toBe(1);

      // The lobby viewer saw exactly one frame and no signal (AC-4).
      expect(capture.framesFor(VIEWER_B.login, 'from-service')).toEqual([{ type: 'status', status: 'lobby' }]);
      expect(b.signals()).toEqual([]);

      expect(delivered).toEqual([CANARY.submit, CANARY.hostSend, CANARY.viewerSend]);
    } finally {
      manager.stop();
      joinsA.stop();
      joinsB.stop();
      for (const subscriber of subscribers) await subscriber.viewer.close();
    }
  }, 240_000);
});
