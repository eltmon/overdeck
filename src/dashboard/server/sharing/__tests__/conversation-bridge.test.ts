import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ConversationPayload } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParseResult } from '../../services/conversation/types.js';
import {
  ConversationBridge,
  MAX_PENDING_AUTHORS,
  resolveClaudeSessionFile,
  type ConversationBridgeDeps,
  type ConversationSink,
} from '../conversation-bridge.js';

const mocks = vi.hoisted(() => ({
  runDashboardDbJob: vi.fn(),
  readLauncherPinnedSessionId: vi.fn(),
  sessionFilePath: vi.fn(),
}));

vi.mock('../../services/dashboard-db-task.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runDashboardDbJob: mocks.runDashboardDbJob,
}));
vi.mock('../../../../lib/agents/transcript-resolver.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readLauncherPinnedSessionId: mocks.readLauncherPinnedSessionId,
}));
vi.mock('../../../../lib/runtimes/storage/claude-code.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sessionFilePath: mocks.sessionFilePath,
}));

function message(id: string, text: string, extra: Record<string, unknown> = {}): ChatMessage {
  return { id, role: 'assistant', text, createdAt: '2026-11-03T00:00:00Z', ...extra } as ChatMessage;
}

function parseResult(messages: ChatMessage[], byteOffset: number): ParseResult {
  return {
    messages,
    workLog: [],
    byteOffset,
    streaming: false,
    totalCost: 0,
    totalTokens: 0,
    latestAssistantUsage: null,
    observedEffort: null,
    contextBoundaryOffset: 0,
    contextActiveBytes: 0,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: messages.length,
    mtimeMs: 0,
  };
}

class RecordingSink implements ConversationSink {
  readonly payloads: ConversationPayload[] = [];
  send(payload: ConversationPayload): void {
    this.payloads.push(payload);
  }
}

interface Harness {
  deps: ConversationBridgeDeps;
  resolveSessionFile: ReturnType<typeof vi.fn>;
  parseInitial: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emit(result: ParseResult): void;
  watchCalls(): number;
}

function harness(initial: ParseResult, file: string | null = '/tmp/session.jsonl'): Harness {
  let callback: ((result: ParseResult) => void | Promise<void>) | null = null;
  let watchCalls = 0;
  const stop = vi.fn();
  const resolveSessionFile = vi.fn(async () => file);
  const parseInitial = vi.fn(async () => initial);
  const deps: ConversationBridgeDeps = {
    resolveSessionFile,
    parseInitial,
    watch: (_file, cb) => {
      watchCalls++;
      callback = cb;
      return { stop };
    },
  };
  return {
    deps,
    resolveSessionFile,
    parseInitial,
    stop,
    emit: (result) => void callback?.(result),
    watchCalls: () => watchCalls,
  };
}

describe('ConversationBridge', () => {
  it('sends one history with the initial messages in order, allow-listed', async () => {
    const h = harness(parseResult([message('a', 'one', { rawContent: [1] }), message('b', 'two')], 100));
    const sink = new RecordingSink();
    await new ConversationBridge('conv-a', h.deps).attach(sink);
    expect(sink.payloads).toHaveLength(1);
    const history = sink.payloads[0];
    expect(history?.kind).toBe('history');
    if (history?.kind !== 'history') return;
    expect(history.messages.map((m) => m.id)).toEqual(['a', 'b']);
    for (const m of history.messages) expect(Object.keys(m).sort()).toEqual(['createdAt', 'id', 'role', 'text']);
  });

  it('sends append for a new id, update for changed text, and nothing for an unchanged message', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const sink = new RecordingSink();
    await new ConversationBridge('conv-a', h.deps).attach(sink);
    h.emit(parseResult([message('a', 'one'), message('b', 'two')], 150));
    h.emit(parseResult([message('b', 'two more')], 180));
    h.emit(parseResult([message('b', 'two more')], 190));
    expect(sink.payloads.slice(1)).toEqual([
      { kind: 'append', message: { id: 'b', role: 'assistant', text: 'two', createdAt: '2026-11-03T00:00:00Z' } },
      { kind: 'update', message: { id: 'b', role: 'assistant', text: 'two more', createdAt: '2026-11-03T00:00:00Z' } },
    ]);
  });

  it('sends a new history after a non-shrinking reset', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const sink = new RecordingSink();
    await new ConversationBridge('conv-a', h.deps).attach(sink);
    h.emit(parseResult([message('x', 'new'), message('y', 'newer')], 50));
    expect(sink.payloads.slice(1)).toEqual([
      {
        kind: 'history',
        messages: [
          { id: 'x', role: 'assistant', text: 'new', createdAt: '2026-11-03T00:00:00Z' },
          { id: 'y', role: 'assistant', text: 'newer', createdAt: '2026-11-03T00:00:00Z' },
        ],
      },
    ]);
  });

  it('merges a shrinking reset without a history', async () => {
    const h = harness(parseResult([message('a', 'one'), message('b', 'two')], 100));
    const sink = new RecordingSink();
    await new ConversationBridge('conv-a', h.deps).attach(sink);
    h.emit(parseResult([message('a', 'one changed')], 50));
    expect(sink.payloads.slice(1)).toEqual([
      { kind: 'update', message: { id: 'a', role: 'assistant', text: 'one changed', createdAt: '2026-11-03T00:00:00Z' } },
    ]);
  });

  it('starts once for concurrent attaches', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const bridge = new ConversationBridge('conv-a', h.deps);
    const first = new RecordingSink();
    const second = new RecordingSink();
    await Promise.all([bridge.attach(first), bridge.attach(second)]);
    expect(h.resolveSessionFile).toHaveBeenCalledTimes(1);
    expect(h.parseInitial).toHaveBeenCalledTimes(1);
    expect(h.watchCalls()).toBe(1);
    expect(first.payloads.map((p) => p.kind)).toEqual(['history']);
    expect(second.payloads.map((p) => p.kind)).toEqual(['history']);
  });

  it('gives a later sink the current list as history', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const bridge = new ConversationBridge('conv-a', h.deps);
    await bridge.attach(new RecordingSink());
    h.emit(parseResult([message('b', 'two')], 150));
    const later = new RecordingSink();
    await bridge.attach(later);
    expect(later.payloads).toHaveLength(1);
    const history = later.payloads[0];
    expect(history?.kind === 'history' ? history.messages.map((m) => m.id) : null).toEqual(['a', 'b']);
  });

  it('stops the watcher when the last sink detaches and restarts on the next attach', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const bridge = new ConversationBridge('conv-a', h.deps);
    const detachFirst = await bridge.attach(new RecordingSink());
    const detachSecond = await bridge.attach(new RecordingSink());
    detachFirst();
    expect(h.stop).not.toHaveBeenCalled();
    detachSecond();
    expect(h.stop).toHaveBeenCalledTimes(1);
    await bridge.attach(new RecordingSink());
    expect(h.parseInitial).toHaveBeenCalledTimes(2);
  });

  it('sends unavailable when no transcript resolves and retries on the next attach', async () => {
    const h = harness(parseResult([], 0), null);
    const bridge = new ConversationBridge('conv-a', h.deps);
    const sink = new RecordingSink();
    await bridge.attach(sink);
    expect(sink.payloads).toEqual([{ kind: 'unavailable', reason: 'transcript_not_found' }]);
    await bridge.attach(new RecordingSink());
    expect(h.resolveSessionFile).toHaveBeenCalledTimes(2);
    expect(h.parseInitial).not.toHaveBeenCalled();
  });

  it('sends unavailable when the initial parse throws', async () => {
    const h = harness(parseResult([], 0));
    h.parseInitial.mockRejectedValueOnce(new Error('parse failed'));
    const sink = new RecordingSink();
    await new ConversationBridge('conv-a', h.deps).attach(sink);
    expect(sink.payloads).toEqual([{ kind: 'unavailable', reason: 'transcript_not_found' }]);
  });

  it('drops a throwing sink and keeps feeding the others', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const bridge = new ConversationBridge('conv-a', h.deps);
    const throwing = { send: vi.fn() };
    await bridge.attach(throwing);
    const healthy = new RecordingSink();
    await bridge.attach(healthy);
    throwing.send.mockImplementation(() => {
      throw new Error('closed');
    });
    h.emit(parseResult([message('b', 'two')], 150));
    h.emit(parseResult([message('c', 'three')], 200));
    expect(throwing.send).toHaveBeenCalledTimes(2);
    expect(healthy.payloads.map((p) => p.kind)).toEqual(['history', 'append', 'append']);
  });

  it('stops the watcher and ignores later results after close', async () => {
    const h = harness(parseResult([message('a', 'one')], 100));
    const bridge = new ConversationBridge('conv-a', h.deps);
    const sink = new RecordingSink();
    await bridge.attach(sink);
    bridge.close();
    h.emit(parseResult([message('b', 'two')], 150));
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(sink.payloads).toHaveLength(1);
  });
});

describe('ConversationBridge author attribution', () => {
  const alice = { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/7' };
  const bob = { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/8' };
  const user = (id: string, text: string) => message(id, text, { role: 'user' });

  async function attached() {
    const h = harness(parseResult([message('a', 'one')], 100));
    const bridge = new ConversationBridge('conv-a', h.deps);
    const sink = new RecordingSink();
    await bridge.attach(sink);
    return { h, bridge, sink };
  }

  function authorsOf(sink: RecordingSink): Array<[string, string | undefined]> {
    return sink.payloads.flatMap((payload) =>
      payload.kind === 'append' || payload.kind === 'update' ? [[payload.message.id, payload.message.author?.login] as [string, string | undefined]] : [],
    );
  }

  it('stamps the correlated appended user message and keeps it in a later history', async () => {
    const { h, bridge, sink } = await attached();
    bridge.expectAuthor('Fix it', alice);
    h.emit(parseResult([message('a', 'one'), user('u1', 'Fix it\n')], 150));
    expect(sink.payloads.at(-1)).toEqual({
      kind: 'append',
      message: { id: 'u1', role: 'user', text: 'Fix it\n', author: alice, createdAt: '2026-11-03T00:00:00Z' },
    });
    h.emit(parseResult([user('u1', 'Fix it\n'), message('x', 'reply'), message('y', 'more')], 50));
    const history = sink.payloads.at(-1);
    expect(history?.kind).toBe('history');
    if (history?.kind !== 'history') return;
    expect(history.messages.find((m) => m.id === 'u1')?.author).toEqual(alice);
    const later = new RecordingSink();
    await bridge.attach(later);
    const laterHistory = later.payloads[0];
    expect(laterHistory?.kind === 'history' ? laterHistory.messages.find((m) => m.id === 'u1')?.author : null).toEqual(alice);
  });

  it('does not stamp an assistant message or a user message with different text', async () => {
    const { h, bridge, sink } = await attached();
    bridge.expectAuthor('Fix it', alice);
    h.emit(parseResult([message('b', 'Fix it'), user('u1', 'Something else')], 150));
    h.emit(parseResult([user('u2', 'Fix it')], 180));
    expect(authorsOf(sink)).toEqual([['b', undefined], ['u1', undefined], ['u2', 'alice']]);
  });

  it('does not stamp after the expectation is cancelled', async () => {
    const { h, bridge, sink } = await attached();
    const cancel = bridge.expectAuthor('Fix it', alice);
    cancel();
    h.emit(parseResult([user('u1', 'Fix it')], 150));
    expect(authorsOf(sink)).toEqual([['u1', undefined]]);
  });

  it('stamps two expectations with the same text on two user messages in order', async () => {
    const { h, bridge, sink } = await attached();
    bridge.expectAuthor('Same', alice);
    bridge.expectAuthor('Same', bob);
    h.emit(parseResult([user('u1', 'Same'), user('u2', 'Same'), user('u3', 'Same')], 150));
    expect(authorsOf(sink)).toEqual([['u1', 'alice'], ['u2', 'bob'], ['u3', undefined]]);
  });

  it('drops the oldest expectation past the cap', async () => {
    const { h, bridge, sink } = await attached();
    for (let i = 0; i <= MAX_PENDING_AUTHORS; i++) bridge.expectAuthor(`p${i}`, alice);
    h.emit(parseResult([user('u0', 'p0'), user('u1', 'p1')], 150));
    expect(authorsOf(sink)).toEqual([['u0', undefined], ['u1', 'alice']]);
  });
});

describe('resolveClaudeSessionFile', () => {
  let dir: string;

  const conversation = (overrides: Record<string, unknown> = {}) => ({
    name: 'conv-a',
    tmuxSession: 'conv-a-tmux',
    cwd: '/home/user/project',
    claudeSessionId: 'stored-id',
    title: null,
    ...overrides,
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bridge-resolve-'));
    mocks.runDashboardDbJob.mockReset();
    mocks.readLauncherPinnedSessionId.mockReset().mockResolvedValue(null);
    mocks.sessionFilePath.mockReset().mockImplementation((_cwd: string, id: string) => join(dir, `${id}.jsonl`));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null for an unknown conversation', async () => {
    mocks.runDashboardDbJob.mockResolvedValue(null);
    expect(await resolveClaudeSessionFile('conv-a')).toBeNull();
  });

  it('returns null without a pinned or stored session id', async () => {
    mocks.runDashboardDbJob.mockResolvedValue(conversation({ claudeSessionId: null }));
    expect(await resolveClaudeSessionFile('conv-a')).toBeNull();
  });

  it('prefers the launcher-pinned session id', async () => {
    mocks.runDashboardDbJob.mockResolvedValue(conversation());
    mocks.readLauncherPinnedSessionId.mockResolvedValue('pinned-id');
    await resolveClaudeSessionFile('conv-a');
    expect(mocks.readLauncherPinnedSessionId).toHaveBeenCalledWith('conv-a-tmux');
    expect(mocks.sessionFilePath).toHaveBeenCalledWith('/home/user/project', 'pinned-id');
  });

  it('returns null for a Pi session file', async () => {
    mocks.runDashboardDbJob.mockResolvedValue(conversation());
    mocks.sessionFilePath.mockReturnValue('/home/user/.overdeck/agents/x/sessions/stored-id.jsonl');
    expect(await resolveClaudeSessionFile('conv-a')).toBeNull();
  });

  it('returns a path whose file does not exist yet', async () => {
    mocks.runDashboardDbJob.mockResolvedValue(conversation());
    expect(await resolveClaudeSessionFile('conv-a')).toBe(join(dir, 'stored-id.jsonl'));
  });
});
