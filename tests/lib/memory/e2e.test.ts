import { appendFile, mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryIdentity, MemoryObservation, MemoryStatus, PendingTurn } from '@panctl/contracts';
import { closeDatabase, resetDatabase } from '../../../src/lib/database/index.js';
import { queryCostEvents } from '../../../src/lib/database/cost-events-db.js';
import { createResetMarker, searchMemory as searchMemoryCli } from '../../../src/lib/memory/cli.js';
import { closeMemoryFtsDatabases } from '../../../src/lib/memory/fts-db.js';
import { extractFromTranscriptDelta } from '../../../src/lib/memory/pipeline.js';
import { commitStatusRollup } from '../../../src/lib/memory/rollup.js';
import { recordExtractionCost } from '../../../src/lib/memory/providers/types.js';
import { readPendingTurns } from '../../../src/lib/memory/pending.js';

const identity: MemoryIdentity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
};

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-e2e-'));
  process.env.PANOPTICON_HOME = tempDir;
  resetDatabase();
});

afterEach(async () => {
  closeMemoryFtsDatabases();
  closeDatabase();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('PAN-1052 memory extraction end-to-end flow', () => {
  it('persists six turns, rolls up once, searches, resets, excludes subagents, records cost, and dedupes concurrent claims', async () => {
    const transcriptPath = join(tempDir!, 'session-1.jsonl');
    const rollupJobs: PendingTurn[][] = [];

    for (let turn = 1; turn <= 6; turn += 1) {
      const fromOffset = await fileSize(transcriptPath);
      await appendTranscriptTurn(transcriptPath, turn);
      const toOffset = await fileSize(transcriptPath);

      const result = await extractFromTranscriptDelta({
        sessionId: identity.sessionId,
        transcriptPath,
        fromOffset,
        toOffset,
        identity,
        trigger: 'stop-hook',
        gitBranch: 'feature/pan-1052',
        now: new Date(`2026-05-16T23:0${turn}:00.000Z`),
        id: `obs-${turn}`,
        extract: async () => extractedTurn(turn),
        emitObservationCreated: async () => undefined,
        updateHealth: async () => undefined,
        rollupOptions: {
          loadThreshold: () => 4,
          enqueueStatusRollup: async (job) => {
            rollupJobs.push(job.pendingTurns);
            await commitStatusRollup({
              identity: job.identity,
              pendingTurns: job.pendingTurns,
              status: statusForRollup(job.pendingTurns),
              now: new Date('2026-05-16T23:04:30.000Z'),
              emitStatusUpdated: async () => undefined,
            });
          },
        },
      });

      expect(result.status).toBe('written');
    }

    const persisted = await readPersistedObservations();
    expect(persisted).toHaveLength(6);
    expect(persisted.map((observation) => ({
      projectId: observation.projectId,
      workspaceId: observation.workspaceId,
      issueId: observation.issueId,
      sessionId: observation.sessionId,
      agentRole: observation.agentRole,
    }))).toEqual(Array.from({ length: 6 }, () => ({
      projectId: 'panopticon-cli',
      workspaceId: 'feature-pan-1052',
      issueId: 'PAN-1052',
      sessionId: 'session-1',
      agentRole: 'work',
    })));

    expect(rollupJobs).toHaveLength(1);
    expect(rollupJobs[0]!.map((turn) => turn.id)).toHaveLength(4);
    expect(rollupJobs[0]!.every((turn) => turn.id.startsWith('pending-'))).toBe(true);
    expect(await readPendingTurns(identity.projectId, identity.issueId)).toHaveLength(2);

    expect((await searchMemoryCli('6', { project: identity.projectId, issue: identity.issueId })).map((hit) => hit.observation.id))
      .toEqual(['obs-6']);

    await createResetMarker({
      projectId: identity.projectId,
      scope: 'issue',
      scopeId: identity.issueId,
      reason: 'E2E reset marker',
      fromTimestamp: '2026-05-16T23:04:30.000Z',
      createdAt: '2026-05-16T23:04:30.000Z',
      emitResetMarkerCreated: async () => undefined,
    });

    expect((await searchMemoryCli('turn', { project: identity.projectId, issue: identity.issueId })).map((hit) => hit.observation.id))
      .toEqual(['obs-6', 'obs-5']);
    expect((await searchMemoryCli('turn', { project: identity.projectId, issue: identity.issueId, includeArchived: true })).map((hit) => hit.observation.id))
      .toEqual(['obs-6', 'obs-5', 'obs-4', 'obs-3', 'obs-2', 'obs-1']);

    const subagent = await extractFromTranscriptDelta({
      sessionId: identity.sessionId,
      transcriptPath,
      fromOffset: await fileSize(transcriptPath),
      toOffset: (await fileSize(transcriptPath)) + 10,
      identity,
      trigger: 'stop-hook',
      hookPayload: { agent_id: 'subagent-1', session_id: identity.sessionId },
    });
    expect(subagent).toEqual({ status: 'noop', observation: null, reason: 'subagent' });
    expect(await readPersistedObservations()).toHaveLength(6);

    const costEvents = queryCostEvents({ issueId: identity.issueId });
    expect(costEvents).toHaveLength(6);
    expect(costEvents.every((event) => event.sessionType === 'memory-extraction')).toBe(true);
    expect(costEvents.every((event) => event.sessionId === identity.sessionId)).toBe(true);

    const concurrentFromOffset = await fileSize(transcriptPath);
    await appendTranscriptTurn(transcriptPath, 7);
    const concurrentToOffset = await fileSize(transcriptPath);
    const [hookResult, pollerResult] = await Promise.all([
      extractFromTranscriptDelta({
        sessionId: identity.sessionId,
        transcriptPath,
        fromOffset: concurrentFromOffset,
        toOffset: concurrentToOffset,
        identity,
        trigger: 'stop-hook',
        gitBranch: 'feature/pan-1052',
        now: new Date('2026-05-16T23:07:00.000Z'),
        extract: async () => extractedTurn(7),
        emitObservationCreated: async () => undefined,
        updateHealth: async () => undefined,
        rollupOptions: { loadThreshold: () => 99 },
      }),
      extractFromTranscriptDelta({
        sessionId: identity.sessionId,
        transcriptPath,
        fromOffset: concurrentFromOffset,
        toOffset: concurrentToOffset,
        identity,
        trigger: 'poller',
        gitBranch: 'feature/pan-1052',
        now: new Date('2026-05-16T23:07:00.000Z'),
        extract: async () => extractedTurn(7),
        emitObservationCreated: async () => undefined,
        updateHealth: async () => undefined,
        rollupOptions: { loadThreshold: () => 99 },
      }),
    ]);

    const statuses = [hookResult.status, pollerResult.status].sort();
    expect(statuses).toEqual(['written', 'written']);
    expect(await readPersistedObservations()).toHaveLength(7);
  });
});

async function appendTranscriptTurn(transcriptPath: string, turn: number): Promise<void> {
  await appendFile(transcriptPath, `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: `memory extraction turn ${turn}` }],
    },
  })}\n`, 'utf8');
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function readPersistedObservations(): Promise<MemoryObservation[]> {
  const path = join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations/2026-05-16.jsonl');
  const raw = await readFile(path, 'utf8');
  return raw.trim().split('\n').map((line) => JSON.parse(line) as MemoryObservation);
}

function extractedTurn(turn: number) {
  const usage = { input: 10 + turn, output: 5 + turn };
  const cost = { usd: 0.001 * turn };
  recordExtractionCost({
    provider: 'stub',
    model: 'stub-memory-model',
    usage,
    cost,
    identity,
    requestId: `memory-extraction-turn-${turn}`,
  });
  return {
    status: 'extracted' as const,
    provider: 'stub',
    result: {
      data: {
        narrative: `Durable narrative for turn ${turn}.`,
        summary: `Searchable memory summary for turn ${turn}.`,
        actionStatus: `Completed turn ${turn}`,
        tags: ['handoff'],
        files: ['src/lib/memory/pipeline.ts'],
      },
      usage,
      cost,
      model: 'stub-memory-model',
      provider: 'stub',
      requestId: `memory-extraction-turn-${turn}`,
    },
  };
}

function statusForRollup(pendingTurns: PendingTurn[]): MemoryStatus {
  return {
    name: 'PAN-1052 memory status',
    headline: 'Memory rollup reached threshold',
    summary: `Rolled up ${pendingTurns.length} pending turns.`,
    goal: 'Exercise status rollup threshold behavior.',
    phase: 'verifying',
    accomplished: pendingTurns.map((turn) => turn.id),
    decided: [],
    open: [],
    nextSteps: ['Continue collecting memory turns'],
    confidence: 0.9,
    workingSet: ['src/lib/memory/pipeline.ts'],
    tags: ['handoff'],
  };
}
