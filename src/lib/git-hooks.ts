import { existsSync, mkdirSync, readlinkSync, readdirSync, renameSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { SYNC_SOURCES } from './paths.js';

const BUNDLED_HOOKS_DIR = SYNC_SOURCES.gitHooks;

export function installGitHooksInDir(gitDir: string): number {
  const hooksTarget = join(gitDir, 'hooks');
  let installed = 0;

  if (!existsSync(hooksTarget)) {
    mkdirSync(hooksTarget, { recursive: true });
  }

  if (!existsSync(BUNDLED_HOOKS_DIR)) return 0;

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
