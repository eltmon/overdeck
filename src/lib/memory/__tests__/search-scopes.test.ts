/**
 * PAN-1990 memory-search-scopes: `pan memory search` --workspace/--global
 * flags (FR-9). --workspace and --project already existed pre-PAN-1990;
 * these tests lock the --workspace scoping (ac1), add --global multi-project
 * merge-by-score (ac2), and confirm the default stays project-scoped (ac3).
 */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryObservation, MemoryIdentity } from '@overdeck/contracts';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../tests/helpers/overdeck-test-db.js';
import { searchMemory } from '../cli.js';
import { writeObservation } from '../observations.js';
import { closeMemoryFtsDatabases } from '../fts-db.js';
import { closeDatabase } from '../../database/index.js';
import { createWorkspace, upsertProjectFromConfig } from '../../workspaces/writer.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
});

function baseIdentity(overrides: Partial<MemoryIdentity>): MemoryIdentity {
  return {
    projectId: 'overdeck',
    workspaceId: 'workspace-x',
    issueId: null,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'conversation',
    agentHarness: 'claude-code',
    ...overrides,
  };
}

function observation(identity: MemoryIdentity, overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-07-28T20:00:00.000Z',
    ...identity,
    gitBranch: 'main',
    sourceTranscriptOffset: 1,
    actionStatus: null,
    narrative: overrides.narrative ?? 'A memory-search-scopes turn.',
    summary: overrides.summary ?? 'memory-search-scopes summary',
    files: overrides.files ?? [],
    tags: overrides.tags ?? [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

// PAN-1990 FR-9 review fix: searchMemory now queries the memory_fts index
// (see cli.ts), which only a real observation write populates — a raw JSONL
// append (the pre-fix helper here) is invisible to it. writeObservation is
// the same production write path every real observation goes through.
async function writeObservationRecord(item: MemoryObservation): Promise<void> {
  await writeObservation(item);
}

describe('pan memory search --workspace (ac1)', () => {
  it('returns only observations for the given workspace', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: odb.home });
    const workspaceA = await createWorkspace({ projectId: 'overdeck', kind: 'scratch', name: 'ws-a', path: join(odb.home, 'ws-a') });
    const workspaceB = await createWorkspace({ projectId: 'overdeck', kind: 'scratch', name: 'ws-b', path: join(odb.home, 'ws-b') });

    await writeObservationRecord(observation(baseIdentity({ workspaceId: workspaceA }), { id: 'in-a', summary: 'workspace A memory' }));
    await writeObservationRecord(observation(baseIdentity({ workspaceId: workspaceB }), { id: 'in-b', summary: 'workspace B memory' }));

    const results = await searchMemory('memory', { project: 'overdeck', workspace: workspaceA });

    expect(results.map((r) => r.observation.id)).toEqual(['in-a']);
  });
});

describe('pan memory search --global (ac2, ac3)', () => {
  it('merges hits across every registered project, ordered by rank', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
    upsertProjectFromConfig('other-project', { name: 'Other Project', path: join(odb.home, 'other-project') });
    const workspaceOverdeck = await createWorkspace({ projectId: 'overdeck', kind: 'scratch', name: 'ws-overdeck', path: join(odb.home, 'ws-overdeck') });
    const workspaceOther = await createWorkspace({ projectId: 'other-project', kind: 'scratch', name: 'ws-other', path: join(odb.home, 'ws-other') });

    await writeObservationRecord(observation(baseIdentity({ projectId: 'overdeck', workspaceId: workspaceOverdeck }), {
      id: 'overdeck-hit',
      summary: 'rollup rollup rollup memory',
    }));
    await writeObservationRecord(observation(baseIdentity({ projectId: 'other-project', workspaceId: workspaceOther }), {
      id: 'other-project-hit',
      summary: 'rollup memory',
    }));

    const results = await searchMemory('rollup', { global: true });

    expect(results.map((r) => r.observation.id)).toEqual(['overdeck-hit', 'other-project-hit']);
    expect(results.map((r) => r.observation.projectId)).toEqual(['overdeck', 'other-project']);
  });

  it('without --global, the default invocation stays scoped to one project', async () => {
    upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: join(odb.home, 'overdeck') });
    upsertProjectFromConfig('other-project', { name: 'Other Project', path: join(odb.home, 'other-project') });
    const workspaceOverdeck = await createWorkspace({ projectId: 'overdeck', kind: 'scratch', name: 'ws-overdeck-2', path: join(odb.home, 'ws-overdeck-2') });
    const workspaceOther = await createWorkspace({ projectId: 'other-project', kind: 'scratch', name: 'ws-other-2', path: join(odb.home, 'ws-other-2') });

    await writeObservationRecord(observation(baseIdentity({ projectId: 'overdeck', workspaceId: workspaceOverdeck }), {
      id: 'overdeck-hit',
      summary: 'rollup memory',
    }));
    await writeObservationRecord(observation(baseIdentity({ projectId: 'other-project', workspaceId: workspaceOther }), {
      id: 'other-project-hit',
      summary: 'rollup memory',
    }));

    const results = await searchMemory('rollup', { project: 'overdeck' });

    expect(results.map((r) => r.observation.id)).toEqual(['overdeck-hit']);
  });
});
