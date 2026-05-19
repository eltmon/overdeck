import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, resetDatabase } from '../../../src/lib/database/index.js';
import { claimTranscriptRange, commitTranscriptRange, getTranscriptCheckpoint, releaseTranscriptRange } from '../../../src/lib/memory/checkpoints.js';

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
} as const;

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-checkpoints-'));
  process.env.PANOPTICON_HOME = tempDir;
  resetDatabase();
});

afterEach(async () => {
  closeDatabase();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function claim(overrides: Partial<Parameters<typeof claimTranscriptRange>[0]> = {}) {
  return claimTranscriptRange({
    sessionId: 'session-1',
    expectedFromOffset: 0,
    toOffset: 100,
    transcriptPath: '/tmp/session-1.jsonl',
    identity,
    now: new Date('2026-05-16T22:45:00.000Z'),
    ...overrides,
  });
}

function commit(overrides: Partial<Parameters<typeof commitTranscriptRange>[0]> = {}) {
  return commitTranscriptRange({
    sessionId: 'session-1',
    expectedFromOffset: 0,
    toOffset: 100,
    consumedOffset: 100,
    transcriptPath: '/tmp/session-1.jsonl',
    identity,
    now: new Date('2026-05-16T22:45:00.000Z'),
    ...overrides,
  });
}

describe('memory transcript checkpoints', () => {
  it('creates the transcript_checkpoints table without advancing until commit', () => {
    const result = claim();

    expect(result.status).toBe('claimed');
    expect(getTranscriptCheckpoint('session-1')).toMatchObject({
      sessionId: 'session-1',
      projectId: 'panopticon-cli',
      workspaceId: 'feature-pan-1052',
      issueId: 'PAN-1052',
      transcriptPath: '/tmp/session-1.jsonl',
      lastOffset: 0,
      lastObservationAt: null,
    });

    expect(commit()).toMatchObject({ status: 'committed' });
    expect(getTranscriptCheckpoint('session-1')).toMatchObject({
      lastOffset: 100,
      lastObservationAt: '2026-05-16T22:45:00.000Z',
    });
  });

  it('atomically allows only one overlapping claimant to advance a range', async () => {
    const attempts = await Promise.all(Array.from({ length: 50 }, (_, index) => Promise.resolve().then(() => claim({
      sessionId: 'session-concurrent',
      toOffset: 100 + index,
      transcriptPath: '/tmp/session-concurrent.jsonl',
    }))));

    const winners = attempts.filter((result) => result.status === 'claimed');
    const losers = attempts.filter((result) => result.status === 'empty');

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(49);
    expect(new Set(winners.map((result) => result.status === 'claimed' ? `${result.fromOffset}:${result.toOffset}` : '')).size).toBe(1);
    expect(getTranscriptCheckpoint('session-concurrent')?.lastOffset).toBe(0);

    const winner = winners[0];
    expect(winner?.status).toBe('claimed');
    if (winner?.status === 'claimed') {
      expect(commit({
        sessionId: 'session-concurrent',
        expectedFromOffset: winner.fromOffset,
        toOffset: winner.toOffset,
        consumedOffset: winner.toOffset,
        transcriptPath: '/tmp/session-concurrent.jsonl',
      })).toMatchObject({ status: 'committed' });
      expect(getTranscriptCheckpoint('session-concurrent')?.lastOffset).toBe(winner.toOffset);
    }
  });

  it('commits adjacent ranges without duplicates or gaps', () => {
    const first = claim({ sessionId: 'session-chain', expectedFromOffset: 0, toOffset: 10 });
    expect(first).toMatchObject({ status: 'claimed', fromOffset: 0, toOffset: 10 });
    expect(commit({ sessionId: 'session-chain', expectedFromOffset: 0, toOffset: 10, consumedOffset: 10 })).toMatchObject({ status: 'committed' });

    const second = claim({ sessionId: 'session-chain', expectedFromOffset: 10, toOffset: 20 });
    expect(second).toMatchObject({ status: 'claimed', fromOffset: 10, toOffset: 20 });
    expect(commit({ sessionId: 'session-chain', expectedFromOffset: 10, toOffset: 20, consumedOffset: 20 })).toMatchObject({ status: 'committed' });

    const duplicate = claim({ sessionId: 'session-chain', expectedFromOffset: 10, toOffset: 20 });
    expect(duplicate).toEqual({ status: 'empty', reason: 'offset-mismatch' });
    expect(getTranscriptCheckpoint('session-chain')?.lastOffset).toBe(20);
  });

  it('tracks mid-turn commits and resets rate-limit fields on Stop-hook commits', () => {
    claim({ sessionId: 'session-mid', expectedFromOffset: 0, toOffset: 10, trigger: 'poller', now: new Date('2026-05-16T22:45:00.000Z') });
    commit({ sessionId: 'session-mid', expectedFromOffset: 0, toOffset: 10, consumedOffset: 10, trigger: 'poller', now: new Date('2026-05-16T22:45:00.000Z') });
    claim({ sessionId: 'session-mid', expectedFromOffset: 10, toOffset: 20, trigger: 'poller', now: new Date('2026-05-16T22:46:00.000Z') });
    commit({ sessionId: 'session-mid', expectedFromOffset: 10, toOffset: 20, consumedOffset: 20, trigger: 'poller', now: new Date('2026-05-16T22:46:00.000Z') });

    expect(getTranscriptCheckpoint('session-mid')).toMatchObject({
      lastMidTurnAt: '2026-05-16T22:46:00.000Z',
      midTurnCountInCurrentTurn: 2,
    });

    claim({ sessionId: 'session-mid', expectedFromOffset: 20, toOffset: 30, trigger: 'stop-hook', now: new Date('2026-05-16T22:47:00.000Z') });
    commit({ sessionId: 'session-mid', expectedFromOffset: 20, toOffset: 30, consumedOffset: 30, trigger: 'stop-hook', now: new Date('2026-05-16T22:47:00.000Z') });

    expect(getTranscriptCheckpoint('session-mid')).toMatchObject({
      lastOffset: 30,
      lastMidTurnAt: null,
      midTurnCountInCurrentTurn: 0,
    });
  });

  it('commits only consumed full-line bytes and leaves trailing partial bytes retryable', () => {
    expect(claim({ sessionId: 'session-partial', expectedFromOffset: 0, toOffset: 100 })).toMatchObject({ status: 'claimed' });
    expect(commit({ sessionId: 'session-partial', expectedFromOffset: 0, toOffset: 100, consumedOffset: 72 })).toMatchObject({ status: 'committed' });
    expect(getTranscriptCheckpoint('session-partial')?.lastOffset).toBe(72);
    expect(claim({ sessionId: 'session-partial', expectedFromOffset: 72, toOffset: 120 })).toMatchObject({ status: 'claimed' });
    releaseTranscriptRange('session-partial', 72, 120);
  });

  it('releases uncommitted claims so failed pipeline stages can retry the same range', () => {
    expect(claim({ sessionId: 'session-retry', expectedFromOffset: 0, toOffset: 100 })).toMatchObject({ status: 'claimed' });
    expect(claim({ sessionId: 'session-retry', expectedFromOffset: 0, toOffset: 100 })).toEqual({ status: 'empty', reason: 'offset-mismatch' });

    releaseTranscriptRange('session-retry', 0, 100);

    expect(claim({ sessionId: 'session-retry', expectedFromOffset: 0, toOffset: 100 })).toMatchObject({ status: 'claimed' });
    expect(getTranscriptCheckpoint('session-retry')?.lastOffset).toBe(0);
    releaseTranscriptRange('session-retry', 0, 100);
  });

  it('rejects invalid ranges before touching checkpoints', () => {
    expect(claim({ toOffset: 0 })).toEqual({ status: 'empty', reason: 'invalid-range' });
    expect(getTranscriptCheckpoint('session-1')).toBeNull();
  });
});
