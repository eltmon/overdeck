import { Effect } from 'effect';
/**
 * Tests for WAL writer (wal.ts) and WAL importer (sync-wal.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CostEvent } from '../../../src/lib/costs/events.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

// ============== Shared test data ==============

// vi.mock is hoisted — use vi.hoisted so the factory can reference these fns
const { mockListProjects: hoistedMockListProjects } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
}));

function makeCostEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    type: 'cost',
    ts: '2026-01-01T00:00:00.000Z',
    agentId: 'agent-1',
    issueId: 'PAN-335',
    sessionType: 'work',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.001,
    requestId: 'req-abc123',
    ...overrides,
  };
}

// ============== wal.ts: resolveWalDir ==============

vi.mock('../../../src/lib/projects.js', () => ({
  listProjects: hoistedMockListProjects,
  listProjectsSync: hoistedMockListProjects,
}));

describe('resolveWalDir', () => {
  let listProjects: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../../../src/lib/projects.js');
    listProjects = mod.listProjectsSync as ReturnType<typeof vi.fn>;
    listProjects.mockReset();
  });

  it('returns the events dir for a matching project key', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: '/repos/overdeck', name: 'Overdeck' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBe('/repos/overdeck/.pan/events');
  });

  it('uses events_repo when configured', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: '/repos/overdeck', events_repo: '/shared/pan-events', name: 'Overdeck' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBe('/shared/pan-events/.pan/events');
  });

  it('uses events_path when configured', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: '/repos/overdeck', events_path: 'custom/events', name: 'Overdeck' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBe('/repos/overdeck/custom/events');
  });

  it('returns null when no project matches', async () => {
    listProjects.mockReturnValue([
      { key: 'MIN', config: { path: '/repos/myn', name: 'MYN' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBeNull();
  });

  it('returns null for malformed issueId with no prefix', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: '/repos/overdeck', name: 'Overdeck' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    expect(resolveWalDir('')).toBeNull();
    expect(resolveWalDir('NOHYPHEN')).toBeNull();
  });
});

// ============== wal.ts: appendToWal ==============

describe('appendToWal', () => {
  let tmpDir: string;
  let listProjects: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `pan-wal-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const mod = await import('../../../src/lib/projects.js');
    listProjects = mod.listProjectsSync as ReturnType<typeof vi.fn>;
    listProjects.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a JSONL line to the correct WAL file', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: tmpDir, name: 'Overdeck' } },
    ]);
    const { appendToWalSync } = await import('../../../src/lib/costs/wal.js');
    const event = makeCostEvent();
    const result = appendToWalSync(event);

    expect(result).toBe(true);
    const walFile = join(tmpDir, '.pan/events/PAN-335.jsonl');
    expect(existsSync(walFile)).toBe(true);

    const line = readFileSync(walFile, 'utf-8').trim();
    const parsed = JSON.parse(line);
    expect(parsed.requestId).toBe('req-abc123');
    expect(parsed.issueId).toBe('PAN-335');
  });

  it('returns false when no project matches', async () => {
    listProjects.mockReturnValue([]);
    const { appendToWalSync } = await import('../../../src/lib/costs/wal.js');
    const result = appendToWalSync(makeCostEvent());
    expect(result).toBe(false);
  });

  it('appends multiple events as separate lines', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: tmpDir, name: 'Overdeck' } },
    ]);
    const { appendToWalSync } = await import('../../../src/lib/costs/wal.js');
    appendToWalSync(makeCostEvent({ requestId: 'req-1' }));
    appendToWalSync(makeCostEvent({ requestId: 'req-2' }));

    const walFile = join(tmpDir, '.pan/events/PAN-335.jsonl');
    const lines = readFileSync(walFile, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).requestId).toBe('req-1');
    expect(JSON.parse(lines[1]).requestId).toBe('req-2');
  });
});

// ============== sync-wal.ts: syncWalFromDir ==============

describe('syncWalFromDir', () => {
  // sync-wal now writes through the overdeck CostWriter door (not database/cost-events-db).
  // Use the real overdeck fixture to let the full Effect path run and verify via stats.
  // vi.resetModules() ensures overdeck/infra DbLive captures the new OVERDECK_HOME.
  let tmpDir: string;
  let odb: OverdeckTestDb;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pan-sync-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.resetModules();
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty stats for non-existent directory', async () => {
    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(join(tmpDir, 'no-such-dir')));
    expect(stats.imported).toBe(0);
    expect(stats.duplicates).toBe(0);
    expect(stats.files).toBe(0);
    expect(stats.errors).toHaveLength(0);
  });

  it('imports valid events from JSONL files', async () => {
    const event = makeCostEvent();
    writeFileSync(join(tmpDir, 'PAN-335.jsonl'), JSON.stringify(event) + '\n');

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(stats.imported).toBe(1);
    expect(stats.duplicates).toBe(0);
    expect(stats.files).toBe(1);
    expect(stats.errors).toHaveLength(0);
  });

  it('records the source file path in overdeck cost_events', async () => {
    const event = makeCostEvent();
    const walFile = join(tmpDir, 'PAN-335.jsonl');
    writeFileSync(walFile, JSON.stringify(event) + '\n');

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    await Effect.runPromise(syncWalFromDir(tmpDir));

    // Verify source_file was persisted in overdeck
    const rows = odb.raw().prepare('SELECT source_file FROM cost_events WHERE request_id = ?').all(event.requestId) as Array<{ source_file: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].source_file).toBe(walFile);
  });

  it('counts duplicates correctly (same requestId re-imported)', async () => {
    const event = makeCostEvent();
    writeFileSync(join(tmpDir, 'PAN-335.jsonl'), JSON.stringify(event) + '\n');

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    // First import — inserted
    await Effect.runPromise(syncWalFromDir(tmpDir));
    // Second import of same file — duplicate
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(stats.imported).toBe(0);
    expect(stats.duplicates).toBe(1);
  });

  it('skips malformed lines without failing', async () => {
    const event = makeCostEvent();
    writeFileSync(
      join(tmpDir, 'PAN-335.jsonl'),
      'not-valid-json\n' + JSON.stringify(event) + '\n',
    );

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(stats.imported).toBe(1);
    expect(stats.errors).toHaveLength(0);
  });

  it('skips lines missing required fields', async () => {
    writeFileSync(join(tmpDir, 'PAN-335.jsonl'), '{"ts":"2026-01-01"}\n');
    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(stats.imported).toBe(0);
  });

  it('ignores non-jsonl files', async () => {
    writeFileSync(join(tmpDir, 'README.txt'), 'not events');
    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(stats.files).toBe(0);
  });
});

// ============== sync-wal.ts: syncWalFromAllProjects ==============

describe('syncWalFromAllProjects', () => {
  let tmpDir: string;
  let listProjects: ReturnType<typeof vi.fn>;
  let odb: OverdeckTestDb;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `pan-sync-all-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.resetModules();
    odb = setupOverdeckTestDb();

    const projectsMod = await import('../../../src/lib/projects.js');
    listProjects = projectsMod.listProjectsSync as ReturnType<typeof vi.fn>;
    listProjects.mockReset();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty result when no projects are registered', async () => {
    listProjects.mockReturnValue([]);
    const { syncWalFromAllProjects } = await import('../../../src/lib/costs/sync-wal.js');
    const result = await Effect.runPromise(syncWalFromAllProjects());

    expect(result.imported).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.filesScanned).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips projects with no events directory', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: join(tmpDir, 'no-such-repo') } },
    ]);
    const { syncWalFromAllProjects } = await import('../../../src/lib/costs/sync-wal.js');
    const result = await Effect.runPromise(syncWalFromAllProjects());

    expect(result.filesScanned).toBe(0);
  });

  it('aggregates imported events across multiple projects', async () => {
    // Set up two project repos with events
    const repo1 = join(tmpDir, 'repo1');
    const repo2 = join(tmpDir, 'repo2');
    const eventsDir1 = join(repo1, '.pan/events');
    const eventsDir2 = join(repo2, '.pan/events');
    mkdirSync(eventsDir1, { recursive: true });
    mkdirSync(eventsDir2, { recursive: true });

    writeFileSync(join(eventsDir1, 'PAN-1.jsonl'), JSON.stringify(makeCostEvent({ issueId: 'PAN-1', requestId: 'req-pan-1' })) + '\n');
    writeFileSync(join(eventsDir2, 'MIN-1.jsonl'), JSON.stringify(makeCostEvent({ issueId: 'MIN-1', requestId: 'req-min-1' })) + '\n');

    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: repo1 } },
      { key: 'MIN', config: { path: repo2 } },
    ]);
    const { syncWalFromAllProjects } = await import('../../../src/lib/costs/sync-wal.js');
    const result = await Effect.runPromise(syncWalFromAllProjects());

    expect(result.filesScanned).toBe(2);
    expect(result.imported).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(Object.keys(result.byProject)).toHaveLength(2);
  });

  it('collects non-fatal errors without throwing', async () => {
    const repo1 = join(tmpDir, 'repo1');
    const eventsDir1 = join(repo1, '.pan/events');
    mkdirSync(eventsDir1, { recursive: true });
    writeFileSync(join(eventsDir1, 'PAN-1.jsonl'), JSON.stringify(makeCostEvent()) + '\n');

    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: repo1 } },
    ]);
    // Simulate a DB write failure by using a real overdeck DB with no schema (broken DB).
    // The easiest simulation: close the DB and remove it so writes fail.
    teardownOverdeckTestDb(odb);
    odb = setupOverdeckTestDb();
    // Corrupt the DB by removing the cost_events table so inserts throw
    odb.raw().prepare('DROP TABLE cost_events').run();

    const { syncWalFromAllProjects } = await import('../../../src/lib/costs/sync-wal.js');
    const result = await Effect.runPromise(syncWalFromAllProjects());

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('import failed');
  });
});
