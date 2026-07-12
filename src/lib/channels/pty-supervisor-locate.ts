/**
 * Locate (and if necessary materialize) the PTY supervisor artifact.
 *
 * The supervisor (dist/pty-supervisor.js, built by the root tsdown config) is
 * spawned inside the agent/conversation tmux session under the HOST `node`,
 * and the session must outlive the process that spawned it. That rules out
 * running it from inside a packaged desktop app: the Linux AppImage is a
 * transient FUSE mount that disappears when the app quits, and the staged
 * dashboard node_modules carry an Electron-ABI node-pty that host node cannot
 * load. So the desktop packaging stages a host-runnable copy — the supervisor
 * chunk closure plus a pristine multiarch-prebuilt node-pty — next to the
 * server bundle (server/supervisor/, see
 * apps/desktop/scripts/prepare-server-resources.mjs), and this module copies
 * it onto real disk under ${OVERDECK_HOME}/runtime/ before first use
 * (PAN-2592).
 *
 * Resolution order:
 *   1. <packageRoot>/dist/pty-supervisor.js — dev checkouts, `pan up`, and
 *      npm-global @overdeck/core installs (node-pty resolves from the package
 *      root's own node_modules).
 *   2. <bundleDir>/supervisor/pty-supervisor.js — desktop layouts; the staged
 *      tree is materialized to ${OVERDECK_HOME}/runtime/pty-supervisor/<hash>/
 *      (content-hash keyed, so an app upgrade refreshes it) and the vendored
 *      packages land under node_modules/ there for normal Node resolution.
 *
 * Missing everywhere is a build/packaging defect and throws — never silently
 * degrade a spawn that the caller expects to be supervised.
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getOverdeckHome, packageRoot } from '../paths.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function resolvePtySupervisorScriptPath(): string {
  const built = join(packageRoot, 'dist', 'pty-supervisor.js');
  if (existsSync(built)) return built;

  // Desktop layouts: all server chunks (this module included) sit in one
  // bundle directory with the staged supervisor tree beside them.
  const staged = join(moduleDir, 'supervisor');
  if (existsSync(join(staged, 'pty-supervisor.js'))) {
    return materializePtySupervisorRuntime(staged);
  }

  throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
}

/**
 * Copy the staged supervisor tree to durable disk and return the entry path.
 * Idempotent and race-safe: the copy lands in a temp dir and is renamed into
 * place; the target is keyed by the entry file's content hash.
 */
export function materializePtySupervisorRuntime(
  stagedDir: string,
  overdeckHome: string = getOverdeckHome(),
): string {
  const stagedEntry = join(stagedDir, 'pty-supervisor.js');
  const key = createHash('sha256').update(readFileSync(stagedEntry)).digest('hex').slice(0, 16);
  const targetDir = join(overdeckHome, 'runtime', 'pty-supervisor', key);
  const entry = join(targetDir, 'pty-supervisor.js');
  if (existsSync(entry)) return entry;

  const tmpDir = `${targetDir}.tmp-${process.pid}`;
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  for (const name of readdirSync(stagedDir)) {
    if (name === 'vendor') continue;
    cpSync(join(stagedDir, name), join(tmpDir, name), { recursive: true });
  }
  // Vendored packages are staged as vendor/<name> (a nested node_modules would
  // be stripped from the npx flavor by npm pack); restore the resolvable name.
  const vendorDir = join(stagedDir, 'vendor');
  if (existsSync(vendorDir)) {
    cpSync(vendorDir, join(tmpDir, 'node_modules'), { recursive: true });
  }
  try {
    renameSync(tmpDir, targetDir);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    // A concurrent spawn won the rename race — its copy is complete.
    if (!existsSync(entry)) throw err;
  }
  return entry;
}
