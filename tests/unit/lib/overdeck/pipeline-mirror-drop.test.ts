import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import {
  PIPELINE_MIRROR_DROPPED_SETTING,
  dropPipelineStateMirrorTables,
  readPipelineMirrorMarker,
} from '../../../../src/lib/overdeck/infra.js';

/**
 * fix10 incident: the pipeline-state mirror drop ran on EVERY database open,
 * including from a peer process, and dropped `agents` out from under the live
 * 0.51.0 dashboard sharing the same overdeck.db. Two gates now stand in front
 * of it — primary-only and exactly-once.
 */
const MIRROR_TABLES = [
  'review_status',
  'status_history',
  'issue_policy',
  'agents',
  'review_runs',
  'review_run_agents',
] as const;

const PEER_ENV: NodeJS.ProcessEnv = { OVERDECK_DISABLE_DEACON: '1' };
const PRIMARY_ENV: NodeJS.ProcessEnv = {};

let dir: string;
let db: SqliteDatabase;

function tableNames(): string[] {
  return (db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>)
    .map((row) => row.name);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pipeline-mirror-drop-'));
  db = openDatabase(join(dir, 'overdeck.db'));
  db.exec('CREATE TABLE `app_settings` (`key` text PRIMARY KEY NOT NULL, `value` text, `updated_at` integer)');
  for (const table of MIRROR_TABLES) db.exec(`CREATE TABLE \`${table}\` (\`id\` text PRIMARY KEY NOT NULL)`);
  db.exec("INSERT INTO `agents` (`id`) VALUES ('agent-pan-3917')");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('dropPipelineStateMirrorTables', () => {
  it('leaves every table alone in peer mode', () => {
    const result = dropPipelineStateMirrorTables(db, PEER_ENV);

    expect(result).toEqual({ dropped: false, skipped: 'peer' });
    for (const table of MIRROR_TABLES) expect(tableNames()).toContain(table);
    expect(readPipelineMirrorMarker(db)).toBeNull();
  });

  it('treats any truthy OVERDECK_DISABLE_DEACON as peer, not just "1"', () => {
    expect(dropPipelineStateMirrorTables(db, { OVERDECK_DISABLE_DEACON: 'true' }).skipped).toBe('peer');
    expect(tableNames()).toContain('agents');
  });

  it('drops the mirror tables once in primary mode and writes the marker', () => {
    const result = dropPipelineStateMirrorTables(db, PRIMARY_ENV);

    expect(result).toEqual({ dropped: true });
    for (const table of MIRROR_TABLES) expect(tableNames()).not.toContain(table);
    expect(readPipelineMirrorMarker(db)).not.toBeNull();

    const setting = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(PIPELINE_MIRROR_DROPPED_SETTING) as { value: string } | undefined;
    expect(setting?.value).toBeTruthy();
  });

  it('is a no-op on the next open once the marker exists', () => {
    dropPipelineStateMirrorTables(db, PRIMARY_ENV);
    const marker = readPipelineMirrorMarker(db);

    // A table recreated by an older peer must not be dropped again: the marker
    // says this database already converged.
    db.exec('CREATE TABLE `agents` (`id` text PRIMARY KEY NOT NULL)');

    const second = dropPipelineStateMirrorTables(db, PRIMARY_ENV);

    expect(second).toEqual({ dropped: false, skipped: 'already-dropped' });
    expect(tableNames()).toContain('agents');
    expect(readPipelineMirrorMarker(db)).toBe(marker);
  });

  it('does not run from a plain database open', () => {
    // Opening the database is what every CLI invocation does; only the
    // dashboard's explicit primary boot step may drop tables.
    const infraSource = join(process.cwd(), 'src/lib/overdeck/infra.ts');
    const source = require('node:fs').readFileSync(infraSource, 'utf8') as string;
    const ensureBody = source.slice(
      source.indexOf('function ensureRuntimeIndexesSync'),
      source.indexOf('PIPELINE_MIRROR_DROPPED_SETTING'),
    );
    expect(ensureBody).not.toContain('dropPipelineStateMirrorTables');
  });
});
