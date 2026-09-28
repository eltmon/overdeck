/**
 * Nested-repository scan for project creation (PAN-4281 WI-2).
 *
 * When an `existing`-mode folder is not itself a repository, resolve lists the
 * repositories directly inside it so the operator can add them one by one or as
 * one multi-repo project. Resolve runs on every settled keystroke, so this scan
 * is read-only, looks one level deep only, and spawns no child process (NFR-2):
 * a child counts as a repository when `<child>/.git` exists, as a directory or
 * as a linked worktree's file.
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';

export interface NestedRepository {
  path: string;
  name: string;
}

export async function findNestedRepositories(dir: string, limit = 50): Promise<NestedRepository[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
  const checked = await Promise.all(
    candidates.map(async (entry) => {
      try {
        await stat(join(dir, entry.name, '.git'));
        return entry.name;
      } catch {
        return null;
      }
    }),
  );
  return checked
    .filter((name): name is string => name !== null)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit)
    .map((name) => ({ path: join(dir, name), name }));
}
