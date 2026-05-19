import { describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity } from '@panctl/contracts';
import { extractFromTranscriptDelta } from '../../../src/lib/memory/pipeline.js';

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const satisfies MemoryIdentity;

function input(overrides: Partial<Parameters<typeof extractFromTranscriptDelta>[0]> = {}) {
  return {
    sessionId: 'session-1',
    transcriptPath: '/tmp/session.jsonl',
    fromOffset: 0,
    toOffset: 100,
    identity,
    trigger: 'stop-hook' as const,
    gitBranch: 'feature/pan-1052',
    now: new Date('2026-05-16T23:00:00.000Z'),
    id: 'obs-1',
    ...overrides,
  };
}

function extractedPayload() {
  return {
    status: 'extracted' as const,
    provider: 'stub',
    result: {
      data: {
        narrative: 'Pipeline persisted a memory observation.',
        summary: 'Pipeline observation persisted.',
        actionStatus: 'Pipeline done',
        tags: ['handoff'],
        files: ['src/lib/memory/pipeline.ts'],
      },
      usage: { input: 10, output: 5 },
      cost: { usd: 0 },
      model: 'stub-model',
      provider: 'stub',
    },
  };
}

describe('extractFromTranscriptDelta', () => {
  it('wires claim, compress, extract, write, pending, event, rollup, and health stages in order', async () => {
    const calls: string[] = [];
    const claimRange = vi.fn((claimInput) => {
      calls.push('claim');
      return {
        status: 'claimed' as const,
        fromOffset: claimInput.expectedFromOffset,
        toOffset: claimInput.toOffset,
        checkpoint: {
          sessionId: claimInput.sessionId,
          projectId: claimInput.identity.projectId,
          workspaceId: claimInput.identity.workspaceId,
          issueId: claimInput.identity.issueId,
          transcriptPath: claimInput.transcriptPath,
          lastOffset: claimInput.expectedFromOffset,
          lastObservationAt: null,
          lastMidTurnAt: null,
          midTurnCountInCurrentTurn: 0,
          updatedAt: '2026-05-16T23:00:00.000Z',
        },
      };
    });
    const compress = vi.fn(async () => {
      calls.push('compress');
      return { text: 'U: implement pipeline\nA: done', eventsConsumed: 2, lastFullLineOffset: 100 };
    });
    const extract = vi.fn(async () => {
      calls.push('extract');
      return extractedPayload();
    });
    const writeObservation = vi.fn(async () => {
      calls.push('writeObservation');
      return { jsonlPath: '/tmp/observations.jsonl', markdownPath: '/tmp/observations.md' };
    });
    const writePendingTurn = vi.fn(async () => {
      calls.push('writePending');
      return { path: '/tmp/pending.json', fileName: 'pending.json' };
    });
    const emitObservationCreated = vi.fn(async () => {
      calls.push('emit');
    });
    const maybeTriggerRollup = vi.fn(async () => {
      calls.push('rollup');
      return { status: 'below-threshold' as const, pendingCount: 1, threshold: 4 };
    });
    const commitRange = vi.fn(() => {
      calls.push('commit');
      return {
        status: 'committed' as const,
        checkpoint: {
          sessionId: 'session-1',
          projectId: 'panopticon-cli',
          workspaceId: 'feature-pan-1052',
          issueId: 'PAN-1052',
          transcriptPath: '/tmp/session.jsonl',
          lastOffset: 100,
          lastObservationAt: '2026-05-16T23:00:00.000Z',
          lastMidTurnAt: null,
          midTurnCountInCurrentTurn: 0,
          updatedAt: '2026-05-16T23:00:00.000Z',
        },
      };
    });
    const updateHealth = vi.fn(async () => {
      calls.push('health');
    });

    const result = await extractFromTranscriptDelta(input({
      claimRange,
      compress,
      extract,
      writeObservation,
      writePendingTurn,
      emitObservationCreated,
      maybeTriggerRollup,
      commitRange,
      updateHealth,
    }));

    expect(result.status).toBe('written');
    expect(result.observation?.summary).toBe('Pipeline observation persisted.');
    expect(calls).toEqual([
      'claim',
      'compress',
      'extract',
      'writeObservation',
      'writePending',
      'emit',
      'rollup',
      'commit',
      'health',
    ]);
    expect(writePendingTurn).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pending-3eaf83723ec3de760d7091119fbb1366',
      fromOffset: 0,
      toOffset: 100,
      lastFullLineOffset: 100,
      eventsConsumed: 2,
      compressedText: 'U: implement pipeline\nA: done',
    }), expect.objectContaining({ triggerRollup: false }));
    expect(commitRange).toHaveBeenCalledWith(expect.objectContaining({
      expectedFromOffset: 0,
      toOffset: 100,
      consumedOffset: 100,
    }));
    expect(updateHealth).toHaveBeenCalledWith(identity, { status: 'healthy', success: true });
  });

  it('noops before claiming transcript ranges for subagent hook payloads', async () => {
    const claimRange = vi.fn();

    const result = await extractFromTranscriptDelta(input({
      hookPayload: { agent_id: 'subagent-1', session_id: 'session-1' },
      claimRange,
    }));

    expect(result).toEqual({ status: 'noop', observation: null, reason: 'subagent' });
    expect(claimRange).not.toHaveBeenCalled();
  });

  it('noops immediately when claimRange returns an empty range', async () => {
    const compress = vi.fn();

    const result = await extractFromTranscriptDelta(input({
      claimRange: () => ({ status: 'empty', reason: 'offset-mismatch' }),
      compress,
    }));

    expect(result).toEqual({ status: 'noop', observation: null, reason: 'offset-mismatch' });
    expect(compress).not.toHaveBeenCalled();
  });

  it('returns failures instead of throwing and records failing health', async () => {
    const updateHealth = vi.fn(async () => undefined);

    const result = await extractFromTranscriptDelta(input({
      claimRange: () => claimedRange(0, 100),
      compress: async () => {
        throw new Error('disk unavailable');
      },
      updateHealth,
    }));

    expect(result).toEqual({ status: 'failed', observation: null, reason: 'compress-failed' });
    expect(updateHealth).toHaveBeenCalledWith(identity, {
      status: 'failing',
      reason: 'compress-failed',
      success: false,
    });
  });

  it('derives deterministic observation ids from the claimed session range when no id is supplied', async () => {
    const writeObservation = vi.fn(async () => ({ jsonlPath: '/tmp/observations.jsonl', markdownPath: '/tmp/observations.md' }));

    const result = await extractFromTranscriptDelta(input({
      id: undefined,
      claimRange: () => claimedRange(40, 100),
      compress: async () => ({ text: 'U: one complete event', eventsConsumed: 1, lastFullLineOffset: 100 }),
      extract: async () => extractedPayload(),
      writeObservation,
      writePendingTurn: async () => ({ path: '/tmp/pending.json', fileName: 'pending.json' }),
      emitObservationCreated: async () => undefined,
      maybeTriggerRollup: async () => ({ status: 'below-threshold' as const, pendingCount: 1, threshold: 4 }),
      commitRange: () => ({ status: 'committed' as const, checkpoint: claimedRange(40, 100).checkpoint }),
    }));

    expect(result.status).toBe('written');
    expect(writeObservation.mock.calls[0]![0].id).toBe('obs-5ae912f2f824e63d45cac4c8b0935079');
  });

  it('commits checkpoints only to the last fully consumed JSONL line', async () => {
    const commitRange = vi.fn(() => ({ status: 'committed' as const, checkpoint: claimedRange(0, 100).checkpoint }));

    await extractFromTranscriptDelta(input({
      claimRange: () => claimedRange(0, 100),
      compress: async () => ({ text: 'U: one complete event', eventsConsumed: 1, lastFullLineOffset: 72 }),
      extract: async () => extractedPayload(),
      writeObservation: async () => ({ jsonlPath: '/tmp/observations.jsonl', markdownPath: '/tmp/observations.md' }),
      writePendingTurn: async () => ({ path: '/tmp/pending.json', fileName: 'pending.json' }),
      emitObservationCreated: async () => undefined,
      maybeTriggerRollup: async () => ({ status: 'below-threshold' as const, pendingCount: 1, threshold: 4 }),
      commitRange,
    }));

    expect(commitRange).toHaveBeenCalledWith(expect.objectContaining({
      expectedFromOffset: 0,
      toOffset: 100,
      consumedOffset: 72,
    }));
  });

  it('releases claimed ranges without committing when post-claim durable stages fail', async () => {
    const commitRange = vi.fn();
    const releaseRange = vi.fn();

    const result = await extractFromTranscriptDelta(input({
      claimRange: () => claimedRange(0, 100),
      compress: async () => ({ text: 'U: one complete event', eventsConsumed: 1, lastFullLineOffset: 100 }),
      extract: async () => extractedPayload(),
      writeObservation: async () => {
        throw new Error('disk full');
      },
      commitRange,
      releaseRange,
    }));

    expect(result).toEqual({ status: 'failed', observation: null, reason: 'write-failed' });
    expect(commitRange).not.toHaveBeenCalled();
    expect(releaseRange).toHaveBeenCalledWith('session-1', 0, 100);
  });
});

function claimedRange(fromOffset: number, toOffset: number) {
  return {
    status: 'claimed' as const,
    fromOffset,
    toOffset,
    checkpoint: {
      sessionId: 'session-1',
      projectId: 'panopticon-cli',
      workspaceId: 'feature-pan-1052',
      issueId: 'PAN-1052',
      transcriptPath: '/tmp/session.jsonl',
      lastOffset: fromOffset,
      lastObservationAt: null,
      lastMidTurnAt: null,
      midTurnCountInCurrentTurn: 0,
      updatedAt: '2026-05-16T23:00:00.000Z',
    },
  };
}
