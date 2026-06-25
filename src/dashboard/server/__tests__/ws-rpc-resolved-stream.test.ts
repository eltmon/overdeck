import { describe, expect, it, vi } from 'vitest';
import { Effect, Stream } from 'effect';
import { streamResolvedFullParseSnapshots } from '../ws-rpc.js';
import type { ParseResult } from '../services/conversation-service.js';

// PAN: a brand-new interactive pi/codex conversation writes no transcript until
// its first turn. The discovery loop must NOT sit on "Discovering conversation…"
// forever — when the transcript can't be resolved yet AND the conversation is
// interactive (unresolvedMeansEmpty=true), it should emit an empty/ready
// snapshot so the panel drops to the "type your first message" state, exactly
// like claude-code. For non-interactive callers (synthetic agent panels) the
// default is unchanged and it keeps announcing "discovering".

const emptyParse = vi.fn<(file: string) => Promise<ParseResult>>();

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
