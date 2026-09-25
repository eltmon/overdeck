import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SqliteDatabase } from '../../database/driver.js';
import {
  closeOverdeckDatabase,
  getOverdeckDatabase,
  runSchemaTopUp,
  dropPipelineStateMirrorTables,
  dropDeadIssuesForeignKeys,
} from '../infra.js';

let tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-schema-topups-'));
  tempDirs.push(dir);
  return join(dir, 'overdeck.db');
}

function costIndexRows(db: SqliteDatabase): Array<{ name: string; sql: string }> {
  return db
    .prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index'
        AND name IN ('idx_cost_agent_id', 'idx_cost_issue_upper')
      ORDER BY name
    `)
    .all<{ name: string; sql: string }>();
}

afterEach(() => {
  closeOverdeckDatabase();
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck schema top-ups', () => {
  it('creates conversation_pull_requests and its key index, and restores them on an existing database (PAN-3822)', () => {
    const dbPath = makeDbPath();
    let db = getOverdeckDatabase(dbPath);
    const names = () => db
      .prepare(`SELECT name FROM sqlite_master WHERE name IN ('conversation_pull_requests', 'idx_conversation_pull_requests_key') ORDER BY name`)
      .all<{ name: string }>()
      .map((row) => row.name);
    expect(names()).toEqual(['conversation_pull_requests', 'idx_conversation_pull_requests_key']);

    db.exec('DROP TABLE conversation_pull_requests');
    closeOverdeckDatabase();
    db = getOverdeckDatabase(dbPath);
    expect(names()).toEqual(['conversation_pull_requests', 'idx_conversation_pull_requests_key']);
  });

  it('creates cost-event lookup indexes in a fresh database', () => {
    const db = getOverdeckDatabase(makeDbPath());

    expect(costIndexRows(db)).toEqual([
      {
        name: 'idx_cost_agent_id',
        sql: 'CREATE INDEX `idx_cost_agent_id` ON `cost_events` (`agent_id`,`ts`)',
      },
      {
        name: 'idx_cost_issue_upper',
        sql: 'CREATE INDEX `idx_cost_issue_upper` ON `cost_events` (UPPER(`issue_id`))',
      },
    ]);
  });

  it('restores missing cost-event indexes idempotently in an existing database', () => {
    const dbPath = makeDbPath();
    const initial = getOverdeckDatabase(dbPath);
    initial.exec('DROP INDEX IF EXISTS `idx_cost_agent_id`');
    initial.exec('DROP INDEX IF EXISTS `idx_cost_issue_upper`');
    closeOverdeckDatabase();

    const toppedUp = getOverdeckDatabase(dbPath);
    expect(costIndexRows(toppedUp).map((row) => row.name)).toEqual([
      'idx_cost_agent_id',
      'idx_cost_issue_upper',
    ]);
    closeOverdeckDatabase();

    const reopened = getOverdeckDatabase(dbPath);
    expect(costIndexRows(reopened)).toHaveLength(2);
  });

  it('drops the pipeline-state mirror tables once, from the primary boot step, never on open (PAN-3917)', () => {
    const dbPath = makeDbPath();
    const db = getOverdeckDatabase(dbPath);
    const beforeDrop = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all<{ name: string }>()
      .map((row) => row.name);
    // A plain open never drops anything (fix10: a peer or CLI process sharing
    // the live DB must not pull tables out from under the running dashboard).
    expect(beforeDrop).toContain('review_status');
    expect(dropPipelineStateMirrorTables(db, {})).toMatchObject({ dropped: true });
    expect(dropPipelineStateMirrorTables(db, {})).toMatchObject({ dropped: false, skipped: 'already-dropped' });
    const tableNames = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all<{ name: string }>()
      .map((row) => row.name);
    for (const dropped of ['review_status', 'status_history', 'agents', 'issue_policy', 'review_runs', 'review_run_agents']) {
      expect(tableNames).not.toContain(dropped);
    }
    // Foreign-key anchor and kept data planes survive.
    expect(tableNames).toContain('issues');
    expect(tableNames).toContain('cost_events');
    expect(tableNames).toContain('events');
  });

  it('uses idx_cost_agent_id for the agent daily-cost query', () => {
    const db = getOverdeckDatabase(makeDbPath());
    const plan = db
      .prepare(`
        EXPLAIN QUERY PLAN
        SELECT SUM(cost)
        FROM cost_events
        WHERE agent_id = ? AND ts >= ?
      `)
      .all<{ detail: string }>('agent-pan-2807', 0);

    expect(plan.some((row) => row.detail.includes('idx_cost_agent_id'))).toBe(true);
  });

  it('creates the live issue-referencing tables WITHOUT the dead issues FK in a fresh database (PAN-3963)', () => {
    const db = getOverdeckDatabase(makeDbPath());
    for (const table of [
      'merge_queue',
      'merge_sets',
      'release_sets',
      'pending_auto_merges',
      'uat_generation_members',
      'uat_generation_member_repos',
    ]) {
      const row = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get<{ sql: string }>(table);
      expect(row?.sql ?? '', table).not.toMatch(/REFERENCES\s*`issues`/i);
    }
  });

  it('rebuilds a pre-cut table to drop the dead issues FK, preserving rows and the live FKs (PAN-3963)', () => {
    const db = getOverdeckDatabase(makeDbPath());
    // Recreate the pre-migration shape: uat_generation_members gated on the
    // issues cache that nothing writes since the Cut.
    db.exec('DROP TABLE `uat_generation_members`');
    db.exec(`
      CREATE TABLE \`uat_generation_members\` (
        \`uat_name\` text NOT NULL,
        \`issue_id\` text NOT NULL,
        \`role\` text DEFAULT 'member' NOT NULL,
        \`title\` text,
        \`branch\` text,
        \`head_sha\` text,
        \`merge_order\` integer,
        \`pr\` integer,
        \`pr_url\` text,
        \`reason\` text,
        PRIMARY KEY(\`uat_name\`, \`issue_id\`),
        FOREIGN KEY (\`uat_name\`) REFERENCES \`uat_generations\`(\`name\`) ON UPDATE no action ON DELETE no action,
        FOREIGN KEY (\`issue_id\`) REFERENCES \`issues\`(\`id\`) ON UPDATE no action ON DELETE no action
      )
    `);
    db.prepare('INSERT INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run('PAN-3705', 'done', 1);
    db.prepare(
      `INSERT INTO uat_generations (name, worktree_path, project_root, base_sha, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('uat/pan-onyx-0920', '/w', '/proj', 'sha', 'ready', 1, 1);
    db.prepare('INSERT INTO uat_generation_members (uat_name, issue_id) VALUES (?, ?)').run('uat/pan-onyx-0920', 'PAN-3705');
    // Pre-migration behavior: the post-cut issue id is rejected.
    expect(() =>
      db.prepare('INSERT INTO uat_generation_members (uat_name, issue_id) VALUES (?, ?)').run('uat/pan-onyx-0920', 'PAN-3950'),
    ).toThrow(/FOREIGN KEY/);

    const result = dropDeadIssuesForeignKeys(db, {});

    expect(result).toMatchObject({ dropped: true, tables: ['uat_generation_members'] });
    // The existing row survived, and the post-cut issue id now inserts.
    expect(() =>
      db.prepare('INSERT INTO uat_generation_members (uat_name, issue_id) VALUES (?, ?)').run('uat/pan-onyx-0920', 'PAN-3950'),
    ).not.toThrow();
    expect(
      db.prepare('SELECT issue_id FROM uat_generation_members ORDER BY issue_id').all<{ issue_id: string }>()
        .map((row) => row.issue_id),
    ).toEqual(['PAN-3705', 'PAN-3950']);
    // The LIVE FK into uat_generations survives the rebuild.
    expect(() =>
      db.prepare('INSERT INTO uat_generation_members (uat_name, issue_id) VALUES (?, ?)').run('uat/nonexistent', 'PAN-1'),
    ).toThrow(/FOREIGN KEY/);
  });

  it('runs the dead-issues-FK rebuild once via marker, and never in a peer process', () => {
    const db = getOverdeckDatabase(makeDbPath());
    // Fresh database: nothing to rebuild, but the marker still lands.
    expect(dropDeadIssuesForeignKeys(db, {})).toMatchObject({ dropped: true, tables: [] });
    expect(dropDeadIssuesForeignKeys(db, {})).toMatchObject({ dropped: false, skipped: 'already-dropped' });

    const peerDb = getOverdeckDatabase(makeDbPath());
    expect(dropDeadIssuesForeignKeys(peerDb, { OVERDECK_DISABLE_DEACON: '1' } as NodeJS.ProcessEnv))
      .toMatchObject({ dropped: false, skipped: 'peer' });
  });

  it('silently tolerates a duplicate column reported by SQLite', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = getOverdeckDatabase(makeDbPath());

    expect(() => runSchemaTopUp(db, 'ALTER TABLE `app_settings` ADD COLUMN `value` text')).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs an unexpected SQLite error and continues with the next top-up', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = getOverdeckDatabase(makeDbPath());
    db.exec('CREATE TABLE `schema_topup_probe` (`id` integer)');
    const malformed = 'ALTER TABLE `schema_topup_probe` ADD COLUMN';

    expect(() => runSchemaTopUp(db, malformed)).not.toThrow();
    runSchemaTopUp(db, 'ALTER TABLE `schema_topup_probe` ADD COLUMN `recovered` text');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0]?.join(' ') ?? '';
    expect(logged).toContain('[schema]');
    expect(logged).toContain(malformed);
    expect(logged).toMatch(/incomplete input|syntax error/i);
    expect(
      db
        .prepare('PRAGMA table_info(`schema_topup_probe`)')
        .all<{ name: string }>()
        .map((column) => column.name),
    ).toContain('recovered');
  });

  it('logs a missing-table top-up failure while startup and later top-ups continue', () => {
    const dbPath = makeDbPath();
    const initial = getOverdeckDatabase(dbPath);
    initial.exec('DROP TABLE `flywheel_substrate_bugs`');
    initial.exec('DROP INDEX `idx_cost_agent_id`');
    closeOverdeckDatabase();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const reopened = getOverdeckDatabase(dbPath);

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('[schema] top-up failed');
    expect(logged).toContain('ALTER TABLE `flywheel_substrate_bugs` ADD COLUMN `affected_criteria` text');
    expect(logged).toMatch(/no such table/i);
    expect(reopened.prepare('SELECT 1 AS ok').get<{ ok: number }>()).toEqual({ ok: 1 });
    expect(costIndexRows(reopened).map((row) => row.name)).toContain('idx_cost_agent_id');
  });
});
