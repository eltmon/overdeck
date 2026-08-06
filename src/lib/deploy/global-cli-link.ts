/**
 * Global CLI generation link (PAN-3538).
 *
 * The machine-wide `pan` command resolves through the npm-global package link
 * (`<node>/lib/node_modules/@overdeck/core`) into a deployment generation.
 * Reload activation historically repointed the SERVER onto the new generation
 * but never this link, so every spawn-side fix "deployed" one generation late:
 * the CLI kept executing the previous build (observed live: a strike spawned
 * without PTY supervisor wiring a full deploy after the fix landed).
 *
 * Activation must therefore repoint this link to the newly activated
 * generation — atomically (tmp symlink + rename), and only when the link
 * already points into the deployments base. A link that is a real directory
 * (a genuine npm install) or points elsewhere (a dev `npm link` to a repo
 * checkout) is deliberately left alone: clobbering it would break a working
 * setup the operator chose.
 */

import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';

import { getOverdeckHome } from '../paths.js';

export interface GlobalCliLinkDeps {
  execPath?: string;
  lstat?: typeof fs.lstat;
  readlink?: typeof fs.readlink;
  symlink?: typeof fs.symlink;
  rename?: typeof fs.rename;
  rm?: typeof fs.rm;
}

export type GlobalCliRepointStatus =
  | { status: 'repointed'; linkPath: string; target: string }
  | { status: 'already-current'; linkPath: string; target: string }
  /** No global link exists on this machine (repo-local pan) — nothing to do. */
  | { status: 'absent'; linkPath: string }
  /** Real npm install or a link outside the deployments base — never touched. */
  | { status: 'foreign'; linkPath: string; target: string | null }
  | { status: 'error'; linkPath: string; message: string };

export function resolveGlobalCliLinkPath(execPath: string = process.execPath): string {
  // <prefix>/bin/node → <prefix>/lib/node_modules/@overdeck/core
  return join(dirname(execPath), '..', 'lib', 'node_modules', '@overdeck', 'core');
}

function deploymentsBase(): string {
  return resolve(join(getOverdeckHome(), 'deployments', 'dashboard'));
}

/**
 * Repoint the global CLI package link at `deployRoot`, when — and only when —
 * it currently resolves into the deployments base. Verified after the swap:
 * a rename that lands but reads back wrong is reported as an error, never
 * silently accepted.
 */
export async function repointGlobalCliToDeployment(
  deployRoot: string,
  deps: GlobalCliLinkDeps = {},
): Promise<GlobalCliRepointStatus> {
  const lstat = deps.lstat ?? fs.lstat;
  const readlink = deps.readlink ?? fs.readlink;
  const symlink = deps.symlink ?? fs.symlink;
  const rename = deps.rename ?? fs.rename;
  const rm = deps.rm ?? fs.rm;
  const linkPath = resolveGlobalCliLinkPath(deps.execPath);
  const nextTarget = resolve(deployRoot);

  let current: string | null = null;
  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      return { status: 'foreign', linkPath, target: null };
    }
    current = resolve(dirname(linkPath), await readlink(linkPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent', linkPath };
    }
    return { status: 'error', linkPath, message: (error as Error).message };
  }

  const base = deploymentsBase();
  if (!current.startsWith(`${base}/`) && current !== base) {
    return { status: 'foreign', linkPath, target: current };
  }
  if (current === nextTarget) {
    return { status: 'already-current', linkPath, target: current };
  }

  const tmpLink = `${linkPath}.repoint-${process.pid}`;
  try {
    await rm(tmpLink, { force: true });
    await symlink(nextTarget, tmpLink, 'dir');
    await rename(tmpLink, linkPath);
    const verified = resolve(dirname(linkPath), await readlink(linkPath));
    if (verified !== nextTarget) {
      return {
        status: 'error',
        linkPath,
        message: `post-repoint verification failed: link resolves to ${verified}, expected ${nextTarget}`,
      };
    }
    return { status: 'repointed', linkPath, target: nextTarget };
  } catch (error) {
    await rm(tmpLink, { force: true }).catch(() => undefined);
    return { status: 'error', linkPath, message: (error as Error).message };
  }
}

/**
 * Doctor probe: does the global CLI link agree with the generation the live
 * dashboard server actually executes from? Observed processes decide the
 * server side (the active-bundle record can diverge after a failed deploy —
 * PAN-3329), and drift here means every `pan` spawn runs stale code.
 */
export async function describeCliGenerationDrift(
  liveServerRoot: string | null,
  deps: GlobalCliLinkDeps = {},
): Promise<{ ok: boolean; message: string }> {
  const lstat = deps.lstat ?? fs.lstat;
  const readlink = deps.readlink ?? fs.readlink;
  const linkPath = resolveGlobalCliLinkPath(deps.execPath);

  let target: string;
  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      return { ok: true, message: `global CLI is a real install at ${linkPath} (no generation link)` };
    }
    target = resolve(dirname(linkPath), await readlink(linkPath));
  } catch {
    return { ok: true, message: 'no global CLI link on this machine' };
  }

  const base = deploymentsBase();
  if (!target.startsWith(`${base}/`)) {
    return { ok: true, message: `global CLI links outside deployments (${target}) — operator-managed` };
  }
  if (!liveServerRoot) {
    return { ok: true, message: `global CLI → ${target}; no live server generation to compare against` };
  }
  if (resolve(liveServerRoot) === target) {
    return { ok: true, message: `global CLI and live server share ${target}` };
  }
  return {
    ok: false,
    message: `global CLI runs ${target} but the live server runs ${resolve(liveServerRoot)} — pan spawns execute stale code (PAN-3538); rerun pan reload or repoint the link`,
  };
}
