import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, resetDatabase } from '../../../src/lib/database/index.js';
import { claimTranscriptRange, getTranscriptCheckpoint } from '../../../src/lib/memory/checkpoints.js';

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

describe('memory transcript checkpoints', () => {
  it('creates the transcript_checkpoints table through schema initialization', () => {
    const result = claim();

    expect(result.status).toBe('claimed');
    expect(getTranscriptCheckpoint('session-1')).toMatchObject({
      sessionId: 'session-1',
      projectId: 'panopticon-cli',
      workspaceId: 'feature-pan-1052',
      issueId: 'PAN-1052',
      transcriptPath: '/tmp/session-1.jsonl',
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
    expect(getTranscriptCheckpoint('session-concurrent')?.lastOffset).toBe(winners[0]?.status === 'claimed' ? winners[0].toOffset : null);
  });

  it('claims adjacent ranges without duplicates or gaps', () => {
    const first = claim({ sessionId: 'session-chain', expectedFromOffset: 0, toOffset: 10 });
    const second = claim({ sessionId: 'session-chain', expectedFromOffset: 10, toOffset: 20 });
    const duplicate = claim({ sessionId: 'session-chain', expectedFromOffset: 10, toOffset: 20 });

    expect(first).toMatchObject({ status: 'claimed', fromOffset: 0, toOffset: 10 });
    expect(second).toMatchObject({ status: 'claimed', fromOffset: 10, toOffset: 20 });
    expect(duplicate).toEqual({ status: 'empty', reason: 'offset-mismatch' });
    expect(getTranscriptCheckpoint('session-chain')?.lastOffset).toBe(20);
  });

  it('tracks mid-turn claims and resets rate-limit fields on Stop-hook claims', () => {
    claim({ sessionId: 'session-mid', expectedFromOffset: 0, toOffset: 10, trigger: 'poller', now: new Date('2026-05-16T22:45:00.000Z') });
    claim({ sessionId: 'session-mid', expectedFromOffset: 10, toOffset: 20, trigger: 'poller', now: new Date('2026-05-16T22:46:00.000Z') });

    expect(getTranscriptCheckpoint('session-mid')).toMatchObject({
      lastMidTurnAt: '2026-05-16T22:46:00.000Z',
      midTurnCountInCurrentTurn: 2,
    });

    claim({ sessionId: 'session-mid', expectedFromOffset: 20, toOffset: 30, trigger: 'stop-hook', now: new Date('2026-05-16T22:47:00.000Z') });

    expect(getTranscriptCheckpoint('session-mid')).toMatchObject({
      lastOffset: 30,
      lastMidTurnAt: null,
      midTurnCountInCurrentTurn: 0,
    });
  });

  it('rejects invalid ranges before touching checkpoints', () => {
    expect(claim({ toOffset: 0 })).toEqual({ status: 'empty', reason: 'invalid-range' });
    expect(getTranscriptCheckpoint('session-1')).toBeNull();
  });
});
