/**
 * Shared overdeck test fixture (PAN-1938).
 *
 * The product code serves conversations/costs/events from a real
 * `overdeck.db` resolved from `OVERDECK_HOME` — the SYNC accessors
 * (`getOverdeckDatabaseSync`, …) resolve the path at CALL time, so they
 * honour a `OVERDECK_HOME` set in `beforeEach`. PAN-3917: agent state is no
 * longer in this DB — `getOverdeckAgentStateSync`/`listOverdeckAgentStatesSync`/
 * `saveOverdeckAgentStateSync` below are compatibility names re-exported from
 * agents/agent-state.ts's state.json-backed door, which resolves
 * `~/.overdeck/agents/<id>/state.json` under the same `OVERDECK_HOME` at call
 * time — so existing callers keep working unchanged.
 *
 * This helper gives a test a fresh, real, schema-applied `overdeck.db` under a
 * throwaway temp home, and — critically — resets the cached sync handle so one
 * test's db never bleeds into the next.
 *
 * Sync-path tests (the common case):
 *   let odb: OverdeckTestDb;
 *   beforeEach(() => { odb = setupOverdeckTestDb(); });
 *   afterEach(()  => { teardownOverdeckTestDb(odb); });
 *   // seed via the re-exported sync writers, e.g. saveOverdeckAgentStateSync(state)
 *
 * Effect-door tests:
 *   build the door over `odb.dbLayer` (a `makeDbLive` pointed at THIS test db)
 *   instead of the bundled `*DoorLive` (whose Db is import-time-fixed).
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Layer } from 'effect';

import { createOverdeckDatabase } from '../../scripts/create-overdeck-db.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
  makeDbLive,
  type Db,
} from '../../src/lib/overdeck/infra.js';
import { getOverdeckDatabasePath } from '../../src/lib/overdeck/paths.js';
import { resetDiscoveredSessionsSchemaBootstrap } from '../../src/lib/overdeck/discovered-sessions.js';
import type { SqliteDatabase } from '../../src/lib/database/driver.js';

export interface OverdeckTestDb {
  /** Throwaway `OVERDECK_HOME` for this test. */
  readonly home: string;
  /** Absolute path to the fresh `overdeck.db` under `home`. */
  readonly dbPath: string;
  /** Effect Layer providing `overdeck/Db` pointed at THIS test db (for door tests). */
  readonly dbLayer: Layer.Layer<Db>;
  /** Raw sync handle to the test db, for direct seeding / assertions. */
  readonly raw: () => SqliteDatabase;
}

let savedHome: { present: boolean; value: string | undefined } = { present: false, value: undefined };
let templateDb: { dir: string; path: string } | null = null;

function getTemplateDbPath(): string {
  if (templateDb) return templateDb.path;

  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-test-template-'));
  const dbPath = join(dir, 'overdeck-template.db');
  createOverdeckDatabase({ dbPath });
  templateDb = { dir, path: dbPath };
  process.once('exit', () => {
    if (templateDb) rmSync(templateDb.dir, { recursive: true, force: true });
  });
  return dbPath;
}

/**
 * `beforeEach`: fresh temp `OVERDECK_HOME`, an empty schema-applied
 * `overdeck.db`, and a reset cached sync handle.
 */
export function setupOverdeckTestDb(): OverdeckTestDb {
  // Drop any cached sync handle from a prior test before we swap the home.
  closeOverdeckDatabaseSync();
  // Reset the schema-bootstrap flag so ensureSchema() runs DDL on the new DB
  // (the FTS table is NOT in the migration SQL, only in ensureSchema()).
  resetDiscoveredSessionsSchemaBootstrap();

  savedHome = { present: 'OVERDECK_HOME' in process.env, value: process.env.OVERDECK_HOME };

  const home = mkdtempSync(join(tmpdir(), 'pan-overdeck-test-'));
  process.env.OVERDECK_HOME = home;

  const dbPath = join(home, 'overdeck.db');
  copyFileSync(getTemplateDbPath(), dbPath);

  return {
    home,
    dbPath,
    dbLayer: makeDbLive(dbPath),
    raw: () => getOverdeckDatabaseSync(dbPath),
  };
}

/** `afterEach`: close the cached handle, remove the temp home, restore prior env. */
export function teardownOverdeckTestDb(db: OverdeckTestDb): void {
  closeOverdeckDatabaseSync();
  rmSync(db.home, { recursive: true, force: true });
  if (savedHome.present) {
    process.env.OVERDECK_HOME = savedHome.value;
  } else {
    delete process.env.OVERDECK_HOME;
  }
}

// PAN-3917: the DB-backed agent mirror (overdeck/agent-state-sync.ts) is
// gone — agent state lives only in each agent's ~/.overdeck/agents/<id>/state.json
// now. Re-export the production sync writers/readers from there instead, so
// tests still seed through the real path rather than hand-rolling JSON writes.
export {
  getAgentStateSync as getOverdeckAgentStateSync,
  listAgentStatesSync as listOverdeckAgentStatesSync,
  saveAgentStateSync as saveOverdeckAgentStateSync,
} from '../../src/lib/agents/agent-state.js';
export { getOverdeckDatabasePath };
