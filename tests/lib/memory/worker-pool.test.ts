import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMemoryHealthSnapshot, updateMemoryHealth, type MemoryHealthChangedPayload } from '../../../src/lib/memory/health.js';
import { MemoryPipelineWorkerPool, type MemoryPipelineJobResult } from '../../../src/lib/memory/worker-pool.js';

const identity = {
  projectId: 'overdeck',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-worker-'));
  process.env.OVERDECK_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function pipelineJob(overrides: Partial<Parameters<MemoryPipelineWorkerPool['enqueue']>[0]> = {}) {
  return {
    sessionId: 'session-1',
    transcriptPath: '/tmp/session-1.jsonl',
    fromOffset: 0,
    toOffset: 100,
    identity,
    trigger: 'poller' as const,
    ...overrides,
  };
}

function extracted(data: unknown) {
  return {
    status: 'extracted' as const,
    provider: 'stub',
    result: {
      data,
      usage: { input: 1, output: 1 },
      cost: { usd: 0 },
      model: 'stub-model',
      provider: 'stub',
    },
  };
}

describe('memory extraction worker pool', () => {


  it('runs transcript-delta pipeline jobs with bounded concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const results: MemoryPipelineJobResult[] = [];
    const pool = new MemoryPipelineWorkerPool({
      loadConcurrency: () => 2,
      onResult: (result) => results.push(result),
      extractFromTranscriptDelta: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return { status: 'noop' as const, observation: null, reason: 'empty-delta' as const };
      },
    });

    for (let index = 0; index < 4; index++) {
      pool.enqueue(pipelineJob({ jobId: `pipeline-${index}` }));
    }

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maxActive).toBe(2);

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await pool.waitForIdle();

    expect(results.map((result) => result.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    expect(maxActive).toBe(2);
  });

  it('coalesces queued transcript-delta jobs by session only when the queue limit is reached', async () => {
    const releases: Array<() => void> = [];
    const processed: string[] = [];
    const ranges: Array<{ fromOffset: number | undefined; toOffset: number; transcriptPath: string }> = [];
    const pool = new MemoryPipelineWorkerPool({
      loadConcurrency: () => 1,
      queueLimit: 2,
      extractFromTranscriptDelta: async (input) => {
        processed.push(input.jobId ?? 'missing');
        ranges.push({ fromOffset: input.fromOffset, toOffset: input.toOffset, transcriptPath: input.transcriptPath });
        await new Promise<void>((resolve) => releases.push(resolve));
        return { status: 'noop' as const, observation: null, reason: 'empty-delta' as const };
      },
    });

    pool.enqueue(pipelineJob({ jobId: 'pipeline-0', sessionId: 'session-1' }));
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    pool.enqueue(pipelineJob({ jobId: 'pipeline-1', sessionId: 'session-1', fromOffset: 0, toOffset: 100, transcriptPath: '/tmp/trusted-session-1.jsonl' }));
    pool.enqueue(pipelineJob({ jobId: 'pipeline-2', sessionId: 'session-1', fromOffset: 100, toOffset: 200, transcriptPath: '/tmp/untrusted-session-1.jsonl' }));
    pool.enqueue(pipelineJob({ jobId: 'pipeline-3', sessionId: 'session-1', fromOffset: 200, toOffset: 300, transcriptPath: '/tmp/newest-session-1.jsonl' }));
    expect(pool.droppedCount()).toBe(0);

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.splice(0).forEach((release) => release());
    await pool.waitForIdle();

    expect(processed).toEqual(['pipeline-0', 'pipeline-2', 'pipeline-3']);
    expect(ranges[2]).toEqual({ fromOffset: 0, toOffset: 300, transcriptPath: '/tmp/trusted-session-1.jsonl' });
  });



  it('updates health.json counts and emits events only on status transitions', async () => {
    const emitted: Array<{ payload: MemoryHealthChangedPayload; timestamp: string }> = [];
    const emitHealthChanged = async (payload: MemoryHealthChangedPayload, timestamp: string) => {
      emitted.push({ payload, timestamp });
    };

    await updateMemoryHealth(identity, { status: 'failing', reason: 'extraction-failed', success: false }, {
      now: new Date('2026-05-16T22:00:00.000Z'),
      emitHealthChanged,
    });
    await updateMemoryHealth(identity, { status: 'failing', reason: 'extraction-failed', success: false }, {
      now: new Date('2026-05-16T22:01:00.000Z'),
      emitHealthChanged,
    });
    await updateMemoryHealth(identity, { status: 'healthy', success: true }, {
      now: new Date('2026-05-16T22:02:00.000Z'),
      emitHealthChanged,
    });

    expect(await readMemoryHealthSnapshot(identity)).toEqual({
      status: 'healthy',
      last_success: '2026-05-16T22:02:00.000Z',
      last_failure: '2026-05-16T22:01:00.000Z',
      // PAN-1866: health records carry last_failure_detail; a success clears it to null.
      last_failure_detail: null,
      extractions_attempted: 3,
      extractions_succeeded: 1,
      failed_by_reason: { 'extraction-failed': 2 },
    });
    expect(emitted).toEqual([
      {
        timestamp: '2026-05-16T22:00:00.000Z',
        payload: {
          projectId: 'overdeck',
          issueId: 'PAN-1052',
          status: 'failing',
          reason: 'extraction-failed',
        },
      },
      {
        timestamp: '2026-05-16T22:02:00.000Z',
        payload: {
          projectId: 'overdeck',
          issueId: 'PAN-1052',
          status: 'healthy',
          reason: null,
        },
      },
    ]);
  });
});
