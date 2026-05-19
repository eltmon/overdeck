import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation, MemoryStatus, PendingTurn } from '@panctl/contracts';
import {
  buildStatusRollupPrompt,
  commitStatusRollup,
  readArchivedStatuses,
  readCurrentStatus,
  readRecentObservations,
  synthesizeStatusRollup,
  type StatusRollupExtractCall,
} from '../../../src/lib/memory/rollup.js';
import { pendingTurnFileName, writePendingTurn } from '../../../src/lib/memory/pending.js';
import { ensureDir, resolveArchiveDir, resolveObservationsFile, resolvePendingDir, resolveStatusFile } from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
} as const;

const baseStatus: MemoryStatus = {
  name: 'Building memory status',
  headline: 'Rollup status is being synthesized.',
  summary: 'Status rollup synthesis is under test.',
  goal: 'Activity feed memory substrate',
  phase: 'building',
  accomplished: ['Added prompt builder'],
  decided: ['Status is a replacement, not cumulative'],
  open: [],
  nextSteps: ['Commit status atomically'],
  confidence: 0.8,
  workingSet: ['src/lib/memory/rollup.ts'],
  tags: ['memory'],
};

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-rollup-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function observation(index: number): MemoryObservation {
  return {
    id: `obs-${index}`,
    timestamp: `2026-05-16T20:${String(index).padStart(2, '0')}:00.000Z`,
    ...identity,
    gitBranch: 'feature/pan-1052',
    sourceTranscriptOffset: index,
    actionStatus: `Action ${index}`,
    narrative: `Narrative ${index}`,
    summary: `Summary ${index}`,
    files: [`file-${index}.ts`],
    tags: ['memory'],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

function pendingTurn(index: number): PendingTurn {
  return {
    id: `pending-${index}`,
    createdAt: `2026-05-16T21:0${index}:00.000Z`,
    identity: { ...identity, sessionId: `session-${index}` },
    trigger: 'stop-hook',
    transcriptPath: `/tmp/session-${index}.jsonl`,
    fromOffset: index * 10,
    toOffset: index * 10 + 9,
    lastFullLineOffset: index * 10 + 9,
    eventsConsumed: index,
    compressedText: `U: work ${index}\nA: completed ${index}`,
  };
}

function extracted(data: unknown) {
  return {
    status: 'extracted' as const,
    provider: 'stub',
    result: {
      data,
      usage: { input: 20, output: 10 },
      cost: { usd: 0 },
      model: 'stub-model',
      provider: 'stub',
    },
  };
}

describe('memory status rollup synthesis', () => {
  it('builds a prompt with archived statuses, recent observations, pending turns, and replacement guidance', () => {
    const observations = Array.from({ length: 25 }, (_, index) => observation(index + 1)).slice(-20);
    const archivedStatuses = [
      { ...baseStatus, name: 'Archived one' },
      { ...baseStatus, name: 'Archived two' },
      { ...baseStatus, name: 'Archived three' },
    ];

    const prompt = buildStatusRollupPrompt({
      pendingTurns: [pendingTurn(1)],
      observations,
      archivedStatuses,
    });

    expect(prompt).toContain('Last 3 archived statuses');
    expect(prompt).toContain('Archived three');
    expect(prompt).toContain('Last 20 observations');
    expect(prompt).toContain('Summary 25');
    expect(prompt).not.toContain('- Summary: Summary 1\n');
    expect(prompt).toContain('New pending turns');
    expect(prompt).toContain('U: work 1\nA: completed 1');
    expect(prompt).toContain('fresh replacement, not a cumulative append-only summary');
    expect(prompt).toContain('Refresh workingSet every cycle');
    expect(prompt).toContain('exploring, planning, building, verifying, cleaning, shipping');
  });

  it('loads the last 20 observations and last 3 archived statuses from memory storage', async () => {
    const observationsPath = resolveObservationsFile(identity.projectId, identity.issueId, '2026-05-16T00:00:00.000Z');
    await ensureDir(join(tempDir!, 'memory/panopticon-cli/PAN-1052/observations'));
    await writeFile(
      observationsPath,
      `${Array.from({ length: 25 }, (_, index) => JSON.stringify(observation(index + 1))).join('\n')}\n`,
      'utf8',
    );

    const archiveDir = resolveArchiveDir(identity.projectId, identity.issueId);
    await ensureDir(archiveDir);
    await writeFile(join(archiveDir, '2026-05-14_one.json'), JSON.stringify({ ...baseStatus, name: 'Old' }), 'utf8');
    await writeFile(join(archiveDir, '2026-05-15_two.json'), JSON.stringify({ ...baseStatus, name: 'Two' }), 'utf8');
    await writeFile(join(archiveDir, '2026-05-16_three.json'), JSON.stringify({ ...baseStatus, name: 'Three' }), 'utf8');
    await writeFile(join(archiveDir, '2026-05-17_four.json'), JSON.stringify({ ...baseStatus, name: 'Four' }), 'utf8');

    expect((await readRecentObservations(identity.projectId, identity.issueId)).map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `obs-${index + 6}`),
    );
    expect((await readArchivedStatuses(identity.projectId, identity.issueId)).map((status) => status.name)).toEqual([
      'Two',
      'Three',
      'Four',
    ]);
  });

  it('returns a validated memory status from a provider payload without carrying forward stale workingSet entries', async () => {
    const extract: StatusRollupExtractCall = async () => extracted({
      ...baseStatus,
      workingSet: ['src/lib/memory/rollup.ts'],
    });

    const result = await synthesizeStatusRollup({
      projectId: identity.projectId,
      issueId: identity.issueId,
      pendingTurns: [pendingTurn(1)],
      observations: [observation(1)],
      archivedStatuses: [{ ...baseStatus, workingSet: ['stale-file.ts'] }],
      extract,
    });

    expect(result).toEqual({
      status: 'synthesized',
      memoryStatus: {
        ...baseStatus,
        workingSet: ['src/lib/memory/rollup.ts'],
      },
    });
  });

  it('retries once after a malformed status response', async () => {
    let calls = 0;
    const extract: StatusRollupExtractCall = async () => {
      calls += 1;
      if (calls === 1) return extracted({ ...baseStatus, phase: 'invalid' });
      return extracted({ ...baseStatus, phase: 'verifying' });
    };

    const result = await synthesizeStatusRollup({
      projectId: identity.projectId,
      issueId: identity.issueId,
      pendingTurns: [pendingTurn(1)],
      observations: [],
      archivedStatuses: [],
      extract,
    });

    expect(calls).toBe(2);
    expect(result.status).toBe('synthesized');
    if (result.status === 'synthesized') expect(result.memoryStatus.phase).toBe('verifying');
  });

  it('drops after two malformed status responses', async () => {
    const extract: StatusRollupExtractCall = async () => extracted({ ...baseStatus, phase: 'invalid' });

    await expect(synthesizeStatusRollup({
      projectId: identity.projectId,
      issueId: identity.issueId,
      pendingTurns: [pendingTurn(1)],
      observations: [],
      archivedStatuses: [],
      extract,
    })).resolves.toEqual({ status: 'dropped', reason: 'malformed-response' });
  });

  it('archives previous status, writes the new status, emits after commit, then clears included pending turns', async () => {
    const previousStatus = { ...baseStatus, name: 'Previous Status' };
    const nextStatus = { ...baseStatus, name: 'Next Status', phase: 'shipping' as const };
    await ensureDir(join(tempDir!, 'memory/panopticon-cli/PAN-1052'));
    await writeFile(resolveStatusFile(identity.projectId, identity.issueId), `${JSON.stringify(previousStatus)}\n`, 'utf8');
    const turns = [pendingTurn(1), pendingTurn(2)];
    for (const turn of turns) await writePendingTurn(turn, { loadThreshold: () => 10 });

    const emitted: unknown[] = [];
    const result = await commitStatusRollup({
      identity,
      status: nextStatus,
      pendingTurns: turns,
      now: new Date('2026-05-16T22:00:00.000Z'),
      emitStatusUpdated: async (event) => {
        expect(JSON.parse(await readFile(resolveStatusFile(identity.projectId, identity.issueId), 'utf8'))).toEqual(nextStatus);
        emitted.push(event);
      },
    });

    expect(result.previousStatus).toEqual(previousStatus);
    expect(JSON.parse(await readFile(resolveStatusFile(identity.projectId, identity.issueId), 'utf8'))).toEqual(nextStatus);
    expect(JSON.parse(await readFile(result.archivedPath!, 'utf8'))).toEqual(previousStatus);
    expect(emitted).toEqual([{ identity: { projectId: identity.projectId, workspaceId: identity.workspaceId, issueId: identity.issueId }, status: nextStatus, previousStatus }]);
    await expect(readdir(resolvePendingDir(identity.projectId, identity.issueId))).resolves.toEqual([]);
    expect(result.clearedPending.map((path) => path.split('/').at(-1))).toEqual(turns.map(pendingTurnFileName));
  });

  it('leaves pending turns intact when rollup commit fails before the clear step', async () => {
    const previousStatus = { ...baseStatus, name: 'Previous Status' };
    const nextStatus = { ...baseStatus, name: 'Next Status' };
    await ensureDir(join(tempDir!, 'memory/panopticon-cli/PAN-1052'));
    await writeFile(resolveStatusFile(identity.projectId, identity.issueId), `${JSON.stringify(previousStatus)}\n`, 'utf8');
    const turn = pendingTurn(1);
    await writePendingTurn(turn, { loadThreshold: () => 10 });

    await expect(commitStatusRollup({
      identity,
      status: nextStatus,
      pendingTurns: [turn],
      failAfterStatusWrite: true,
    })).rejects.toThrow('Injected rollup status write failure');

    await expect(readdir(resolvePendingDir(identity.projectId, identity.issueId))).resolves.toEqual([pendingTurnFileName(turn)]);
    expect(await readCurrentStatus(identity.projectId, identity.issueId)).toEqual(nextStatus);
  });

  it('keeps only the latest three archived statuses', async () => {
    const archiveDir = resolveArchiveDir(identity.projectId, identity.issueId);
    await ensureDir(archiveDir);
    await writeFile(join(archiveDir, '2026-05-13_old.json'), JSON.stringify({ ...baseStatus, name: 'Old' }), 'utf8');
    await writeFile(join(archiveDir, '2026-05-14_one.json'), JSON.stringify({ ...baseStatus, name: 'One' }), 'utf8');
    await writeFile(join(archiveDir, '2026-05-15_two.json'), JSON.stringify({ ...baseStatus, name: 'Two' }), 'utf8');
    await ensureDir(join(tempDir!, 'memory/panopticon-cli/PAN-1052'));
    await writeFile(resolveStatusFile(identity.projectId, identity.issueId), JSON.stringify({ ...baseStatus, name: 'Three' }), 'utf8');

    await commitStatusRollup({
      identity,
      status: { ...baseStatus, name: 'Current' },
      pendingTurns: [],
      now: new Date('2026-05-16T22:00:00.000Z'),
      emitStatusUpdated: () => undefined,
    });

    const files = await readdir(archiveDir);
    expect(files).toHaveLength(3);
    expect(files).toEqual(expect.arrayContaining([
      '2026-05-14_one.json',
      '2026-05-15_two.json',
    ]));
    expect(files.some((file) => file.startsWith('2026-05-16T22-00-00-000Z_three_') && file.endsWith('.json'))).toBe(true);
  });
});
