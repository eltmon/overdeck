import { describe, expect, it, vi } from 'vitest';
import { Effect, Stream } from 'effect';

// Stub the transcript resolvers so the dispatch can be asserted on the exact
// arguments each one receives — the kimi case has to forward a workspace.
const resolverMock = vi.hoisted(() => ({
  resolveAgentHarness: vi.fn(async () => 'claude-code'),
  resolvePiSessionPath: vi.fn(async () => null),
  resolveCodexRolloutPath: vi.fn(async () => null),
  resolveAcpTranscriptPath: vi.fn(async () => null),
  resolveKimiWirePath: vi.fn(async () => null),
  readLauncherPinnedSessionId: vi.fn(async () => null),
}));
vi.mock('../routes/jsonl-resolver.js', () => resolverMock);

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
