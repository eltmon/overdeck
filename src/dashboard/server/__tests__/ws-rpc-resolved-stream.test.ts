import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect, Stream } from 'effect';

// Stub the transcript resolvers so the dispatch can be asserted on the exact
// arguments each one receives — the kimi case has to forward a workspace.
const resolverMock = vi.hoisted(() => ({
  resolveAgentHarness: vi.fn(async () => 'claude-code'),
  resolvePiSessionPath: vi.fn(async () => null),
  resolveCodexRolloutPath: vi.fn(async (): Promise<string | null> => null),
  resolveAcpTranscriptPath: vi.fn(async () => null),
  resolveKimiWirePath: vi.fn(async () => null),
  resolveJsonlPath: vi.fn(async () => null),
  listAgentTranscriptCandidates: vi.fn(async () => [] as Array<{ kind: 'claude'; path: string; model?: string }>),
  listAgentTranscriptWatchRoots: vi.fn(async () => [] as string[]),
  resolveAgentTranscriptCandidate: vi.fn(async () => null as { kind: 'claude'; path: string; model?: string } | null),
  readLauncherPinnedSessionId: vi.fn(async () => null),
}));
vi.mock('../../../lib/agents/transcript-resolver.js', () => resolverMock);
vi.mock('../services/dashboard-db-task.js', () => ({
  runDashboardDbJob: vi.fn(async (_operation: string, input: { sessionFile: string }) => {
    const { parseCodexConversationMessages } = await import('../services/codex-conversation-parser.js');
    return parseCodexConversationMessages(input.sessionFile);
  }),
}));

import {
  streamHarnessFullParseSnapshots,
  streamResolvedFullParseSnapshots,
  watchForAgentTranscriptCandidate,
} from '../ws-rpc.js';
import type { ParseResult } from '../services/conversation-service.js';

// PAN: a brand-new interactive pi/codex conversation writes no transcript until
// its first turn. The discovery loop must NOT sit on "Discovering conversation…"
// forever — when the transcript can't be resolved yet AND the conversation is
// interactive (unresolvedMeansEmpty=true), it should emit an empty/ready
// snapshot so the panel drops to the "type your first message" state, exactly
// like claude-code. For non-interactive callers (synthetic agent panels) the
// default is unchanged and it keeps announcing "discovering".

const emptyParse = vi.fn<(file: string) => Promise<ParseResult>>();

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('streamHarnessFullParseSnapshots — ACP dispatch', () => {
  it('leaves Claude sessions to the worker-backed incremental stream', () => {
    const stream = streamHarnessFullParseSnapshots('agent-pan-3950', 'claude-code', null, true);
    expect(stream).toBeNull();
  });

  it('creates a ready stream for an ACP conversation before its transcript exists', async () => {
    const stream = streamHarnessFullParseSnapshots(
      'agent-nonexistent-acp-stream',
      'acp',
      null,
      true,
    );

    expect(stream).not.toBeNull();
    const first = await Effect.runPromise(
      stream!.pipe(Stream.take(1), Stream.runCollect),
    );

    expect(Array.from(first)).toEqual([
      { kind: 'messages', messages: [], workLog: [], streaming: false, snapshot: true },
    ]);
  });

  // kimi-code returned null here, so the caller fell through to its
  // claude-jsonl check and served the discovering stream — a kimi conversation
  // showed "Discovering conversation…" forever even with a written wire.jsonl.
  it('creates a ready stream for a kimi-code conversation instead of returning null', async () => {
    const stream = streamHarnessFullParseSnapshots(
      'agent-nonexistent-kimi-stream',
      'kimi-code',
      null,
      true,
    );

    expect(stream).not.toBeNull();
    const first = await Effect.runPromise(
      stream!.pipe(Stream.take(1), Stream.runCollect),
    );

    expect(Array.from(first)).toEqual([
      { kind: 'messages', messages: [], workLog: [], streaming: false, snapshot: true },
    ]);
  });

  // resolveKimiWirePath derives the workspace from an AgentState row, which a
  // conversation does not have — without the forwarded cwd it returned null and
  // the panel showed the empty "How can I help you?" state over a live session.
  it('forwards the conversation cwd to the kimi wire resolver', async () => {
    resolverMock.resolveKimiWirePath.mockClear();
    const stream = streamHarnessFullParseSnapshots(
      'conv-20260730-5188',
      'kimi-code',
      null,
      true,
      '/home/test/Projects/overdeck',
    );

    await Effect.runPromise(stream!.pipe(Stream.take(1), Stream.runCollect));

    expect(resolverMock.resolveKimiWirePath).toHaveBeenCalledWith(
      'conv-20260730-5188',
      { workspaceOverride: '/home/test/Projects/overdeck' },
    );
  });

  it('omits the override for a kimi work agent, which resolves its own workspace', async () => {
    resolverMock.resolveKimiWirePath.mockClear();
    const stream = streamHarnessFullParseSnapshots('agent-pan-1837', 'kimi-code', null);

    await Effect.runPromise(stream!.pipe(Stream.take(1), Stream.runCollect));

    expect(resolverMock.resolveKimiWirePath).toHaveBeenCalledWith('agent-pan-1837', {});
  });
});

describe('streamResolvedFullParseSnapshots — unresolved transcript', () => {
  it('emits an empty ready snapshot (not discovering) when interactive and no transcript exists', async () => {
    const first = await Effect.runPromise(
      streamResolvedFullParseSnapshots(
        async () => null, // no transcript on disk yet
        emptyParse,
        null,
        true, // unresolvedMeansEmpty — interactive conversation
      ).pipe(Stream.take(1), Stream.runCollect),
    );

    expect(Array.from(first)).toEqual([
      { kind: 'messages', messages: [], workLog: [], streaming: false, snapshot: true },
    ]);
    expect(emptyParse).not.toHaveBeenCalled(); // never parses a file that doesn't exist
  });

  it('still announces "discovering" when the caller is not interactive (default)', async () => {
    const first = await Effect.runPromise(
      streamResolvedFullParseSnapshots(
        async () => null,
        emptyParse,
        null,
        // unresolvedMeansEmpty defaults to false
      ).pipe(Stream.take(1), Stream.runCollect),
    );

    expect(Array.from(first)).toEqual([{ kind: 'discovering' }]);
  });
});

describe('synthetic agent transcript discovery', () => {
  it('discovers from an initially empty candidate list and closes every watcher on unsubscribe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-agent-stream-'));
    const transcript = join(dir, 'delayed.jsonl');
    const candidate = { kind: 'claude' as const, path: transcript, model: 'claude-sonnet-4-6' };
    const watched: Array<{ path: string; listener: () => void; closed: boolean }> = [];
    let signalRegistered!: () => void;
    const registered = new Promise<void>((resolve) => { signalRegistered = resolve; });
    resolverMock.listAgentTranscriptCandidates.mockResolvedValue([]);
    resolverMock.listAgentTranscriptWatchRoots.mockResolvedValue([dir]);
    resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(null);
    const watch = vi.fn((path: string, _options: { recursive: boolean }, listener: () => void) => {
      const handle = { path, listener, closed: false };
      watched.push(handle);
      if (path === dir) signalRegistered();
      return { close: () => { handle.closed = true; } };
    });

    try {
      const eventsPromise = Effect.runPromise(
        watchForAgentTranscriptCandidate('agent-pan-3950', '', { watch }).pipe(Stream.take(1), Stream.runCollect),
      );
      await registered;
      expect(resolverMock.resolveAgentTranscriptCandidate).toHaveBeenCalledWith(
        'agent-pan-3950',
        '',
        {},
        [],
      );

      resolverMock.listAgentTranscriptCandidates.mockResolvedValue([candidate]);
      resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(candidate);
      watched.find(entry => entry.path === dir)!.listener();

      const events = Array.from(await eventsPromise);
      expect(events).toEqual([candidate]);
      expect(watched.length).toBeGreaterThan(0);
      expect(watched.every(entry => entry.closed)).toBe(true);
    } finally {
      resolverMock.listAgentTranscriptCandidates.mockResolvedValue([]);
      resolverMock.listAgentTranscriptWatchRoots.mockResolvedValue([]);
      resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(null);
      await rm(dir, { recursive: true, force: true });
    }
  });

  // PAN-3950 W6: a watch root whose fs.watch() attachment throws (e.g. the
  // directory disappears between listing and watch()) must not be abandoned
  // forever — it has to be retried the next time a surviving watcher fires.
  it('retries a watch root whose watch() call failed once a surviving watcher fires', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-agent-retry-'));
    const rootA = join(dir, 'a');
    const rootB = join(dir, 'b');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    const transcript = join(rootA, 'late.jsonl');
    const candidate = { kind: 'claude' as const, path: transcript, model: 'claude-sonnet-4-6' };

    let allowA = false;
    let aListener: (() => void) | undefined;
    let bListener: (() => void) | undefined;
    const watch = vi.fn((path: string, _options: { recursive: boolean }, listener: () => void) => {
      if (path === rootA) {
        if (!allowA) throw new Error('simulated watch failure');
        aListener = listener;
      } else if (path === rootB) {
        bListener = listener;
      }
      return { close: vi.fn() };
    });

    resolverMock.listAgentTranscriptCandidates.mockResolvedValue([]);
    resolverMock.listAgentTranscriptWatchRoots.mockResolvedValue([rootA, rootB]);
    resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(null);

    try {
      const eventsPromise = Effect.runPromise(
        watchForAgentTranscriptCandidate('agent-pan-3950-retry', '', { watch }).pipe(Stream.take(1), Stream.runCollect),
      );

      await waitUntil(() => bListener !== undefined);
      expect(aListener).toBeUndefined(); // root A's watch() has never succeeded yet

      // root A can now attach; firing the surviving watcher (B) is what
      // triggers the retry — nothing else does.
      allowA = true;
      bListener!();
      await waitUntil(() => aListener !== undefined);

      resolverMock.listAgentTranscriptCandidates.mockResolvedValue([candidate]);
      resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(candidate);
      aListener!();

      const events = Array.from(await eventsPromise);
      expect(events).toEqual([candidate]);
    } finally {
      resolverMock.listAgentTranscriptCandidates.mockResolvedValue([]);
      resolverMock.listAgentTranscriptWatchRoots.mockResolvedValue([]);
      resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(null);
      await rm(dir, { recursive: true, force: true });
    }
  });

  // PAN-3950 W6: a watch root whose watch() call always throws must be
  // retried exactly once per surviving event — never spontaneously, and
  // never via a timer (the retry scheme uses none).
  it('grows watch attempts for a permanently failing root by exactly one per surviving event, and schedules no timers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-agent-permanent-fail-'));
    const rootA = join(dir, 'a');
    const rootB = join(dir, 'b');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    const transcript = join(rootB, 'late.jsonl');
    const candidate = { kind: 'claude' as const, path: transcript, model: 'claude-sonnet-4-6' };

    let watchCallsA = 0;
    let bListener: (() => void) | undefined;
    const watch = vi.fn((path: string, _options: { recursive: boolean }, listener: () => void) => {
      if (path === rootA) {
        watchCallsA++;
        throw new Error('simulated permanent watch failure');
      }
      if (path === rootB) bListener = listener;
      return { close: vi.fn() };
    });

    resolverMock.listAgentTranscriptCandidates.mockResolvedValue([]);
    resolverMock.listAgentTranscriptWatchRoots.mockResolvedValue([rootA, rootB]);
    resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(null);

    try {
      const eventsPromise = Effect.runPromise(
        watchForAgentTranscriptCandidate('agent-pan-3950-permanent-fail', '', { watch }).pipe(Stream.take(1), Stream.runCollect),
      );

      await waitUntil(() => bListener !== undefined);
      await waitUntil(() => watchCallsA >= 1);
      await settle();
      const settledCalls = watchCallsA;

      vi.useFakeTimers();
      try {
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }

      bListener!();
      await waitUntil(() => watchCallsA === settledCalls + 1);
      await settle();
      expect(watchCallsA).toBe(settledCalls + 1); // grew by exactly one, no runaway retries

      vi.useFakeTimers();
      try {
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }

      resolverMock.listAgentTranscriptCandidates.mockResolvedValue([candidate]);
      resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(candidate);
      bListener!();

      const events = Array.from(await eventsPromise);
      expect(events).toEqual([candidate]);
    } finally {
      resolverMock.listAgentTranscriptCandidates.mockResolvedValue([]);
      resolverMock.listAgentTranscriptWatchRoots.mockResolvedValue([]);
      resolverMock.resolveAgentTranscriptCandidate.mockResolvedValue(null);
      await rm(dir, { recursive: true, force: true });
    }
  });
});


describe('Codex subagent stream dispatch', () => {
  it('emits a parent list and streams only the selected child with no nested list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-subagent-stream-'));
    const folder = join(dir, 'sessions', '2026', '09', '08');
    await mkdir(folder, { recursive: true });
    const parent = join(folder, 'rollout-parent.jsonl');
    const child = join(folder, 'rollout-child.jsonl');
    try {
      for (const [file, id, source, message] of [
        [parent, 'parent', 'cli', 'Parent'],
        [child, 'child', { subagent: { thread_spawn: { parent_thread_id: 'parent' } } }, 'Child'],
      ] as const) {
        await writeFile(file, [
          { type: 'session_meta', payload: { id, source } },
          { type: 'event_msg', payload: { type: 'agent_message', message } },
          { type: 'event_msg', payload: { type: 'task_complete' } },
        ].map(e => JSON.stringify(e)).join('\n') + '\n');
      }
      resolverMock.resolveCodexRolloutPath.mockResolvedValue(parent);
      const stream = streamHarnessFullParseSnapshots('conv-codex', 'codex', null, true)!;
      const events = Array.from(await Effect.runPromise(stream.pipe(Stream.take(2), Stream.runCollect)));
      expect(events[0]).toMatchObject({ kind: 'messages', messages: [{ text: 'Parent' }] });
      expect(events[1]).toMatchObject({ kind: 'subagents', subagents: [{ agentId: 'child' }] });
      const selected = streamHarnessFullParseSnapshots('conv-codex', 'codex', null, true, null, 'child')!;
      const childEvents = Array.from(await Effect.runPromise(selected.pipe(Stream.take(1), Stream.runCollect)));
      expect(childEvents).toEqual([expect.objectContaining({ kind: 'messages', messages: [expect.objectContaining({ text: 'Child' })] })]);
      const invalid = streamHarnessFullParseSnapshots('conv-codex', 'codex', null, true, null, 'parent')!;
      expect(Array.from(await Effect.runPromise(invalid.pipe(Stream.take(1), Stream.runCollect))))
        .toEqual([{ kind: 'messages', messages: [], workLog: [], streaming: false, snapshot: true }]);
    } finally {
      resolverMock.resolveCodexRolloutPath.mockResolvedValue(null);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
