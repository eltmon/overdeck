/**
 * projects.yaml key lookup by filesystem path (PAN-3920).
 *
 * `findProjectByPathSync` answers the project's config; the Agents Directory
 * groups by the projects.yaml *key*, so this returns the key instead. Lives
 * beside projects.ts rather than in it: that file is at its size ceiling.
 */
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { loadProjectsConfigSync } from '../projects.js';

/**
 * Absolute, symlink-free form of a projects.yaml or agent path. projects.yaml
 * keeps path strings as written, so `~` is expanded here. A path that does not
 * exist (a deleted workspace, a stale project root) resolves its deepest
 * existing ancestor and keeps the missing segments, so it still lands under a
 * root reached through a symlink.
 */
function canonicalPath(path: string): string {
  const expanded = path === '~' ? homedir()
    : path.startsWith('~/') || path.startsWith(`~${sep}`) ? join(homedir(), path.slice(2))
      : path;
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

/** True when `target` is `root` or lies under it (platform separators, filesystem root included). */
function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** The projects.yaml key of the project containing `path` (the deepest root wins), or null. */
export function findProjectKeyByPathSync(path: string): string | null {
  if (!path) return null;
  const config = loadProjectsConfigSync();
  const target = canonicalPath(path);
  let best: { key: string; depth: number } | null = null;
  for (const [key, project] of Object.entries(config.projects)) {
    if (!project.path) continue;
    const root = canonicalPath(project.path);
    if (!isWithin(root, target)) continue;
    if (!best || root.length > best.depth) best = { key, depth: root.length };
  }
  return best?.key ?? null;
}
