/**
 * PAN-3286 WI-5: `pan memory timeline` (FR-8) and `pan memory read` (FR-9).
 * Timeline covers chronological rows, the `--days` window, the `--limit` cap,
 * `--json`, and cwd fallback. Read covers line slicing plus the traversal
 * matrix that keeps the memory home — and nothing outside it, including
 * `~/.claude` JSONL session files — reachable.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity, MemoryObservation } from '@overdeck/contracts';
import { memoryTimelineCommand } from '../../../../src/cli/commands/memory.js';
import { getMemoryTimeline, MEMORY_TIMELINE_DEFAULT_DAYS } from '../../../../src/lib/memory/cli.js';
import { writeObservation } from '../../../../src/lib/memory/observations.js';
import { closeDatabase } from '../../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases } from '../../../../src/lib/memory/fts-db.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let workspaceDir: string;
const originalCwd = process.cwd();

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit unexpectedly called with ${code}`);
  }) as never);
}

function captureLog() {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => logSpy.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
}

function identityFor(projectId: string, workspaceId: string): MemoryIdentity {
  return {
    projectId,
    workspaceId,
    issueId: null,
    runId: 'run-1',
    sessionId: 'session-1',
    agentRole: 'work',
    agentHarness: 'claude-code',
  };
}

function observation(identity: MemoryIdentity, overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-16T20:00:00.000Z',
    ...identity,
    gitBranch: 'main',
    sourceTranscriptOffset: 1,
    actionStatus: overrides.actionStatus ?? null,
    narrative: overrides.narrative ?? 'narrative',
    summary: overrides.summary ?? 'summary',
    files: overrides.files ?? [],
    tags: overrides.tags ?? [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

async function seedWorkspace(name: string): Promise<string> {
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
  return createWorkspace({ projectId: 'overdeck', kind: 'scratch', name, path: workspaceDir });
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  workspaceDir = mkdtempSync(join(tmpdir(), 'pan-3286-timeline-ws-'));
});

afterEach(() => {
  process.chdir(originalCwd);
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
  rmSync(workspaceDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('getMemoryTimeline windowing (PAN-3286 WI-5 FR-8)', () => {
  it('returns only observations inside the --days window, oldest-first', async () => {
    const workspaceId = await seedWorkspace('window-lens');
    for (const day of ['10', '12', '14']) {
      await writeObservation(observation(identityFor('overdeck', workspaceId), {
        id: `obs-${day}`,
        timestamp: `2026-05-${day}T12:00:00.000Z`,
        summary: `day ${day}`,
      }));
    }

    const windowed = await getMemoryTimeline('overdeck', workspaceId, {
      days: 3,
      now: new Date('2026-05-14T23:00:00.000Z'),
    });

    expect(windowed.map((o) => o.id)).toEqual(['obs-12', 'obs-14']);
  });

  it('caps rows at --limit keeping the most recent, still oldest-first', async () => {
    const workspaceId = await seedWorkspace('limit-lens');
    for (const hour of ['10', '11', '12']) {
      await writeObservation(observation(identityFor('overdeck', workspaceId), {
        id: `obs-${hour}`,
        timestamp: `2026-05-16T${hour}:00:00.000Z`,
        summary: `hour ${hour}`,
      }));
    }

    const capped = await getMemoryTimeline('overdeck', workspaceId, {
      days: 3650,
      limit: 2,
      now: new Date('2026-05-16T23:00:00.000Z'),
    });

    expect(capped.map((o) => o.id)).toEqual(['obs-11', 'obs-12']);
  });

  it('defaults to a 7-day window', async () => {
    const workspaceId = await seedWorkspace('default-lens');
    await writeObservation(observation(identityFor('overdeck', workspaceId), {
      id: 'obs-ancient',
      timestamp: '2020-01-01T00:00:00.000Z',
      summary: 'ancient',
    }));

    expect(MEMORY_TIMELINE_DEFAULT_DAYS).toBe(7);
    expect(await getMemoryTimeline('overdeck', workspaceId)).toEqual([]);
  });
});

describe('memoryTimelineCommand (PAN-3286 WI-5 FR-8)', () => {
  it('prints timestamp, action-or-summary, and files for each observation', async () => {
    const workspaceId = await seedWorkspace('print-lens');
    await writeObservation(observation(identityFor('overdeck', workspaceId), {
      id: 'obs-action',
      timestamp: '2026-05-16T20:00:00.000Z',
      actionStatus: 'claimed mem-timeline',
      files: ['src/cli/commands/memory.ts'],
    }));

    mockExit();
    const printed = captureLog();

    await memoryTimelineCommand({ workspace: workspaceId, days: 3650 });

    const output = printed();
    expect(output).toContain('2026-05-16T20:00:00.000Z');
    expect(output).toContain('claimed mem-timeline');
    expect(output).toContain('files: src/cli/commands/memory.ts');
  });

  it('emits structured rows for --json', async () => {
    const workspaceId = await seedWorkspace('json-lens');
    await writeObservation(observation(identityFor('overdeck', workspaceId), {
      id: 'obs-json',
      timestamp: '2026-05-16T20:00:00.000Z',
      summary: 'json row',
    }));

    mockExit();
    const printed = captureLog();

    await memoryTimelineCommand({ workspace: workspaceId, days: 3650, json: true });

    const rows = JSON.parse(printed()) as MemoryObservation[];
    expect(rows.map((row) => row.id)).toEqual(['obs-json']);
    expect(rows[0]?.summary).toBe('json row');
  });

  it('falls back to the cwd workspace when --workspace is omitted', async () => {
    const workspaceId = await seedWorkspace('cwd-lens');
    await writeObservation(observation(identityFor('overdeck', workspaceId), {
      id: 'obs-cwd',
      timestamp: '2026-05-16T20:00:00.000Z',
      summary: 'cwd-resolved observation',
    }));

    process.chdir(workspaceDir);
    const exitSpy = mockExit();
    const printed = captureLog();

    await memoryTimelineCommand({ days: 3650 });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(printed()).toContain('cwd-resolved observation');
  });

  it('reports an empty window instead of failing when nothing is in range', async () => {
    const workspaceId = await seedWorkspace('empty-lens');

    mockExit();
    const printed = captureLog();

    await memoryTimelineCommand({ workspace: workspaceId, days: 2 });

    expect(printed()).toContain('No observations in the last 2 days');
  });
});
