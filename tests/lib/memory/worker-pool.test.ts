import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryObservation } from '@panctl/contracts';
import { readMemoryHealthSnapshot, updateMemoryHealth, type MemoryHealthChangedPayload } from '../../../src/lib/memory/health.js';
import { MemoryExtractionWorkerPool, MemoryPipelineWorkerPool, type MemoryExtractionJobResult, type MemoryPipelineJobResult } from '../../../src/lib/memory/worker-pool.js';

const identity = {
  projectId: 'panopticon-cli',
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
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-worker-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function job(overrides: Partial<Parameters<MemoryExtractionWorkerPool['enqueue']>[0]> = {}) {
  return {
    compressedText: 'U: implement worker\nA: done',
    identity,
    gitBranch: 'feature/pan-1052',
    sourceTranscriptOffset: 42,
    ...overrides,
  };
}

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

function validPayload(index = 1) {
  return {
    narrative: `Worker wrote observation ${index}.`,
    summary: `Observation ${index} written.`,
    actionStatus: `Worker ${index}`,
    tags: ['handoff'],
    files: ['src/lib/memory/worker-pool.ts'],
  };
}

describe('memory extraction worker pool', () => {
  it('runs queued extraction jobs with bounded concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const results: MemoryExtractionJobResult[] = [];
    const pool = new MemoryExtractionWorkerPool({
      loadConcurrency: () => 2,
      writeObservation: vi.fn(async (observation: MemoryObservation) => ({ jsonlPath: `${observation.id}.jsonl`, markdownPath: `${observation.id}.md` })),
      updateHealth: vi.fn(async () => undefined),
      onResult: (result) => results.push(result),
    });

    for (let index = 0; index < 4; index++) {
      pool.enqueue(job({
        jobId: `job-${index}`,
        extract: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => releases.push(resolve));
          active -= 1;
          return extracted(validPayload(index));
        },
      }));
    }

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(maxActive).toBe(2);

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await pool.waitForIdle();

    expect(results.map((result) => result.status)).toEqual(['written', 'written', 'written', 'written']);
    expect(maxActive).toBe(2);
  });

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

  it('writes observations and records one healthy extraction per successful job', async () => {
    const updateHealth = vi.fn(async () => undefined);
    const write = vi.fn(async (observation: MemoryObservation) => ({
      jsonlPath: `${observation.id}.jsonl`,
      markdownPath: `${observation.id}.md`,
    }));
    const results: MemoryExtractionJobResult[] = [];
    const pool = new MemoryExtractionWorkerPool({
      loadConcurrency: () => 4,
      writeObservation: write,
      updateHealth,
      onResult: (result) => results.push(result),
    });

    pool.enqueue(job({ extract: async () => extracted(validPayload()) }));
    await pool.waitForIdle();

    expect(write).toHaveBeenCalledOnce();
    expect(updateHealth).toHaveBeenCalledWith(identity, { status: 'healthy', success: true });
    expect(results[0]?.status).toBe('written');
  });

  it('records malformed extraction failures without throwing to callers', async () => {
    const updateHealth = vi.fn(async () => undefined);
    const results: MemoryExtractionJobResult[] = [];
    const pool = new MemoryExtractionWorkerPool({
      updateHealth,
      onResult: (result) => results.push(result),
    });

    const id = pool.enqueue(job({ extract: async () => extracted({ summary: 'missing required fields' }) }));
    expect(id).toBeTruthy();
    await pool.waitForIdle();

    expect(updateHealth).toHaveBeenCalledWith(identity, {
      status: 'failing',
      reason: 'malformed-response',
      success: false,
    });
    expect(results).toEqual([{ jobId: id, status: 'dropped', reason: 'malformed-response' }]);
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
      extractions_attempted: 3,
      extractions_succeeded: 1,
      failed_by_reason: { 'extraction-failed': 2 },
    });
    expect(emitted).toEqual([
      {
        timestamp: '2026-05-16T22:00:00.000Z',
        payload: {
          projectId: 'panopticon-cli',
          issueId: 'PAN-1052',
          status: 'failing',
          reason: 'extraction-failed',
        },
      },
      {
        timestamp: '2026-05-16T22:02:00.000Z',
        payload: {
          projectId: 'panopticon-cli',
          issueId: 'PAN-1052',
          status: 'healthy',
          reason: null,
        },
      },
    ]);
  });
});
