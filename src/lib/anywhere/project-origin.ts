/**
 * Git origin slugs and this machine's project list for linked machines
 * (PAN-4651 FR-4, D-4651-11).
 *
 * A project's slug is `github.com/<owner>/<repo>` or `gitlab.com/<path>`, built
 * from its `github_repo` / `gitlab_repo`. Two machines hold "the same
 * repository" when their slugs are equal, ignoring case. `GET
 * /api/machines/projects` answers `listMachineProjects()` (key, name and slug
 * only, never a path); its hash rides in the link heartbeat so a viewer
 * refetches only when the list changed.
 */
import { createHash } from 'node:crypto';

import type { MachineProject } from '@overdeck/contracts';

import { listProjectsAsync, type ProjectConfig } from '../projects.js';

export function gitOriginOf(config: Pick<ProjectConfig, 'github_repo' | 'gitlab_repo'> | undefined): string | null {
  if (config?.github_repo) return `github.com/${config.github_repo}`;
  if (config?.gitlab_repo) return `gitlab.com/${config.gitlab_repo}`;
  return null;
}

/** Case-insensitive slug equality; null never matches. */
export function sameGitOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

type ListProjects = () => Promise<Array<{ key: string; config: ProjectConfig }>>;

/** Every registered project as `{ key, name, gitOrigin }`, sorted by key. */
export async function listMachineProjects(listProjects: ListProjects = listProjectsAsync): Promise<MachineProject[]> {
  const projects = await listProjects();
  return projects
    .map(({ key, config }) => ({ key, name: config.name || key, gitOrigin: gitOriginOf(config) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** First 16 hex of SHA-256 over the JSON of the list sorted by key. */
export function machineProjectsHash(projects: readonly MachineProject[]): string {
  const sorted = [...projects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

let lastProjectsHash: string | undefined;
let refreshing: Promise<void> | null = null;

/**
 * The heartbeat's `projectsHash`: the last computed value, synchronously, while
 * a refresh runs in the background (one at a time). The first beat after start
 * carries none; the viewer fetched the list on connect anyway.
 */
export function machineProjectsHashForHeartbeat(listProjects: ListProjects = listProjectsAsync): string | undefined {
  refreshing ??= listMachineProjects(listProjects)
    .then((projects) => { lastProjectsHash = machineProjectsHash(projects); })
    .catch(() => undefined)
    .finally(() => { refreshing = null; });
  return lastProjectsHash;
}

export function _resetMachineProjectsHashForTests(): void {
  lastProjectsHash = undefined;
  refreshing = null;
}
