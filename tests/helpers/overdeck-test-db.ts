/**
 * Shared overdeck test fixture (PAN-1938).
 *
 * The migrated product code serves agent-state / conversations / costs from a
 * real `overdeck.db` resolved from `PANOPTICON_HOME` — the SYNC accessors
 * (`getOverdeckDatabaseSync`, `getOverdeckAgentStateSync`, …) resolve the path
 * at CALL time, so they honour a `PANOPTICON_HOME` set in `beforeEach`.
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
import { mkdtempSync, rmSync } from 'node:fs';
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
import type { SqliteDatabase } from '../../src/lib/database/driver.js';

export interface OverdeckTestDb {
  /** Throwaway `PANOPTICON_HOME` for this test. */
  readonly home: string;
  /** Absolute path to the fresh `overdeck.db` under `home`. */
  readonly dbPath: string;
  /** Effect Layer providing `overdeck/Db` pointed at THIS test db (for door tests). */
  readonly dbLayer: Layer.Layer<Db>;
  /** Raw sync handle to the test db, for direct seeding / assertions. */
  readonly raw: () => SqliteDatabase;
}

let savedHome: { present: boolean; value: string | undefined } = { present: false, value: undefined };

/**
 * `beforeEach`: fresh temp `PANOPTICON_HOME`, an empty schema-applied
 * `overdeck.db`, and a reset cached sync handle.
 */
export function setupOverdeckTestDb(): OverdeckTestDb {
  // Drop any cached sync handle from a prior test before we swap the home.
  closeOverdeckDatabaseSync();

  savedHome = { present: 'PANOPTICON_HOME' in process.env, value: process.env.PANOPTICON_HOME };

  const home = mkdtempSync(join(tmpdir(), 'pan-overdeck-test-'));
  process.env.PANOPTICON_HOME = home;

  const dbPath = join(home, 'overdeck.db');
  createOverdeckDatabase({ dbPath });

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
    process.env.PANOPTICON_HOME = savedHome.value;
  } else {
    delete process.env.PANOPTICON_HOME;
  }
}

// Re-export the production sync writers so tests seed through the real path
// rather than hand-rolling INSERTs that can drift from the schema.
export {
  getOverdeckAgentStateSync,
  listOverdeckAgentStatesSync,
  saveOverdeckAgentStateSync,
} from '../../src/lib/overdeck/agent-state-sync.js';
export { getOverdeckDatabasePath };
