import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SYNC_SOURCES } from './paths.js';

const BUNDLED_HOOKS_DIR = SYNC_SOURCES.gitHooks;

/**
 * Remove git-hook symlinks whose Overdeck source was deleted (PAN-3881).
 *
 * `pan sync` and project registration install each file in
 * `sync-sources/hooks/git-hooks/` as a symlink in a repo's hooks dir. When a
 * hook is deleted from the sources, that symlink dangles forever. This removes
 * only entries that are symlinks, point directly into `sourceDir`, and whose
 * target no longer exists. Regular files, `.backup` copies, and links into any
 * other directory are never touched. A missing `sourceDir` prunes nothing, so a
 * broken install cannot strip every managed hook.
 *
 * @returns the names of the removed hooks.
 */
export function pruneDanglingGitHookLinks(hooksDir: string, sourceDir: string = BUNDLED_HOOKS_DIR): string[] {
  if (!existsSync(sourceDir) || !existsSync(hooksDir)) return [];
  const ownDir = resolve(sourceDir);
  const removed: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(hooksDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const path = join(hooksDir, entry);
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
      const target = resolve(hooksDir, readlinkSync(path));
      if (dirname(target) !== ownDir) continue;
      if (existsSync(target)) continue;
      unlinkSync(path);
      removed.push(entry);
    } catch {
      // Unreadable entry: leave it alone.
    }
  }

  return removed;
}

export function installGitHooksInDir(gitDir: string): number {
  const hooksTarget = join(gitDir, 'hooks');
  let installed = 0;

  if (!existsSync(hooksTarget)) {
    mkdirSync(hooksTarget, { recursive: true });
  }

  if (!existsSync(BUNDLED_HOOKS_DIR)) return 0;

  pruneDanglingGitHookLinks(hooksTarget);

  try {
    const hooks = readdirSync(BUNDLED_HOOKS_DIR).filter((file) => {
      const path = join(BUNDLED_HOOKS_DIR, file);
      return existsSync(path) && statSync(path).isFile();
    });

    for (const hook of hooks) {
      const source = join(BUNDLED_HOOKS_DIR, hook);
      const target = join(hooksTarget, hook);

      if (existsSync(target)) {
        try {
          if (readlinkSync(target) === source) continue;
        } catch {
          // Not a symlink — preserve it before installing the managed hook.
        }
        renameSync(target, `${target}.backup`);
      }

      symlinkSync(source, target);
      installed++;
    }
  } catch {
    // Hooks are optional and must not block project registration.
  }

  return installed;
}
