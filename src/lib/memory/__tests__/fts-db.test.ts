import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeMemoryFtsDatabases, runMemoryFtsStatement, runMemoryFtsTransaction } from '../fts-db.js';

let testHome: string;

beforeEach(() => {
  testHome = join(tmpdir(), `pan-1579-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.PANOPTICON_HOME = testHome;
});

afterEach(() => {
  closeMemoryFtsDatabases();
  delete process.env.PANOPTICON_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('memory FTS database', () => {
  it('runs FTS statements and transactions through the SQLite adapter', async () => {
    await runMemoryFtsStatement('project-1', {
      method: 'run',
      sql: `INSERT INTO memory_fts (
        content, display_content, source, branch, entry_date, entry_time, entry_type, files, tags,
        doc_type, scope, project_id, workspace_id, issue_id, run_id, session_id, agent_role, agent_harness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        'sqlite adapter memory search',
        'SQLite adapter memory search',
        'observation',
        'main',
        '2026-06-04',
        '08:00:00',
        'fact',
        '[]',
        'database',
        'observation',
        'issue',
        'project-1',
        'workspace-1',
        'PAN-1579',
        'run-1',
        'session-1',
        'work',
        'claude-code',
      ],
    });

    const rows = await runMemoryFtsStatement<Array<{ display_content: string }>>('project-1', {
      method: 'all',
      sql: 'SELECT display_content FROM memory_fts WHERE memory_fts MATCH ?',
      params: ['sqlite'],
    });
    expect(rows).toEqual([{ display_content: 'SQLite adapter memory search' }]);

    await expect(runMemoryFtsTransaction('project-1', [
      {
        method: 'run',
        sql: 'INSERT INTO reset_markers (scope, scope_id, from_timestamp, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        params: ['issue', 'PAN-1579', '2026-06-04T08:00:00.000Z', 'ok', '2026-06-04T08:00:00.000Z'],
      },
      {
        method: 'run',
        sql: 'INSERT INTO reset_markers (scope, scope_id, from_timestamp, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        params: ['issue', 'PAN-1579', '2026-06-04T08:00:00.000Z', true, '2026-06-04T08:00:00.000Z'],
      },
    ])).rejects.toThrow('SQLite boolean bind values are not supported');

    const markers = await runMemoryFtsStatement<Array<{ count: number }>>('project-1', {
      method: 'all',
      sql: 'SELECT COUNT(*) AS count FROM reset_markers',
    });
    expect(markers).toEqual([{ count: 0 }]);
  });
});
