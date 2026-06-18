// CLI entry point for seeding a fresh overdeck.db.
//
// This is the ONLY file that holds the run-as-CLI auto-run guard. The
// importable `./create-overdeck-db.js` module is import-pure — it has no
// top-level execution — so it is safe to bundle into dist/dashboard/server.js
// (PAN-1959: previously the guard lived in the importable module, got bundled
// into the dashboard server, and fired `createOverdeckDatabase` at module-eval
// on every boot, crashing the dashboard when overdeck.db already existed).
import { pathToFileURL } from 'node:url';

import { createOverdeckDatabase, parseArgs } from './create-overdeck-db.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = createOverdeckDatabase(parseArgs(process.argv.slice(2)));
  console.log(`Created ${result.dbPath} with ${result.tableCount} empty tables.`);
}
