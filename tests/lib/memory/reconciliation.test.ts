import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, resetDatabase } from '../../../src/lib/database/index.js';
import { claimTranscriptRange, commitTranscriptRange, getTranscriptCheckpoint } from '../../../src/lib/memory/checkpoints.js';
import { reconcileAgentMemory, reconcileStaleTranscriptCheckpoints } from '../../../src/lib/memory/reconciliation.js';
import type { ExtractFromTranscriptDeltaInput } from '../../../src/lib/memory/pipeline.js';

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
} as const;

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-reconcile-'));
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

async function checkpoint(sessionId: string, lastOffset: number, content: string): Promise<string> {
  if (!tempDir) throw new Error('tempDir not initialized');
  const transcriptPath = join(tempDir, `${sessionId}.jsonl`);
  await writeFile(transcriptPath, content, 'utf8');
  claimTranscriptRange({
    sessionId,
    expectedFromOffset: 0,
    toOffset: lastOffset,
    transcriptPath,
    identity,
    trigger: 'stop-hook',
    now: new Date('2026-05-16T22:00:00.000Z'),
  });
  commitTranscriptRange({
    sessionId,
    expectedFromOffset: 0,
    toOffset: lastOffset,
    consumedOffset: lastOffset,
    transcriptPath,
    identity,
    trigger: 'stop-hook',
    now: new Date('2026-05-16T22:00:00.000Z'),
  });
  return transcriptPath;
}

function claimingExtractor() {
  return vi.fn(async (input: ExtractFromTranscriptDeltaInput) => {
    const claim = claimTranscriptRange({
      sessionId: input.sessionId,
      expectedFromOffset: input.fromOffset,
      toOffset: input.toOffset,
      transcriptPath: input.transcriptPath,
      identity: input.identity,
      trigger: input.trigger,
      now: new Date('2026-05-16T22:01:00.000Z'),
    });
    if (claim.status === 'empty') return { status: 'noop' as const, observation: null, reason: claim.reason };
    commitTranscriptRange({
      sessionId: input.sessionId,
      expectedFromOffset: input.fromOffset,
      toOffset: input.toOffset,
      consumedOffset: input.toOffset,
      transcriptPath: input.transcriptPath,
      identity: input.identity,
      trigger: input.trigger,
      now: new Date('2026-05-16T22:01:00.000Z'),
    });
    return { status: 'written' as const, observation: {} as never, reason: null } as never;
  });
}

describe('memory reconciliation', () => {
  it('runs a bounded startup sweep over stale checkpoints and skips active sessions', async () => {
    const stalePath = await checkpoint('session-stale', 10, '01234567890123456789');
    await checkpoint('session-active', 10, '01234567890123456789');
    const extract = claimingExtractor();
    const log = vi.fn();

    await expect(reconcileStaleTranscriptCheckpoints({
      limit: 10,
      getActiveTranscriptEntries: async () => [{
        agentId: 'agent-active',
        sessionId: 'session-active',
        transcriptPath: stalePath,
        identity: { ...identity, runId: 'agent-active', sessionId: 'session-active', agentRole: 'work', agentHarness: 'claude-code' },
        harness: 'claude-code',
        size: 20,
        mtimeMs: 1,
      }],
      extractFromTranscriptDelta: extract,
      log,
    })).resolves.toMatchObject({ scanned: 2, active: 1, fired: 1, empty: 0, failed: 0 });

    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-stale',
      transcriptPath: stalePath,
      fromOffset: 10,
      toOffset: 20,
      trigger: 'reconciliation',
    }));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('scanned=2'));
  });

  it('is idempotent because the extractor commits the checkpoint once', async () => {
    await checkpoint('session-stale', 10, '01234567890123456789');
    const extract = claimingExtractor();
    const options = {
      getActiveTranscriptEntries: async () => [],
      extractFromTranscriptDelta: extract,
    };

    await expect(reconcileStaleTranscriptCheckpoints(options)).resolves.toMatchObject({ fired: 1 });
    await expect(reconcileStaleTranscriptCheckpoints(options)).resolves.toMatchObject({ fired: 0, empty: 1 });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(getTranscriptCheckpoint('session-stale')?.lastOffset).toBe(20);
  });

  it('runs per-session reconciliation for stopped agent events', async () => {
    const transcriptPath = await checkpoint('session-agent', 5, '0123456789');
    const extract = claimingExtractor();

    await expect(reconcileAgentMemory('agent-pan-1052', {
      getAgentState: async () => ({
        id: 'agent-pan-1052',
        issueId: 'PAN-1052',
        workspace: '/repo/panopticon-cli/workspaces/feature-pan-1052',
        harness: 'claude-code',
        role: 'work',
        model: 'claude-sonnet-4-6',
        status: 'stopped',
        startedAt: '2026-05-16T22:00:00.000Z',
        sessionId: 'session-agent',
      }),
      extractFromTranscriptDelta: extract,
    })).resolves.toMatchObject({ scanned: 1, fired: 1 });

    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-agent',
      transcriptPath,
      fromOffset: 5,
      toOffset: 10,
      trigger: 'reconciliation',
    }));
  });
});
