import { describe, expect, it, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ stat: vi.fn(), job: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }));
vi.mock('../dashboard-db-task.js', () => ({ runDashboardDbJob: mocks.job }));
import { sharedTranscriptParser, parseStateFromSnapshot } from '../shared-transcript-parser.js';
import type { ParseResult } from '../conversation/types.js';
import type { WorkLogEntry } from '@overdeck/contracts';

describe('shared transcript parser', () => {
  beforeEach(() => {
    mocks.stat.mockReset();
    mocks.job.mockReset();
  });

  it('shares one worker parse among subscribers, refreshes changed files, and retries failures', async () => {
    mocks.stat.mockResolvedValue({ dev: 1, ino: 1, size: 100, mtimeMs: 1 });
    const result = { messages: [], workLog: [] };
    mocks.job.mockResolvedValue(result);
    const first = sharedTranscriptParser('codex');
    const second = sharedTranscriptParser('codex');
    expect(await Promise.all([first('/shared.jsonl'), second('/shared.jsonl')])).toEqual([result, result]);
    expect(mocks.job).toHaveBeenCalledTimes(1);
    mocks.stat.mockResolvedValue({ dev: 1, ino: 1, size: 200, mtimeMs: 2 });
    mocks.job.mockRejectedValueOnce(new Error('transient read failure'));
    await expect(first('/shared.jsonl')).rejects.toThrow('transient read failure');
    expect(await second('/shared.jsonl')).toBe(result);
    expect(mocks.job).toHaveBeenCalledTimes(3);
  });

  it('dispatches exactly one parseTranscriptSnapshot job with parser claude-initial for an unchanged stat signature', async () => {
    mocks.stat.mockResolvedValue({ dev: 2, ino: 2, size: 50, mtimeMs: 5 });
    const result = { messages: [], workLog: [] };
    mocks.job.mockResolvedValue(result);
    const parse = sharedTranscriptParser('claude-initial');

    await parse('/claude-a.jsonl');
    await parse('/claude-a.jsonl');

    expect(mocks.job).toHaveBeenCalledTimes(1);
    expect(mocks.job).toHaveBeenCalledWith('parseTranscriptSnapshot', {
      sessionFile: '/claude-a.jsonl',
      parser: 'claude-initial',
    });
  });

  it('shares one job between two concurrent claude-initial calls for the same file', async () => {
    mocks.stat.mockResolvedValue({ dev: 3, ino: 3, size: 10, mtimeMs: 1 });
    const result = { messages: [], workLog: [] };
    mocks.job.mockResolvedValue(result);
    const parse = sharedTranscriptParser('claude-initial');

    const [a, b] = await Promise.all([parse('/claude-b.jsonl'), parse('/claude-b.jsonl')]);

    expect(a).toBe(result);
    expect(b).toBe(result);
    expect(mocks.job).toHaveBeenCalledTimes(1);
  });

  it('dispatches uncached when the session file does not exist yet, so a later call dispatches again', async () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    mocks.stat.mockRejectedValueOnce(enoent);
    const result = { messages: [], workLog: [] };
    mocks.job.mockResolvedValueOnce(result);
    const parse = sharedTranscriptParser('claude-initial');

    expect(await parse('/claude-missing.jsonl')).toBe(result);
    expect(mocks.job).toHaveBeenCalledTimes(1);

    // Nothing was cached for a missing-file dispatch — the next call, now with
    // a successful (and unchanged) stat, dispatches its own job.
    mocks.stat.mockResolvedValue({ dev: 4, ino: 4, size: 0, mtimeMs: 1 });
    mocks.job.mockResolvedValueOnce(result);
    expect(await parse('/claude-missing.jsonl')).toBe(result);
    expect(mocks.job).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-ENOENT stat error', async () => {
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' });
    mocks.stat.mockRejectedValueOnce(eacces);
    const parse = sharedTranscriptParser('claude-initial');

    await expect(parse('/claude-denied.jsonl')).rejects.toThrow('denied');
  });

  describe('parseStateFromSnapshot', () => {
    function makeSnapshot(): ParseResult {
      return {
        messages: [],
        workLog: [],
        byteOffset: 0,
        streaming: false,
        totalCost: 0,
        totalTokens: 0,
        latestAssistantUsage: null,
        contextBoundaryOffset: 0,
        contextActiveBytes: 0,
        pendingToolUse: new Map([['tool-1', { id: 'tool-1' } as unknown as WorkLogEntry]]),
        unresolvedResults: new Map(),
        lastSequence: 1,
        mtimeMs: 0,
        planToolUseIds: new Set(['plan-1']),
        countedUsageIds: new Set(['usage-1']),
        orphanToolUseIds: new Set(['orphan-1']),
        fileEditsByAssistantId: new Map([['assistant-1', [{ tool: 'Edit', filePath: '/a.ts' }]]]),
      };
    }

    it('returns containers that are distinct objects: mutating one subscriber leaves the snapshot and another subscriber unchanged', () => {
      const snapshot = makeSnapshot();
      const subscriberA = parseStateFromSnapshot(snapshot);
      const subscriberB = parseStateFromSnapshot(snapshot);

      expect(subscriberA.pendingToolUse).not.toBe(snapshot.pendingToolUse);
      expect(subscriberA.pendingToolUse).not.toBe(subscriberB.pendingToolUse);
      expect(subscriberA.fileEditsByAssistantId).not.toBe(snapshot.fileEditsByAssistantId);

      subscriberA.pendingToolUse.delete('tool-1');

      expect(subscriberA.pendingToolUse.has('tool-1')).toBe(false);
      expect(snapshot.pendingToolUse.has('tool-1')).toBe(true);
      expect(subscriberB.pendingToolUse.has('tool-1')).toBe(true);
    });
  });
});
