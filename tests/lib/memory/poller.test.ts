import { describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity } from '@panctl/contracts';
import { MAX_MEMORY_POLLER_SAMPLE_BYTES, TranscriptPoller } from '../../../src/lib/memory/poller.js';
import type { TranscriptEntry } from '../../../src/lib/memory/transcript-source.js';

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'agent-pan-1052',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const satisfies MemoryIdentity;

function entry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    agentId: 'agent-pan-1052',
    sessionId: 'session-1',
    transcriptPath: '/tmp/session-1.jsonl',
    identity,
    harness: 'claude-code',
    size: 0,
    mtimeMs: 0,
    ...overrides,
  };
}

describe('TranscriptPoller', () => {
  it('starts one 2s interval and stops it idempotently', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      const poller = new TranscriptPoller();

      poller.start();
      poller.start();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2_000);

      poller.stop();
      poller.stop();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does no syscalls or extraction work when the registry is empty', async () => {
    const statTranscript = vi.fn();
    const extract = vi.fn();
    const poller = new TranscriptPoller({ statTranscript, extractFromTranscriptDelta: extract });

    await expect(poller.tick()).resolves.toEqual({
      scanned: 0,
      unchanged: 0,
      belowThreshold: 0,
      rateLimited: 0,
      fired: 0,
      removed: 0,
    });
    expect(statTranscript).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('does no syscalls or extraction work when observations are disabled', async () => {
    const statTranscript = vi.fn();
    const extract = vi.fn();
    const poller = new TranscriptPoller({
      areObservationsEnabled: () => false,
      statTranscript,
      extractFromTranscriptDelta: extract,
    });
    poller.register(entry());

    await expect(poller.tick()).resolves.toEqual({
      scanned: 0,
      unchanged: 0,
      belowThreshold: 0,
      rateLimited: 0,
      fired: 0,
      removed: 0,
    });
    expect(statTranscript).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('uses stat as a fast path and skips unchanged transcripts', async () => {
    const statTranscript = vi.fn(async () => ({ size: 100, mtimeMs: 10 }));
    const readTranscriptSlice = vi.fn();
    const extract = vi.fn();
    const poller = new TranscriptPoller({ statTranscript, readTranscriptSlice, extractFromTranscriptDelta: extract });
    poller.register(entry({ size: 100, mtimeMs: 10 }));

    await expect(poller.tick()).resolves.toMatchObject({ scanned: 1, unchanged: 1 });
    expect(readTranscriptSlice).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });

  it('accumulates line activity and fires the pipeline only at the threshold', async () => {
    const statTranscript = vi.fn()
      .mockResolvedValueOnce({ size: 10, mtimeMs: 1 })
      .mockResolvedValueOnce({ size: 20, mtimeMs: 2 });
    const readTranscriptSlice = vi.fn()
      .mockResolvedValueOnce('{"type":"user"}\n')
      .mockResolvedValueOnce('{"type":"assistant"}\n');
    const enqueue = vi.fn(async () => undefined);
    const poller = new TranscriptPoller({
      activityLineThreshold: 2,
      statTranscript,
      readTranscriptSlice,
      getTranscriptCheckpoint: () => null,
      enqueueTranscriptDelta: enqueue,
    });
    poller.register(entry());

    await expect(poller.tick()).resolves.toMatchObject({ belowThreshold: 1, fired: 0 });
    await expect(poller.tick()).resolves.toMatchObject({ belowThreshold: 0, fired: 1 });

    expect(readTranscriptSlice).toHaveBeenNthCalledWith(1, '/tmp/session-1.jsonl', 0, 10);
    expect(readTranscriptSlice).toHaveBeenNthCalledWith(2, '/tmp/session-1.jsonl', 10, 20);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      transcriptPath: '/tmp/session-1.jsonl',
      fromOffset: 0,
      toOffset: 20,
      trigger: 'poller',
      identity,
    }));
    expect(poller.snapshot()[0]).toMatchObject({ lastExtractionOffset: 20, pendingLineCount: 0 });
  });

  it('enforces mid-turn interval and count limits before firing extraction', async () => {
    const extract = vi.fn();
    const poller = new TranscriptPoller({
      activityLineThreshold: 1,
      now: () => new Date('2026-05-16T23:01:00.000Z'),
      statTranscript: async () => ({ size: 10, mtimeMs: 1 }),
      readTranscriptSlice: async () => '{"type":"assistant"}\n',
      getTranscriptCheckpoint: () => ({
        sessionId: 'session-1',
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        transcriptPath: '/tmp/session-1.jsonl',
        lastOffset: 0,
        lastObservationAt: null,
        lastMidTurnAt: '2026-05-16T23:00:30.000Z',
        midTurnCountInCurrentTurn: 1,
        updatedAt: '2026-05-16T23:00:30.000Z',
      }),
      extractFromTranscriptDelta: extract,
    });
    poller.register(entry());

    await expect(poller.tick()).resolves.toMatchObject({ rateLimited: 1, fired: 0 });
    expect(extract).not.toHaveBeenCalled();
  });

  it('enforces the maximum mid-turn extraction count before firing extraction', async () => {
    const extract = vi.fn();
    const poller = new TranscriptPoller({
      activityLineThreshold: 1,
      statTranscript: async () => ({ size: 10, mtimeMs: 1 }),
      readTranscriptSlice: async () => '{"type":"assistant"}\n',
      getTranscriptCheckpoint: () => ({
        sessionId: 'session-1',
        projectId: 'panopticon-cli',
        workspaceId: 'feature-pan-1052',
        issueId: 'PAN-1052',
        transcriptPath: '/tmp/session-1.jsonl',
        lastOffset: 0,
        lastObservationAt: null,
        lastMidTurnAt: null,
        midTurnCountInCurrentTurn: 3,
        updatedAt: '2026-05-16T23:00:30.000Z',
      }),
      extractFromTranscriptDelta: extract,
    });
    poller.register(entry());

    await expect(poller.tick()).resolves.toMatchObject({ rateLimited: 1, fired: 0 });
    expect(extract).not.toHaveBeenCalled();
  });

  it('samples transcript growth with a bounded read and treats over-cap growth as extraction-worthy', async () => {
    const readTranscriptSlice = vi.fn(async () => 'partial sample without newline');
    const enqueue = vi.fn(async () => undefined);
    const poller = new TranscriptPoller({
      activityLineThreshold: 20,
      statTranscript: async () => ({ size: MAX_MEMORY_POLLER_SAMPLE_BYTES + 500, mtimeMs: 1 }),
      readTranscriptSlice,
      getTranscriptCheckpoint: () => null,
      enqueueTranscriptDelta: enqueue,
    });
    poller.register(entry());

    await expect(poller.tick()).resolves.toMatchObject({ fired: 1 });

    expect(readTranscriptSlice).toHaveBeenCalledWith('/tmp/session-1.jsonl', 0, MAX_MEMORY_POLLER_SAMPLE_BYTES);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      fromOffset: 0,
      toOffset: MAX_MEMORY_POLLER_SAMPLE_BYTES + 500,
    }));
    expect(poller.snapshot()[0]).toMatchObject({
      lastObservedOffset: MAX_MEMORY_POLLER_SAMPLE_BYTES,
      lastExtractionOffset: MAX_MEMORY_POLLER_SAMPLE_BYTES + 500,
      pendingLineCount: 0,
    });
  });

  it('syncs the in-memory registry from lifecycle-gated transcript sources', async () => {
    const activeA = entry({ sessionId: 'session-a', size: 1, mtimeMs: 1 });
    const activeB = entry({ sessionId: 'session-b', size: 2, mtimeMs: 2 });
    const getActiveTranscriptEntries = vi.fn()
      .mockResolvedValueOnce([activeA, activeB])
      .mockResolvedValueOnce([activeB]);
    const poller = new TranscriptPoller({ getActiveTranscriptEntries });

    await poller.syncActiveTranscripts();
    expect(poller.snapshot().map((item) => item.sessionId).sort()).toEqual(['session-a', 'session-b']);

    await poller.syncActiveTranscripts();
    expect(poller.snapshot().map((item) => item.sessionId)).toEqual(['session-b']);
  });

  it('skips lifecycle registry sync when observations are disabled', async () => {
    const getActiveTranscriptEntries = vi.fn();
    const poller = new TranscriptPoller({
      areObservationsEnabled: () => false,
      getActiveTranscriptEntries,
    });

    await poller.syncActiveTranscripts();

    expect(getActiveTranscriptEntries).not.toHaveBeenCalled();
    expect(poller.snapshot()).toEqual([]);
  });
});
