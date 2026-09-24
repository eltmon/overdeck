/**
 * projects.yaml key lookup by filesystem path (PAN-3920).
 *
 * `findProjectByPath` answers the project's config; the Agents Directory
 * groups by the projects.yaml *key*, so this returns the key instead. Lives
 * beside projects.ts rather than in it: that file is at its size ceiling.
 */
import { loadProjectsConfigSync } from '../projects.js';
import { findContainingProject } from './path-containment.js';

/** The projects.yaml key of the project containing `path` (the deepest root wins), or null. */
export function findProjectKeyByPath(path: string): string | null {
  if (!path) return null;
  return findContainingProject(loadProjectsConfigSync().projects, path)?.[0] ?? null;
}
