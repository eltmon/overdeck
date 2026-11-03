/**
 * A real PeerHub on werift talking to a werift LoopbackViewer over loopback UDP (PRD PAN-4474 WI-7),
 * with a real ConversationBridge that parses a JSONL fixture through the production parser. Real
 * timers (the subject is real UDP I/O); every wait resolves on an event. PAN-4476 adds two viewers
 * exchanging a draft and a contributor submit acknowledged queued, then sent.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ConversationPayload, RoomSnapshot, ShareScope, SharedEnvelope } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RTCPeerConnection } from 'werift';

import { parseEntireConversation } from '../../services/conversation/parser.js';
import type { ParseResult } from '../../services/conversation/types.js';
import { ConversationBridge } from '../conversation-bridge.js';
import { PeerHub, type HubPeerConnection } from '../peer-hub.js';
import { LoopbackViewer } from './loopback-viewer.js';

const TIMEOUT_MS = 20_000;
const scope: ShareScope = { kind: 'conversation', conversationId: 'conv-a' };

function userLine(text: string, uuid: string, timestamp: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp, uuid });
}

function snapshot(): RoomSnapshot {
  return {
    shortCode: 'ABC123',
    scope,
    dataOwner: { githubId: 1, login: 'owner', avatarUrl: 'https://a/1' },
    controllerGithubId: 1,
    hostConnected: true,
    participants: [
      { githubId: 7, login: 'viewer', avatarUrl: 'https://a/7', state: 'admitted', contributor: false, connected: true },
    ],
    blocked: [],
  };
}

function delta(messages: ChatMessage[]): ParseResult {
  return {
    messages,
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

const payloadOf = (envelope: SharedEnvelope) => envelope.payload as ConversationPayload;

let dir: string;
let hub: PeerHub | null = null;
let viewer: LoopbackViewer | null = null;
let others: LoopbackViewer[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'peer-hub-loopback-'));
});

afterEach(async () => {
  hub?.close();
  hub = null;
  await viewer?.close();
  viewer = null;
  for (const other of others.splice(0)) await other.close();
  await rm(dir, { recursive: true, force: true });
});

/** Starts a hub and a loopback viewer joined by an in-memory signaling relay; resolves the watch callback. */
async function start(): Promise<{ emit: (result: ParseResult) => void; viewer: LoopbackViewer }> {
  const file = join(dir, 'session.jsonl');
  await writeFile(
    file,
    `${userLine('first fixture message', 'u-1', '2026-11-03T00:00:00.000Z')}\n${userLine('second fixture message', 'u-2', '2026-11-03T00:00:01.000Z')}\n`,
  );
  let callback: ((result: ParseResult) => void | Promise<void>) | null = null;
  const bridge = new ConversationBridge('conv-a', {
    resolveSessionFile: async () => file,
    parseInitial: (sessionFile) => parseEntireConversation(sessionFile, { flushPendingToolUse: false }),
    watch: (_file, cb) => {
      callback = cb;
      return { stop: () => undefined };
    },
  });
  const loopback = new LoopbackViewer();
  viewer = loopback;
  const peerHub = new PeerHub(
    {
      shortCode: 'ABC123',
      scope,
      sendFrame: (frame) => {
        if (frame.type === 'signal') setImmediate(() => void loopback.onSignal(frame.data));
        if (frame.type === 'ice-servers') setImmediate(() => peerHub.onIceServers([]));
        return true;
      },
    },
    {
      createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as HubPeerConnection,
      bridge,
      queue: {
        deliver: async () => ({ status: 200, body: {} }),
        activity: async () => ({ working: false, lastMessageId: null }),
        now: () => Date.now(),
      },
      streamLabel: async () => 'Fixture',
      now: () => Date.now(),
    },
  );
  hub = peerHub;
  loopback.onOutgoingSignal((data) => setImmediate(() => peerHub.onSignal(7, data)));
  peerHub.admit(7);
  peerHub.onSnapshot(snapshot());
  return {
    emit: (result) => {
      if (!callback) throw new Error('watch not started');
      void callback(result);
    },
    viewer: loopback,
  };
}

/** Starts a hub with contributor 7 and viewer 8 on two loopback viewers; `deliver` records each prompt. */
async function startTwo(): Promise<{ a: LoopbackViewer; b: LoopbackViewer; delivered: string[] }> {
  const delivered: string[] = [];
  const bridge = new ConversationBridge('conv-a', {
    resolveSessionFile: async () => null,
    parseInitial: async () => delta([]),
    watch: () => ({ stop: () => undefined }),
  });
  const a = new LoopbackViewer();
  const b = new LoopbackViewer();
  others = [a, b];
  const byId = new Map([[7, a], [8, b]]);
  const peerHub = new PeerHub(
    {
      shortCode: 'ABC123',
      scope,
      sendFrame: (frame) => {
        if (frame.type === 'signal') setImmediate(() => void byId.get(frame.githubId)?.onSignal(frame.data));
        if (frame.type === 'ice-servers') setImmediate(() => peerHub.onIceServers([]));
        return true;
      },
    },
    {
      createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as HubPeerConnection,
      bridge,
      queue: {
        deliver: async (text) => {
          delivered.push(text);
          return { status: 200, body: {} };
        },
        activity: async () => ({ working: false, lastMessageId: null }),
        now: () => Date.now(),
      },
      streamLabel: async () => 'Fixture',
      now: () => Date.now(),
    },
  );
  hub = peerHub;
  for (const [githubId, v] of byId) v.onOutgoingSignal((data) => setImmediate(() => peerHub.onSignal(githubId, data)));
  peerHub.admit(7);
  peerHub.admit(8);
  const base = snapshot();
  peerHub.onSnapshot({
    ...base,
    participants: [
      { githubId: 7, login: 'alice', avatarUrl: 'https://a/7', state: 'admitted', contributor: true, connected: true },
      { githubId: 8, login: 'bob', avatarUrl: 'https://a/8', state: 'admitted', contributor: false, connected: true },
    ],
  });
  return { a, b, delivered };
}

describe('PeerHub over werift loopback', () => {
  it('streams the host hello, the history, then a live append', async () => {
    const { emit, viewer: v } = await start();
    const hello = await v.waitFor((channel) => channel === 'control');
    expect(hello.payload).toEqual({ kind: 'hello', hello: { v: 1, scopeKinds: ['conversation'], scope } });

    const history = payloadOf(await v.waitFor((channel) => channel === 'conversation'));
    expect(history.kind).toBe('history');
    expect(history.kind === 'history' ? history.messages.map((m) => m.text) : null).toEqual([
      'first fixture message',
      'second fixture message',
    ]);

    emit(delta([{ id: 'm3', role: 'assistant', text: 'third message', createdAt: '2026-11-03T00:00:02.000Z' }]));
    const append = payloadOf(
      await v.waitFor((channel, envelope) => channel === 'conversation' && payloadOf(envelope).kind === 'append'),
    );
    expect(append).toEqual({
      kind: 'append',
      message: { id: 'm3', role: 'assistant', text: 'third message', createdAt: '2026-11-03T00:00:02.000Z' },
    });

    const conversation = v.envelopes.get('conversation') ?? [];
    expect(conversation.map((envelope) => envelope.seq)).toEqual([1, 2]);
    for (const list of v.envelopes.values()) {
      for (const envelope of list) expect(envelope.streamId).toBe('conv-a');
    }
  }, TIMEOUT_MS);

  it('reassembles a 100,000-character message sent as fragments', async () => {
    const { emit, viewer: v } = await start();
    await v.waitFor((channel) => channel === 'conversation');
    const text = 'z'.repeat(100_000);
    emit(delta([{ id: 'big', role: 'assistant', text, createdAt: '2026-11-03T00:00:02.000Z' }]));
    const append = payloadOf(
      await v.waitFor((channel, envelope) => channel === 'conversation' && payloadOf(envelope).kind === 'append'),
    );
    expect(append.kind === 'append' ? append.message.text : null).toBe(text);
  }, TIMEOUT_MS);
});

describe('PeerHub drafts and submits over werift loopback (PAN-4476)', () => {
  it('relays a contributor draft to the other viewer and acknowledges a submit queued, then sent', async () => {
    const { a, b, delivered } = await startTwo();
    // Presence arrives only after the hello negotiated, so the hub now reads A's drafts and submits.
    await a.waitFor((channel) => channel === 'presence');
    a.send('drafts', { text: 'Try the fix', authorGithubId: 999 });
    const draft = await b.waitFor((channel) => channel === 'drafts');
    expect(draft.payload).toEqual({ authorGithubId: 7, authorLogin: 'alice', text: 'Try the fix', updatedAt: expect.any(Number) });

    a.send('control', { kind: 'submit', clientId: 'c-1', text: 'Run the tests' });
    const queued = await a.waitFor((channel, envelope) => channel === 'control' && (envelope.payload as { status?: string }).status === 'queued');
    expect(queued.payload).toEqual({ kind: 'submit-ack', clientId: 'c-1', status: 'queued', position: 1 });
    const sent = await a.waitFor((channel, envelope) => channel === 'control' && (envelope.payload as { status?: string }).status === 'sent');
    expect(sent.payload).toEqual({ kind: 'submit-ack', clientId: 'c-1', status: 'sent' });
    expect(delivered).toEqual(['Run the tests']);
    expect(a.envelopes.get('drafts') ?? []).toEqual([]);
  }, TIMEOUT_MS);
});
