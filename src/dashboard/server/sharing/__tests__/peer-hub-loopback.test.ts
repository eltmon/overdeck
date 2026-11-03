/**
 * A real PeerHub on werift talking to a werift LoopbackViewer over loopback UDP (PRD PAN-4474 WI-7),
 * with a real ConversationBridge that parses a JSONL fixture through the production parser. Real
 * timers (the subject is real UDP I/O); every wait resolves on an event.
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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'peer-hub-loopback-'));
});

afterEach(async () => {
  hub?.close();
  hub = null;
  await viewer?.close();
  viewer = null;
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
      terminal: { attach: async () => () => undefined, close: () => undefined },
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
