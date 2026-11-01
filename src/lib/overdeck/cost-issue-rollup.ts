/**
 * Trigger-maintained per-issue cost rollup (PAN-4724).
 *
 * `cost_issue_rollup` holds one row per grain `(UPPER(issue_id), model,
 * session_type, provider)` of `cost_events`, with the call count, the cost and
 * token sums, and the newest `ts`. `getCostsByIssue` reads these few thousand
 * rows instead of aggregating every `cost_events` row on each 15 s poll.
 *
 * SQLite triggers on `cost_events` keep it current, not JS next to each insert:
 * there are four writers — `insertCostEvent` (cost-sync.ts), `CostWriter.record`
 * (cost.ts, Drizzle), `reclassifyUnknownCostEvents` (costs/attribution.ts), and
 * the prebuilt hook bundle `sync-sources/hooks/record-cost-event.js`, which runs
 * an older bundled copy of `insertCostEvent` in another process. Only a
 * database-level trigger sees all of them.
 *
 * Grain keys are raw and nullable, so matching uses `IS` and there is no unique
 * key or upsert (SQLite unique indexes treat NULLs as distinct).
 *
 * Every trigger and index name carries `_v1`. A change to the grain or to the
 * aggregated columns ships `_v2` names; its install drops the `_v1` objects and
 * rebuilds the table in the same transaction.
 *
 * Intentionally not in `0000_overdeck_init.sql`: creation must be atomic with
 * the backfill and the triggers, so this module is the single source. It runs
 * from `ensureRuntimeIndexesSync` on every writable open, and stays outside
 * `OVERDECK_TABLE_COUNT` (same precedent as `sessions_fts`).
 */

import type { SqliteDatabase } from '../database/driver.js';

export const COST_ISSUE_ROLLUP_TABLE = 'cost_issue_rollup';

/** Every object the v1 install creates; the install is complete only when all exist. */
export const COST_ISSUE_ROLLUP_V1_OBJECTS = [
  'cost_issue_rollup',
  'cost_issue_rollup_key_idx_v1',
  'cost_issue_rollup_ai_v1',
  'cost_issue_rollup_au_v1',
] as const;

/** The grain aggregate over `cost_events`; the backfill source and the test oracle. */
export const COST_ISSUE_ROLLUP_GRAIN_SELECT_SQL = `SELECT UPPER(issue_id) AS issue_key, model, session_type, provider, COUNT(*) AS calls,
       COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(input), 0) AS input, COALESCE(SUM(output), 0) AS output,
       COALESCE(SUM(cache_read), 0) AS cache_read, COALESCE(SUM(cache_write), 0) AS cache_write,
       COALESCE(SUM(input + output + cache_read + cache_write), 0) AS tokens, MAX(ts) AS last_ts
FROM cost_events
GROUP BY UPPER(issue_id), model, session_type, provider`;

const CREATE_TABLE_SQL = `CREATE TABLE \`cost_issue_rollup\` (
  \`issue_key\` text, \`model\` text, \`session_type\` text, \`provider\` text,
  \`calls\` integer NOT NULL DEFAULT 0, \`cost\` real NOT NULL DEFAULT 0,
  \`input\` integer NOT NULL DEFAULT 0, \`output\` integer NOT NULL DEFAULT 0,
  \`cache_read\` integer NOT NULL DEFAULT 0, \`cache_write\` integer NOT NULL DEFAULT 0,
  \`tokens\` integer NOT NULL DEFAULT 0, \`last_ts\` integer NOT NULL
)`;

const CREATE_INDEX_SQL = 'CREATE INDEX `cost_issue_rollup_key_idx_v1` ON `cost_issue_rollup` '
  + '(`issue_key`, `model`, `session_type`, `provider`)';

const BACKFILL_SQL = `INSERT INTO cost_issue_rollup (issue_key, model, session_type, provider, calls, cost,
  input, output, cache_read, cache_write, tokens, last_ts)
${COST_ISSUE_ROLLUP_GRAIN_SELECT_SQL}`;

/** Trigger names and DDL, in install order. */
const ROLLUP_TRIGGERS_SQL: Array<{ name: string; sql: string }> = [
  {
    name: 'cost_issue_rollup_ai_v1',
    sql: `CREATE TRIGGER \`cost_issue_rollup_ai_v1\` AFTER INSERT ON \`cost_events\` BEGIN
  INSERT INTO cost_issue_rollup (issue_key, model, session_type, provider, last_ts)
    SELECT UPPER(NEW.issue_id), NEW.model, NEW.session_type, NEW.provider, NEW.ts
    WHERE NOT EXISTS (SELECT 1 FROM cost_issue_rollup
      WHERE issue_key IS UPPER(NEW.issue_id) AND model IS NEW.model
        AND session_type IS NEW.session_type AND provider IS NEW.provider);
  UPDATE cost_issue_rollup SET
    calls = calls + 1,
    cost = cost + COALESCE(NEW.cost, 0),
    input = input + COALESCE(NEW.input, 0),
    output = output + COALESCE(NEW.output, 0),
    cache_read = cache_read + COALESCE(NEW.cache_read, 0),
    cache_write = cache_write + COALESCE(NEW.cache_write, 0),
    tokens = tokens + COALESCE(NEW.input + NEW.output + NEW.cache_read + NEW.cache_write, 0),
    last_ts = MAX(last_ts, NEW.ts)
  WHERE issue_key IS UPPER(NEW.issue_id) AND model IS NEW.model
    AND session_type IS NEW.session_type AND provider IS NEW.provider;
END`,
  },
  {
    // Moves a row's contribution from its OLD grain to its NEW grain. An emptied
    // grain row is deleted; when the newest row leaves a grain that keeps rows,
    // last_ts is recomputed (AFTER trigger, so the scan sees the updated table).
    name: 'cost_issue_rollup_au_v1',
    sql: `CREATE TRIGGER \`cost_issue_rollup_au_v1\`
AFTER UPDATE OF ts, issue_id, model, session_type, provider, cost, input, output, cache_read, cache_write
ON \`cost_events\` BEGIN
  UPDATE cost_issue_rollup SET
    calls = calls - 1,
    cost = cost - COALESCE(OLD.cost, 0),
    input = input - COALESCE(OLD.input, 0),
    output = output - COALESCE(OLD.output, 0),
    cache_read = cache_read - COALESCE(OLD.cache_read, 0),
    cache_write = cache_write - COALESCE(OLD.cache_write, 0),
    tokens = tokens - COALESCE(OLD.input + OLD.output + OLD.cache_read + OLD.cache_write, 0)
  WHERE issue_key IS UPPER(OLD.issue_id) AND model IS OLD.model
    AND session_type IS OLD.session_type AND provider IS OLD.provider;
  DELETE FROM cost_issue_rollup
  WHERE calls <= 0 AND issue_key IS UPPER(OLD.issue_id) AND model IS OLD.model
    AND session_type IS OLD.session_type AND provider IS OLD.provider;
  UPDATE cost_issue_rollup SET last_ts = (
      SELECT MAX(ts) FROM cost_events
      WHERE UPPER(issue_id) IS UPPER(OLD.issue_id) AND model IS OLD.model
        AND session_type IS OLD.session_type AND provider IS OLD.provider)
  WHERE last_ts = OLD.ts AND issue_key IS UPPER(OLD.issue_id) AND model IS OLD.model
    AND session_type IS OLD.session_type AND provider IS OLD.provider;
  INSERT INTO cost_issue_rollup (issue_key, model, session_type, provider, last_ts)
    SELECT UPPER(NEW.issue_id), NEW.model, NEW.session_type, NEW.provider, NEW.ts
    WHERE NOT EXISTS (SELECT 1 FROM cost_issue_rollup
      WHERE issue_key IS UPPER(NEW.issue_id) AND model IS NEW.model
        AND session_type IS NEW.session_type AND provider IS NEW.provider);
  UPDATE cost_issue_rollup SET
    calls = calls + 1,
    cost = cost + COALESCE(NEW.cost, 0),
    input = input + COALESCE(NEW.input, 0),
    output = output + COALESCE(NEW.output, 0),
    cache_read = cache_read + COALESCE(NEW.cache_read, 0),
    cache_write = cache_write + COALESCE(NEW.cache_write, 0),
    tokens = tokens + COALESCE(NEW.input + NEW.output + NEW.cache_read + NEW.cache_write, 0),
    last_ts = MAX(last_ts, NEW.ts)
  WHERE issue_key IS UPPER(NEW.issue_id) AND model IS NEW.model
    AND session_type IS NEW.session_type AND provider IS NEW.provider;
END`,
  },
];

type InstallState = 'no-cost-events' | 'installed' | 'missing';

/** One `sqlite_master` read: is `cost_events` there, and does every v1 object exist? */
function installState(db: SqliteDatabase): InstallState {
  const names = ['cost_events', ...COST_ISSUE_ROLLUP_V1_OBJECTS];
  const found = new Set(
    db.prepare(`SELECT name FROM sqlite_master WHERE name IN (${names.map(() => '?').join(', ')})`)
      .all<{ name: string }>(...names)
      .map((row) => row.name),
  );
  if (!found.has('cost_events')) return 'no-cost-events';
  return COST_ISSUE_ROLLUP_V1_OBJECTS.every((name) => found.has(name)) ? 'installed' : 'missing';
}

/** Drop any partial v1 objects, then create, backfill, and arm the triggers. */
function installInTransaction(db: SqliteDatabase): void {
  for (const trigger of ROLLUP_TRIGGERS_SQL) db.exec(`DROP TRIGGER IF EXISTS \`${trigger.name}\``);
  db.exec(`DROP TABLE IF EXISTS \`${COST_ISSUE_ROLLUP_TABLE}\``);
  db.exec(CREATE_TABLE_SQL);
  db.exec(CREATE_INDEX_SQL);
  db.exec(BACKFILL_SQL);
  for (const trigger of ROLLUP_TRIGGERS_SQL) db.exec(trigger.sql);
}

/**
 * Install the rollup once. Returns true when it is installed, false when
 * `cost_events` is absent (silently) or the install failed (logged).
 * An already-installed rollup costs one `sqlite_master` read and no write lock.
 */
export function ensureCostIssueRollup(db: SqliteDatabase): boolean {
  const state = installState(db);
  if (state === 'no-cost-events') return false;
  if (state === 'installed') return true;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another process may have finished the install while we waited for the lock.
      if (installState(db) === 'missing') installInTransaction(db);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return true;
  } catch (error) {
    console.error(`[cost-issue-rollup] install failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
