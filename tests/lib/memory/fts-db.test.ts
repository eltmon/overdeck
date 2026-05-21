import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeMemoryFtsDatabases, getMemoryFtsDatabase, withMemoryFtsDatabase } from '../../../src/lib/memory/fts-db.js';
import { resolveFtsDbPath } from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.PANOPTICON_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-memory-fts-db-'));
  process.env.PANOPTICON_HOME = tempDir;
});

afterEach(async () => {
  closeMemoryFtsDatabases();
  if (originalHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('memory FTS database', () => {
  it('opens a project-scoped database lazily and caches the handle', async () => {
    const first = await getMemoryFtsDatabase('panopticon-cli');
    const second = await getMemoryFtsDatabase('panopticon-cli');

    const dbFile = await stat(resolveFtsDbPath('panopticon-cli'));

    expect(first).toBe(second);
    expect(dbFile.isFile()).toBe(true);
  });

  it('creates memory_fts with the documented columns and porter unicode61 tokenizer', async () => {
    const columns = await withMemoryFtsDatabase('panopticon-cli', (db) => db.prepare('PRAGMA table_info(memory_fts)').all() as Array<{ name: string }>);

    expect(columns.map((column) => column.name)).toEqual([
      'content',
      'display_content',
      'source',
      'branch',
      'entry_date',
      'entry_time',
      'entry_type',
      'files',
      'tags',
      'doc_type',
      'scope',
      'project_id',
      'workspace_id',
      'issue_id',
      'run_id',
      'session_id',
      'agent_role',
      'agent_harness',
    ]);

    const matches = await withMemoryFtsDatabase('panopticon-cli', (db) => {
      db.prepare(`
        INSERT INTO memory_fts (
          content,
          display_content,
          source,
          branch,
          entry_date,
          entry_time,
          entry_type,
          files,
          tags,
          doc_type,
          scope,
          project_id,
          workspace_id,
          issue_id,
          run_id,
          session_id,
          agent_role,
          agent_harness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'running runners run',
        'running runners run',
        'observation',
        'uniquebranchtoken',
        '2026-05-16',
        '22:55:00',
        'memory',
        'src/lib/memory/fts-db.ts',
        'memory,fts',
        'observation',
        'issue',
        'panopticon-cli',
        'feature-pan-1052',
        'PAN-1052',
        'run-1',
        'session-1',
        'work',
        'claude-code',
      );
      return db.prepare("SELECT rowid FROM memory_fts WHERE memory_fts MATCH 'runner'").all();
    });

    expect(matches).toHaveLength(1);

    const branchMatches = await withMemoryFtsDatabase('panopticon-cli', (db) => db.prepare("SELECT rowid FROM memory_fts WHERE memory_fts MATCH 'uniquebranchtoken'").all());
    expect(branchMatches).toHaveLength(0);
  });

  it('creates reset_markers and observation_index tables with lookup indexes', async () => {
    const tables = await withMemoryFtsDatabase('panopticon-cli', (db) => db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name IN (
          'reset_markers',
          'observation_index',
          'idx_reset_markers_scope',
          'idx_reset_markers_created_at',
          'idx_observation_index_path_offset'
        )
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>);

    expect(tables.map((row) => row.name)).toEqual([
      'idx_observation_index_path_offset',
      'idx_reset_markers_created_at',
      'idx_reset_markers_scope',
      'observation_index',
      'reset_markers',
    ]);
    expect(tables.find((row) => row.name === 'reset_markers')?.sql).toContain('scope TEXT NOT NULL');
    expect(tables.find((row) => row.name === 'observation_index')?.sql).toContain('byte_offset INTEGER NOT NULL');
  });

  it('is idempotent when the project database is reopened', async () => {
    await getMemoryFtsDatabase('panopticon-cli');
    closeMemoryFtsDatabases();
    await getMemoryFtsDatabase('panopticon-cli');

    const tableCount = await withMemoryFtsDatabase('panopticon-cli', (db) => db.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name IN ('memory_fts', 'reset_markers', 'observation_index')
    `).get() as { count: number });

    expect(tableCount.count).toBe(3);
  });
});
