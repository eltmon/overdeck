/**
 * Native SQLite ABI self-heal (PAN follow-up to the v0.17.x npx-cache incident).
 *
 * `better-sqlite3` is a V8-ABI native addon: its compiled `.node` binary is
 * locked to one Node major (`process.versions.modules` — 127 for Node 22, 137
 * for Node 24). When Panopticon is run via `npx`, the install (and its prebuilt
 * binary) is cached per package version, NOT per Node version. If the machine's
 * `node` later changes major, the cached binary is loaded under a Node it wasn't
 * built for and `new Database()` throws `ERR_DLOPEN_FAILED` /
 * "NODE_MODULE_VERSION X … requires Y". The user typically can't control which
 * Node built the cache, so Panopticon repairs it for them.
 *
 * On detecting that exact mismatch this guard rebuilds `better-sqlite3` for the
 * running Node (a prebuild fetch — no compiler needed on common platforms) and
 * re-execs the process once so the fresh binary loads cleanly. A single retry
 * flag prevents loops.
 *
 * Bun note: when Panopticon runs under Bun it uses the built-in `bun:sqlite`
 * (see src/lib/database/index.ts), never the better-sqlite3 V8-ABI addon — so
 * there is no ABI to heal and this guard is a no-op. If/when the runtime moves
 * to Bun wholesale, the long-term fix tracked in the companion issue (drop the
 * native addon entirely) supersedes this guard.
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, sep } from 'node:path';

/** Env flag set on the re-exec so a still-broken binary fails loudly instead of looping. */
const REEXEC_FLAG = 'PANOPTICON_SQLITE_REBUILT';

function isAbiMismatch(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return e?.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(String(e?.message ?? ''));
}

/** Locate the directory that CONTAINS better-sqlite3's node_modules (the npm rebuild cwd). */
function findInstallRoot(require: NodeRequire): string | null {
  try {
    // .../node_modules/better-sqlite3/package.json -> up past the package and node_modules.
    return dirname(dirname(dirname(require.resolve('better-sqlite3/package.json'))));
  } catch {
    // ignore — fall back to slicing the resolved entry path
  }
  try {
    const entry = require.resolve('better-sqlite3');
    const i = entry.indexOf(`${sep}node_modules${sep}better-sqlite3${sep}`);
    if (i !== -1) return entry.slice(0, i);
  } catch {
    // ignore
  }
  return null;
}

function healOrExit(require: NodeRequire, err: unknown): never {
  if (process.env[REEXEC_FLAG] === '1') {
    console.error('\n[panopticon] better-sqlite3 still fails to load after an automatic rebuild.');
    console.error('  ' + String((err as Error)?.message ?? err).split('\n')[0]);
    console.error('  Manual fix: clear the npx cache (rm -rf ~/.npm/_npx) and re-run, or use Node 22.\n');
    process.exit(1);
  }

  const installRoot = findInstallRoot(require);
  if (!installRoot) {
    console.error('[panopticon] better-sqlite3 was built for a different Node ABI and could not be');
    console.error('  located for an automatic rebuild. Manual fix: rm -rf ~/.npm/_npx and re-run, or use Node 22.');
    process.exit(1);
  }

  console.error(
    `[panopticon] better-sqlite3 was built for a different Node ABI ` +
      `(running Node ${process.versions.node}, MODULE_VERSION ${process.versions.modules}). ` +
      `Rebuilding it to match…`
  );

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const rebuild = spawnSync(npm, ['rebuild', 'better-sqlite3'], { cwd: installRoot, stdio: 'inherit' });
  if (rebuild.status !== 0) {
    console.error('[panopticon] automatic rebuild failed. Manual fix: rm -rf ~/.npm/_npx and re-run, or use Node 22.');
    process.exit(1);
  }

  // Re-run the same command; the fresh process loads the rebuilt binary cleanly.
  const re = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, [REEXEC_FLAG]: '1' },
  });
  process.exit(re.status ?? 0);
}

/**
 * Verify the better-sqlite3 native addon matches the running Node ABI; if not,
 * rebuild it and re-exec. No-op under Bun and when the addon already loads.
 * Call once at process startup, before any database is opened.
 */
export function ensureNativeSqliteAbi(): void {
  // Bun uses bun:sqlite — no V8-ABI addon to heal.
  if (process.versions.bun) return;

  const require = createRequire(import.meta.url);
  try {
    const Database = require('better-sqlite3') as new (path: string) => { close(): void };
    new Database(':memory:').close();
  } catch (err) {
    // Only self-heal the specific ABI mismatch; let any other error surface
    // through the normal database code path with its proper context.
    if (isAbiMismatch(err)) healOrExit(require, err);
  }
}
