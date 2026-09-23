/**
 * projects.yaml key lookup by filesystem path (PAN-3920).
 *
 * `findProjectByPathSync` answers the project's config; the Agents Directory
 * groups by the projects.yaml *key*, so this returns the key instead. Lives
 * beside projects.ts rather than in it: that file is at its size ceiling.
 */
import { resolve } from 'node:path';

import { loadProjectsConfigSync } from '../projects.js';

/** The projects.yaml key of the project containing `path` (the deepest root wins), or null. */
export function findProjectKeyByPathSync(path: string): string | null {
  if (!path) return null;
  const config = loadProjectsConfigSync();
  const target = resolve(path);
  let best: { key: string; depth: number } | null = null;
  for (const [key, project] of Object.entries(config.projects)) {
    if (!project.path) continue;
    const root = resolve(project.path);
    if (target !== root && !target.startsWith(root + '/')) continue;
    if (!best || root.length > best.depth) best = { key, depth: root.length };
  }
  return best?.key ?? null;
}
