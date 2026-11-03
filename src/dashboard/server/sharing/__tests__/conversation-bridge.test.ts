import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ConversationPayload } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParseResult } from '../../services/conversation/types.js';
import {
  ConversationBridge,
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
