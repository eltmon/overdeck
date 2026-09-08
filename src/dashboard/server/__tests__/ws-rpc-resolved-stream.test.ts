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
  readLauncherPinnedSessionId: vi.fn(async () => null),
}));
vi.mock('../routes/jsonl-resolver.js', () => resolverMock);
vi.mock('../services/dashboard-db-task.js', () => ({
  runDashboardDbJob: vi.fn(async (_operation: string, input: { sessionFile: string }) => {
    const { parseCodexConversationMessages } = await import('../services/codex-conversation-parser.js');
    return parseCodexConversationMessages(input.sessionFile);
  }),
}));

import {
  streamHarnessFullParseSnapshots,
  streamResolvedFullParseSnapshots,
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

describe('streamHarnessFullParseSnapshots — ACP dispatch', () => {
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
