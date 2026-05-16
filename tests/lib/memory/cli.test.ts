import { appendFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation, MemoryIdentity } from '@panctl/contracts';
import {
  createResetMarker,
  generateDailySummary,
  runMemoryDoctor,
  searchMemory,
} from '../../../src/lib/memory/cli.js';
import { ensureDir, resolveObservationsFile, resolvePendingDir } from '../../../src/lib/memory/paths.js';
import { getMemoryHealthPath } from '../../../src/lib/memory/health.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

const identity: MemoryIdentity = {
  projectId: 'panopticon-cli',
  workspaceId: 'feature-pan-1052',
  issueId: 'PAN-1052',
  runId: 'run-1',
  sessionId: 'session-1',
  agentRole: 'work',
  agentHarness: 'claude-code',
};

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-cli-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function observation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-16T20:00:00.000Z',
    ...identity,
    issueId: overrides.issueId ?? identity.issueId,
    workspaceId: overrides.workspaceId ?? identity.workspaceId,
    gitBranch: 'feature/pan-1052',
    sourceTranscriptOffset: 1,
    actionStatus: overrides.actionStatus ?? 'Implemented memory search',
    narrative: overrides.narrative ?? 'Added CLI memory search support.',
    summary: overrides.summary ?? 'Memory search can find observations.',
    files: overrides.files ?? ['src/lib/memory/cli.ts'],
    tags: overrides.tags ?? ['memory'],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

async function writeObservationRecord(item: MemoryObservation): Promise<void> {
  const path = resolveObservationsFile(item.projectId, item.issueId, item.timestamp);
  await ensureDir(join(tempDir!, 'memory', item.projectId, item.issueId, 'observations'));
  await appendFile(path, `${JSON.stringify(item)}\n`, 'utf8');
}

describe('pan memory CLI service', () => {
  it('searches observations with issue, tag, workspace, and sibling filters', async () => {
    await writeObservationRecord(observation({ id: 'primary', summary: 'Primary memory result', tags: ['memory'] }));
    await writeObservationRecord(observation({
      id: 'sibling',
      issueId: 'PAN-999',
      summary: 'Sibling memory result',
      tags: ['memory', 'handoff'],
    }));
    await writeObservationRecord(observation({ id: 'other-tag', summary: 'Primary unrelated result', tags: ['other'] }));

    expect((await searchMemory('primary', { project: 'panopticon-cli', issue: 'PAN-1052', tag: 'memory' })).map((r) => r.observation.id))
      .toEqual(['primary']);
    expect((await searchMemory('sibling', { project: 'panopticon-cli', issue: 'PAN-1052', sibling: true })).map((r) => r.observation.id))
      .toEqual(['sibling']);
    expect((await searchMemory('primary', { project: 'panopticon-cli', workspace: 'other-workspace' }))).toEqual([]);
  });

  it('creates reset markers without deleting memory records', async () => {
    await writeObservationRecord(observation());

    const marker = await createResetMarker({
      projectId: 'panopticon-cli',
      scope: 'issue',
      scopeId: 'PAN-1052',
      reason: 'test reset',
      id: 'reset-1',
      fromTimestamp: '2026-05-16T00:00:00.000Z',
      createdAt: '2026-05-16T21:00:00.000Z',
    });

    expect(marker.id).toBe('reset-1');
    expect((await searchMemory('memory', { project: 'panopticon-cli', issue: 'PAN-1052' }))).toHaveLength(1);
    expect(JSON.parse(await readFile(join(tempDir!, 'memory/panopticon-cli/reset-markers.json'), 'utf8'))).toEqual([marker]);
  });

  it('generates a daily summary markdown file', async () => {
    await writeObservationRecord(observation({ summary: 'Summary-ready observation' }));

    const result = await generateDailySummary({
      projectId: 'panopticon-cli',
      issueId: 'PAN-1052',
      date: '2026-05-16',
    });

    expect(result.observationCount).toBe(1);
    expect(result.markdown).toContain('Summary-ready observation');
    expect(await readFile(result.path, 'utf8')).toBe(result.markdown);
  });

  it('reports stale active agents with a non-zero doctor exit code', async () => {
    await ensureDir(join(tempDir!, 'agents/agent-pan-1052'));
    await writeFile(join(tempDir!, 'agents/agent-pan-1052/state.json'), JSON.stringify({
      id: 'agent-pan-1052',
      issueId: 'PAN-1052',
      status: 'running',
      role: 'work',
    }), 'utf8');
    await ensureDir(resolvePendingDir('panopticon-cli', 'PAN-1052'));
    await writeFile(join(resolvePendingDir('panopticon-cli', 'PAN-1052'), 'pending.json'), '{}\n', 'utf8');
    await ensureDir(join(tempDir!, 'memory/panopticon-cli/PAN-1052'));
    await writeFile(getMemoryHealthPath({ projectId: 'panopticon-cli', issueId: 'PAN-1052' }), JSON.stringify({
      status: 'healthy',
      last_success: '2026-05-16T19:00:00.000Z',
      last_failure: null,
      extractions_attempted: 1,
      extractions_succeeded: 1,
      failed_by_reason: {},
    }), 'utf8');

    const result = await runMemoryDoctor({ project: 'panopticon-cli', now: new Date('2026-05-16T21:00:00.000Z') });

    expect(result.exitCode).toBe(1);
    expect(result.issues[0]).toMatchObject({ issueId: 'PAN-1052', pendingCount: 1 });
    expect(result.staleActiveAgents).toEqual([{ agentId: 'agent-pan-1052', issueId: 'PAN-1052', lastSuccess: '2026-05-16T19:00:00.000Z' }]);
  });
});
