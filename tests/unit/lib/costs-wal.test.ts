import { Effect } from 'effect';
/**
 * Tests for WAL writer (wal.ts) and WAL importer (sync-wal.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CostEvent } from '../../../src/lib/costs/events.js';

// ============== Shared test data ==============

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
  listProjects: vi.fn(),
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
      { key: 'PAN', config: { path: '/repos/panopticon', name: 'Panopticon' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBe('/repos/panopticon/.pan/events');
  });

  it('uses events_repo when configured', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: '/repos/panopticon', events_repo: '/shared/pan-events', name: 'Panopticon' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBe('/shared/pan-events/.pan/events');
  });

  it('uses events_path when configured', async () => {
    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: '/repos/panopticon', events_path: 'custom/events', name: 'Panopticon' } },
    ]);
    const { resolveWalDir } = await import('../../../src/lib/costs/wal.js');
    const dir = resolveWalDir('PAN-335');
    expect(dir).toBe('/repos/panopticon/custom/events');
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
      { key: 'PAN', config: { path: '/repos/panopticon', name: 'Panopticon' } },
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
      { key: 'PAN', config: { path: tmpDir, name: 'Panopticon' } },
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
      { key: 'PAN', config: { path: tmpDir, name: 'Panopticon' } },
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

vi.mock('../../../src/lib/database/cost-events-db.js', () => ({
  insertCostEvents: vi.fn(),
}));

describe('syncWalFromDir', () => {
  let tmpDir: string;
  let insertCostEvents: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `pan-sync-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const mod = await import('../../../src/lib/database/cost-events-db.js');
    insertCostEvents = mod.insertCostEvents as ReturnType<typeof vi.fn>;
    insertCostEvents.mockReset();
    insertCostEvents.mockReturnValue({ inserted: 0, duplicates: 0 });
  });

  afterEach(() => {
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
    insertCostEvents.mockReturnValue({ inserted: 1, duplicates: 0 });

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(insertCostEvents).toHaveBeenCalledOnce();
    expect(stats.imported).toBe(1);
    expect(stats.duplicates).toBe(0);
    expect(stats.files).toBe(1);
    expect(stats.errors).toHaveLength(0);
  });

  it('passes the source file path to insertCostEvents', async () => {
    const event = makeCostEvent();
    const walFile = join(tmpDir, 'PAN-335.jsonl');
    writeFileSync(walFile, JSON.stringify(event) + '\n');
    insertCostEvents.mockReturnValue({ inserted: 1, duplicates: 0 });

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(insertCostEvents).toHaveBeenCalledWith(expect.any(Array), walFile);
  });

  it('counts duplicates correctly', async () => {
    const event = makeCostEvent();
    writeFileSync(join(tmpDir, 'PAN-335.jsonl'), JSON.stringify(event) + '\n');
    insertCostEvents.mockReturnValue({ inserted: 0, duplicates: 1 });

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
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
    insertCostEvents.mockReturnValue({ inserted: 1, duplicates: 0 });

    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    // The valid event should still be imported; malformed line silently skipped
    expect(stats.imported).toBe(1);
    expect(stats.errors).toHaveLength(0);
  });

  it('skips lines missing required fields', async () => {
    writeFileSync(join(tmpDir, 'PAN-335.jsonl'), '{"ts":"2026-01-01"}\n');
    // No valid events → insertCostEvents not called
    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(insertCostEvents).not.toHaveBeenCalled();
    expect(stats.imported).toBe(0);
  });

  it('ignores non-jsonl files', async () => {
    writeFileSync(join(tmpDir, 'README.txt'), 'not events');
    const { syncWalFromDir } = await import('../../../src/lib/costs/sync-wal.js');
    const stats = await Effect.runPromise(syncWalFromDir(tmpDir));

    expect(insertCostEvents).not.toHaveBeenCalled();
    expect(stats.files).toBe(0);
  });
});

// ============== sync-wal.ts: syncWalFromAllProjects ==============

describe('syncWalFromAllProjects', () => {
  let tmpDir: string;
  let listProjects: ReturnType<typeof vi.fn>;
  let insertCostEvents: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `pan-sync-all-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const projectsMod = await import('../../../src/lib/projects.js');
    listProjects = projectsMod.listProjectsSync as ReturnType<typeof vi.fn>;
    listProjects.mockReset();

    const dbMod = await import('../../../src/lib/database/cost-events-db.js');
    insertCostEvents = dbMod.insertCostEvents as ReturnType<typeof vi.fn>;
    insertCostEvents.mockReset();
    insertCostEvents.mockReturnValue({ inserted: 0, duplicates: 0 });
  });

  afterEach(() => {
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
    expect(insertCostEvents).not.toHaveBeenCalled();
  });

  it('aggregates imported events across multiple projects', async () => {
    // Set up two project repos with events
    const repo1 = join(tmpDir, 'repo1');
    const repo2 = join(tmpDir, 'repo2');
    const eventsDir1 = join(repo1, '.pan/events');
    const eventsDir2 = join(repo2, '.pan/events');
    mkdirSync(eventsDir1, { recursive: true });
    mkdirSync(eventsDir2, { recursive: true });

    writeFileSync(join(eventsDir1, 'PAN-1.jsonl'), JSON.stringify(makeCostEvent({ issueId: 'PAN-1' })) + '\n');
    writeFileSync(join(eventsDir2, 'MIN-1.jsonl'), JSON.stringify(makeCostEvent({ issueId: 'MIN-1' })) + '\n');

    listProjects.mockReturnValue([
      { key: 'PAN', config: { path: repo1 } },
      { key: 'MIN', config: { path: repo2 } },
    ]);
    insertCostEvents.mockReturnValue({ inserted: 1, duplicates: 0 });

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
    insertCostEvents.mockImplementation(() => { throw new Error('DB write failed'); });

    const { syncWalFromAllProjects } = await import('../../../src/lib/costs/sync-wal.js');
    const result = await Effect.runPromise(syncWalFromAllProjects());

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('import failed');
  });
});
