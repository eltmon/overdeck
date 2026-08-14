import { execFile } from 'node:child_process';
import { lstat, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Canonical workspace-directory removal door (PAN-3717).
 *
 * Workspace containers create root-owned artifacts on the host (e.g.
 * `fe/.pnpm-store/**` owned `root:root`), so a plain recursive `rm` from the
 * host user fails with EACCES/EPERM partway through. Agents must never shell
 * out to sudo/chown themselves; instead this door retries the removal through
 * a bounded throwaway Docker container — the same fallback the dashboard's
 * stash-clean route uses — which deletes as root inside the mount, then the
 * host removes the now-empty directory.
 *
 * Containment contract — this door exists to delete resolved workspace/slot
 * directories, never arbitrary paths:
 *
 * - the path must be absolute and must resolve inside a `workspaces/`
 *   directory (after resolving symlinks), never `/` or the home directory;
 * - the target itself must be a real directory, not a symlink — a symlink
 *   could otherwise pivot the privileged Docker bind mount at a path the
 *   caller never intended (the primary caller,
 *   `listSlotWorkspaceDirectoriesSync`, already filters via
 *   `Dirent.isDirectory()`, which is false for symlinks; this lstat check is
 *   the same guarantee enforced at the door itself so future callers inherit
 *   it);
 * - an already-missing path is a success (the removal postcondition is met),
 *   matching `rm --force` semantics so re-runs stay idempotent.
 */
export interface RemoveWorkspaceDirectoryDeps {
  rm?: (path: string) => Promise<void>;
  /** Runs the privileged in-container cleanup for the mounted path. */
  dockerClean?: (path: string) => Promise<void>;
  lstat?: (path: string) => Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
}

const DOCKER_CLEAN_TIMEOUT_MS = 120_000;

async function defaultDockerClean(path: string): Promise<void> {
  await execFileAsync(
    'docker',
    [
      'run', '--rm',
      '-v', `${path}:/cleanup`,
      'alpine', 'sh', '-c',
      'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true',
    ],
    { timeout: DOCKER_CLEAN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
  );
}

export async function removeWorkspaceDirectory(
  path: string,
  deps: RemoveWorkspaceDirectoryDeps = {},
): Promise<void> {
  const resolved = resolve(path);
  const lstatFn = deps.lstat ?? lstat;
  let stat: { isSymbolicLink(): boolean; isDirectory(): boolean };
  try {
    stat = await lstatFn(resolved);
  } catch (error) {
    // Only ENOENT may mean "already removed". EACCES/EIO/anything else must
    // fail closed — misclassifying a stat failure as absence would let the
    // caller clear recorded state while the directory still exists.
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return;
    throw error;
  }
  // A realpath failure (e.g. EACCES on a parent component) likewise
  // propagates rather than being treated as absence.
  const real = stat.isSymbolicLink() ? null : await realpath(resolved);
  if (
    !isAbsolute(path)
    || stat.isSymbolicLink()
    || !stat.isDirectory()
    || real === null
    || real === '/'
    || real === homedir()
    || !real.includes('/workspaces/')
  ) {
    throw new Error(
      `refusing to remove ${JSON.stringify(path)}: removeWorkspaceDirectory only removes real directories `
      + 'resolved inside a workspaces/ tree (never a symlink, /, or the home directory)',
    );
  }

  const rmDir = deps.rm ?? (target => rm(target, { recursive: true, force: true }));
  try {
    await rmDir(resolved);
    return;
  } catch (firstError) {
    const dockerClean = deps.dockerClean ?? defaultDockerClean;
    try {
      await dockerClean(resolved);
    } catch (dockerError) {
      throw new Error(
        `removing ${resolved} failed (${firstError instanceof Error ? firstError.message : String(firstError)}) `
        + 'and the Docker fallback for root-owned container artifacts also failed '
        + `(${dockerError instanceof Error ? dockerError.message : String(dockerError)})`,
      );
    }
    // Contents are gone; the directory itself is host-owned, so a plain
    // removal now succeeds. A failure here is a real error — propagate it
    // rather than leaving an empty stale directory behind.
    await rmDir(resolved);
  }
}
