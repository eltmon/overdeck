/**
 * Filesystem-path containment for projects.yaml roots (PAN-4046).
 *
 * A leaf module with no project imports, so projects.ts and project-key.ts
 * share it without an import cycle.
 */
import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Absolute, symlink-free form of a projects.yaml or agent path. projects.yaml
 * keeps path strings as written, so `~` is expanded here. A path that does not
 * exist (a deleted workspace, a stale project root) resolves its deepest
 * existing ancestor and keeps the missing segments, so it still lands under a
 * root reached through a symlink.
 */
export function canonicalPath(path: string): string {
  const expanded = expandHome(path);
  let existing = resolve(expanded);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(expanded);
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

/** `canonicalPath` without sync fs, for request paths (`fs.promises.realpath`). */
export async function canonicalPathAsync(path: string): Promise<string> {
  const expanded = expandHome(path);
  let existing = resolve(expanded);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(await realpath(existing), ...missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(expanded);
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith(`~${sep}`)) return join(homedir(), path.slice(2));
  return path;
}

/** True when `target` is `root` or lies under it (platform separators, filesystem root included). */
export function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * The `[key, project]` entry whose root contains `path`, or null. The deepest
 * root wins, so a nested project beats its parent. Entries without a path are
 * skipped.
 */
export function findContainingProject<T extends { path?: string }>(
  projects: Record<string, T>,
  path: string,
): [string, T] | null {
  const target = canonicalPath(path);
  let best: { entry: [string, T]; depth: number } | null = null;
  for (const [key, project] of Object.entries(projects)) {
    if (!project.path) continue;
    const root = canonicalPath(project.path);
    if (!isWithin(root, target)) continue;
    if (!best || root.length > best.depth) best = { entry: [key, project], depth: root.length };
  }
  return best?.entry ?? null;
}

/** `findContainingProject` without sync fs, for request paths. */
export async function findContainingProjectAsync<T extends { path?: string }>(
  projects: Record<string, T>,
  path: string,
): Promise<[string, T] | null> {
  const target = await canonicalPathAsync(path);
  let best: { entry: [string, T]; depth: number } | null = null;
  for (const [key, project] of Object.entries(projects)) {
    if (!project.path) continue;
    const root = await canonicalPathAsync(project.path);
    if (!isWithin(root, target)) continue;
    if (!best || root.length > best.depth) best = { entry: [key, project], depth: root.length };
  }
  return best?.entry ?? null;
}
