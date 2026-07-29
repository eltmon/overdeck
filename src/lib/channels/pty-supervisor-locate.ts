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
 * chunk closure plus the platform-specific Node-API node-pty prebuild — next to the
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
 *      (content-hash keyed over the whole staged tree, so an app upgrade
 *      refreshes it even when only non-entry files changed) and the vendored
 *      packages land under node_modules/ there for normal Node resolution.
 *   3. <activeBundle.repoRoot>/dist/pty-supervisor.js — the primary checkout a
 *      `pan reload` deployment was built from (PAN-3172).
 *
 * A candidate is only accepted when its own bare imports actually resolve from
 * where it sits. Existence alone is not enough: `pan reload` runs the dashboard
 * out of ~/.overdeck/deployments/dashboard/.pan-reload-generation-{a,b}, and a
 * generation whose node_modules cannot resolve @lydell/node-pty produces a
 * supervisor that dies on ERR_MODULE_NOT_FOUND before it ever binds its socket
 * — every conversation spawned afterwards then died on a socket timeout with no
 * hint of the real cause (PAN-3172). Falling through to the primary checkout,
 * whose node_modules is complete, keeps spawns alive; that copy is the same
 * build, since activateDashboardDeployment() copies the generation's dist/ into
 * the primary checkout.
 *
 * Missing (or unresolvable) everywhere is a build/packaging defect and throws —
 * never silently degrade a spawn that the caller expects to be supervised.
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unresolvedBundleImports } from '../bundle-imports.js';
import { readActiveDashboardBundleSync } from '../deploy/active-dashboard-bundle.js';
import { getOverdeckHome, packageRoot } from '../paths.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Bare package specifiers the built supervisor imports but cannot resolve from
 * its own location. Empty means the artifact can start where it sits.
 */
export const unresolvedSupervisorImports = unresolvedBundleImports;

/**
 * Why a freshly built deployment cannot run the supervisor, or null if it can.
 *
 * `pan reload`'s health check only exercises the dashboard's HTTP surface, which
 * stays green even when the generation's node_modules is incomplete — so the
 * reload reported "healthy" while every new conversation died on a supervisor
 * socket timeout (PAN-3172). Callers use this to fail the deploy instead.
 */
export function supervisorDeploymentFailure(deployRoot: string): string | null {
  const supervisorPath = join(deployRoot, 'dist', 'pty-supervisor.js');
  if (!existsSync(supervisorPath)) return `Build did not create ${supervisorPath}`;

  const missing = unresolvedSupervisorImports(supervisorPath);
  if (missing.length === 0) return null;
  return `Deployment cannot resolve ${missing.join(', ')} from ${supervisorPath} — `
    + 'the PTY supervisor would die on startup and every new conversation would time out. '
    + 'Run `bun install` in the deployment root, then reload again';
}

export function resolvePtySupervisorScriptPath(): string {
  const activeBundle = readActiveDashboardBundleSync();
  const candidates = [
    join(packageRoot, 'dist', 'pty-supervisor.js'),
    // Desktop layouts: all server chunks (this module included) sit in one
    // bundle directory with the staged supervisor tree beside them.
    join(moduleDir, 'supervisor', 'pty-supervisor.js'),
    ...(activeBundle ? [join(activeBundle.repoRoot, 'dist', 'pty-supervisor.js')] : []),
  ];

  const rejected: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const staged = dirname(candidate) === join(moduleDir, 'supervisor');
    const entry = staged ? materializePtySupervisorRuntime(dirname(candidate)) : candidate;
    const missing = unresolvedSupervisorImports(entry);
    if (missing.length === 0) return entry;
    rejected.push(`${entry} cannot resolve ${missing.join(', ')}`);
  }

  if (rejected.length > 0) {
    throw new Error(
      `pty-supervisor cannot start — its dependencies are missing from every built copy: ${rejected.join('; ')}. `
      + 'Reinstall dependencies where the dashboard is running from (`bun install`), then rebuild.',
    );
  }
  throw new Error('pty-supervisor build artifact missing — run `npm run build`.');
}

/**
 * Hash the contents and relative paths of every file under the staged tree.
 * This detects changes to any copied file, not just the entry point.
 */
function hashStagedTree(stagedDir: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(stagedDir, full);
      if (entry.isDirectory()) {
        hash.update(`${rel}/\n`);
        walk(full);
      } else if (entry.isFile()) {
        hash.update(`${rel}\n`);
        hash.update(readFileSync(full));
      }
    }
  };
  walk(stagedDir);
  return hash.digest('hex').slice(0, 16);
}

/**
 * Copy the staged supervisor tree to durable disk and return the entry path.
 * Idempotent and race-safe: the copy lands in a temp dir and is renamed into
 * place; the target is keyed by a content hash of the entire staged tree.
 */
export function materializePtySupervisorRuntime(
  stagedDir: string,
  overdeckHome: string = getOverdeckHome(),
): string {
  const key = hashStagedTree(stagedDir);
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
