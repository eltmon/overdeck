import { appendFile, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation, MemoryIdentity } from '@overdeck/contracts';
import {
  createResetMarker,
  generateDailySummary,
  runMemoryDoctor,
  searchMemory,
} from '../../../src/lib/memory/cli.js';
import { ensureDir, resolveObservationsFile, resolvePendingDir } from '../../../src/lib/memory/paths.js';
import { getMemoryHealthPath } from '../../../src/lib/memory/health.js';
import { closeDatabase } from '../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases, withMemoryFtsDatabase } from '../../../src/lib/memory/fts-db.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let identity: MemoryIdentity;
let workspace999: string;
let workspace998: string;
let workspace997: string;

function registerWorkspace(issueId: string, name: string): Promise<string> {
  return createWorkspace({
    projectId: 'overdeck',
    kind: 'issue',
    name,
    path: join(odb.home, 'workspaces', name),
    issueId,
  });
}

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
  const workspaceId = await registerWorkspace('PAN-1052', 'feature-pan-1052');
  identity = {
    projectId: 'overdeck',
    workspaceId,
    issueId: 'PAN-1052',
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
  };
  workspace999 = await registerWorkspace('PAN-999', 'feature-pan-999');
  workspace998 = await registerWorkspace('PAN-998', 'feature-pan-998');
  workspace997 = await registerWorkspace('PAN-997', 'feature-pan-997');
});

afterEach(() => {
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
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
  const path = resolveObservationsFile(item.projectId, item.workspaceId, item.timestamp);
  await ensureDir(join(odb.home, 'memory', item.projectId, item.workspaceId, 'observations'));
  await appendFile(path, `${JSON.stringify(item)}\n`, 'utf8');
}

describe('pan memory CLI service', () => {
  it('searches observations with issue, tag, workspace, and sibling filters', async () => {
    await writeObservationRecord(observation({ id: 'primary', summary: 'Primary memory result', tags: ['memory'] }));
    await writeObservationRecord(observation({
      id: 'sibling',
      issueId: 'PAN-999',
      workspaceId: workspace999,
      summary: 'Sibling memory result',
      tags: ['memory', 'handoff'],
    }));
    await writeObservationRecord(observation({ id: 'other-tag', summary: 'Primary unrelated result', tags: ['other'] }));

    expect((await searchMemory('primary', { project: 'overdeck', issue: 'PAN-1052', tag: 'memory' })).map((r) => r.observation.id))
      .toEqual(['primary']);
    expect((await searchMemory('sibling', { project: 'overdeck', issue: 'PAN-1052', sibling: true })).map((r) => r.observation.id))
      .toEqual(['sibling']);
    expect((await searchMemory('primary', { project: 'overdeck', workspace: 'other-workspace' }))).toEqual([]);
  });

  it('applies project, workspace, issue, and session reset markers at read time', async () => {
    await writeObservationRecord(observation({ id: 'issue-archived', summary: 'issue scoped memory', timestamp: '2026-05-16T20:00:00.000Z' }));
    await writeObservationRecord(observation({ id: 'workspace-live', summary: 'workspace scoped memory', issueId: 'PAN-999', workspaceId: workspace999, timestamp: '2026-05-16T22:00:00.000Z' }));
    await writeObservationRecord(observation({ id: 'session-archived', summary: 'session scoped memory', issueId: 'PAN-998', workspaceId: workspace998, timestamp: '2026-05-16T20:00:00.000Z' }));
    await writeObservationRecord(observation({ id: 'project-live', summary: 'project scoped memory', issueId: 'PAN-997', workspaceId: workspace997, sessionId: 'session-997', timestamp: '2026-05-16T22:00:00.000Z' }));

    await createResetMarker({
      projectId: 'overdeck',
      scope: 'issue',
      scopeId: 'PAN-1052',
      reason: 'issue reset',
      fromTimestamp: '2026-05-16T21:00:00.000Z',
      createdAt: '2026-05-16T21:00:00.000Z',
      emitResetMarkerCreated: async () => undefined,
    });
    await createResetMarker({
      projectId: 'overdeck',
      scope: 'workspace',
      scopeId: identity.workspaceId,
      reason: 'workspace reset',
      fromTimestamp: '2026-05-16T21:00:00.000Z',
      createdAt: '2026-05-16T21:00:00.000Z',
      emitResetMarkerCreated: async () => undefined,
    });
    await createResetMarker({
      projectId: 'overdeck',
      scope: 'session',
      scopeId: 'session-1',
      reason: 'session reset',
      fromTimestamp: '2026-05-16T21:00:00.000Z',
      createdAt: '2026-05-16T21:00:00.000Z',
      emitResetMarkerCreated: async () => undefined,
    });
    await createResetMarker({
      projectId: 'overdeck',
      scope: 'project',
      scopeId: 'overdeck',
      reason: 'project reset',
      fromTimestamp: '2026-05-16T21:00:00.000Z',
      createdAt: '2026-05-16T21:00:00.000Z',
      emitResetMarkerCreated: async () => undefined,
    });

    expect((await searchMemory('scoped', { project: 'overdeck', includeArchived: true })).map((r) => r.observation.id).sort())
      .toEqual(['issue-archived', 'project-live', 'session-archived', 'workspace-live']);
    expect((await searchMemory('scoped', { project: 'overdeck' })).map((r) => r.observation.id).sort())
      .toEqual(['project-live', 'workspace-live']);
  });

  it('creates reset markers without deleting memory records', async () => {
    await writeObservationRecord(observation());
    const events: Array<{ marker: unknown; timestamp: string }> = [];

    const marker = await createResetMarker({
      projectId: 'overdeck',
      scope: 'issue',
      scopeId: 'PAN-1052',
      reason: 'test reset',
      id: 'reset-1',
      fromTimestamp: '2026-05-16T21:00:00.000Z',
      createdAt: '2026-05-16T21:00:00.000Z',
      emitResetMarkerCreated: (createdMarker, timestamp) => events.push({ marker: createdMarker, timestamp }),
    });

    const indexedMarkers = await withMemoryFtsDatabase('overdeck', (db) => db.prepare('SELECT scope, scope_id, from_timestamp, reason, created_at FROM reset_markers').all());

    expect(marker.id).toBe('reset-1');
    expect((await searchMemory('memory', { project: 'overdeck', issue: 'PAN-1052' }))).toHaveLength(0);
    expect((await searchMemory('memory', { project: 'overdeck', issue: 'PAN-1052', includeArchived: true }))).toHaveLength(1);
    expect(JSON.parse(await readFile(join(odb.home, 'memory/overdeck/reset-markers.json'), 'utf8'))).toEqual([marker]);
    expect(indexedMarkers).toEqual([{
      scope: 'issue',
      scope_id: 'PAN-1052',
      from_timestamp: '2026-05-16T21:00:00.000Z',
      reason: 'test reset',
      created_at: '2026-05-16T21:00:00.000Z',
    }]);
    expect(events).toEqual([{ marker, timestamp: '2026-05-16T21:00:00.000Z' }]);
  });

  it('returns insufficient data below the daily summary observation threshold', async () => {
    await writeObservationRecord(observation({ id: 'summary-1', summary: 'First observation' }));
    await writeObservationRecord(observation({ id: 'summary-2', summary: 'Second observation', timestamp: '2026-05-16T20:01:00.000Z' }));

    const result = await generateDailySummary({
      projectId: 'overdeck',
      issueId: 'PAN-1052',
      date: '2026-05-16',
    });

    expect(result.status).toBe('insufficient-data');
    expect(result.observationCount).toBe(2);
    await expect(readFile(result.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('generates a daily summary markdown file and indexes it into FTS', async () => {
    for (let index = 0; index < 3; index += 1) {
      await writeObservationRecord(observation({
        id: `summary-${index}`,
        summary: `Summary-ready observation ${index}`,
        timestamp: `2026-05-16T20:0${index}:00.000Z`,
      }));
    }

    const result = await generateDailySummary({
      projectId: 'overdeck',
      issueId: 'PAN-1052',
      date: '2026-05-16',
    });
    const indexedSummaries = await withMemoryFtsDatabase('overdeck', (db) => db.prepare(`
      SELECT content, doc_type, scope, project_id, issue_id, tags
      FROM memory_fts
      WHERE doc_type = 'summary'
    `).all());

    expect(result.status).toBe('generated');
    expect(result.observationCount).toBe(3);
    expect(result.markdown).toContain('Summary-ready observation 2');
    expect(await readFile(result.path, 'utf8')).toBe(result.markdown);
    expect(indexedSummaries).toEqual([expect.objectContaining({
      content: result.markdown,
      doc_type: 'summary',
      scope: 'issue',
      project_id: 'overdeck',
      issue_id: 'PAN-1052',
      tags: expect.stringContaining('summary'),
    })]);
  });

  it('regenerates an existing daily summary only after twenty new observations', async () => {
    for (let index = 0; index < 3; index += 1) {
      await writeObservationRecord(observation({
        id: `initial-${index}`,
        summary: `Initial observation ${index}`,
        timestamp: `2026-05-16T20:0${index}:00.000Z`,
      }));
    }
    const initial = await generateDailySummary({ projectId: 'overdeck', issueId: 'PAN-1052', date: '2026-05-16' });

    for (let index = 0; index < 19; index += 1) {
      await writeObservationRecord(observation({
        id: `unchanged-${index}`,
        summary: `Unchanged observation ${index}`,
        timestamp: `2026-05-16T21:${index.toString().padStart(2, '0')}:00.000Z`,
      }));
    }
    const unchanged = await generateDailySummary({ projectId: 'overdeck', issueId: 'PAN-1052', date: '2026-05-16' });

    await writeObservationRecord(observation({
      id: 'regenerated-20',
      summary: 'Twentieth new observation',
      timestamp: '2026-05-16T21:19:00.000Z',
    }));
    const regenerated = await generateDailySummary({ projectId: 'overdeck', issueId: 'PAN-1052', date: '2026-05-16' });

    expect(unchanged.status).toBe('up-to-date');
    expect(unchanged.markdown).toBe(initial.markdown);
    expect(regenerated.status).toBe('generated');
    expect(regenerated.previousObservationCount).toBe(3);
    expect(regenerated.observationCount).toBe(23);
    expect(regenerated.markdown).toContain('Twentieth new observation');
  });

  it('reports stale active agents with a non-zero doctor exit code', async () => {
    await ensureDir(join(odb.home, 'agents/agent-pan-1052'));
    await writeFile(join(odb.home, 'agents/agent-pan-1052/state.json'), JSON.stringify({
      id: 'agent-pan-1052',
      issueId: 'PAN-1052',
      status: 'running',
      role: 'work',
    }), 'utf8');
    await ensureDir(resolvePendingDir('overdeck', identity.workspaceId));
    await writeFile(join(resolvePendingDir('overdeck', identity.workspaceId), 'pending.json'), '{}\n', 'utf8');
    await ensureDir(join(odb.home, 'memory/overdeck', identity.workspaceId));
    await writeFile(getMemoryHealthPath({ projectId: 'overdeck', workspaceId: identity.workspaceId }), JSON.stringify({
      status: 'healthy',
      last_success: '2026-05-16T19:00:00.000Z',
      last_failure: null,
      extractions_attempted: 1,
      extractions_succeeded: 1,
      failed_by_reason: {},
    }), 'utf8');

    const result = await runMemoryDoctor({ project: 'overdeck', now: new Date('2026-05-16T21:00:00.000Z') });

    expect(result.exitCode).toBe(1);
    expect(result.issues.find((issue) => issue.issueId === 'PAN-1052')).toMatchObject({ issueId: 'PAN-1052', pendingCount: 1 });
    expect(result.staleActiveAgents).toEqual([{ agentId: 'agent-pan-1052', issueId: 'PAN-1052', lastSuccess: '2026-05-16T19:00:00.000Z' }]);
  });
});
