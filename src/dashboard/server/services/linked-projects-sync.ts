/**
 * Viewer-side cache of linked machines' project lists (PAN-4651 WI-3, D-4651-11, NFR-1).
 *
 * The link supervisor calls `onConnect` when a link comes online (full fetch of
 * `GET /api/machines/projects`) and `onHeartbeat` after each beat (fetch only
 * when the owner's `projectsHash` differs from the cached one). Nothing polls.
 * The cache is in memory: `Map<environmentId, { projects, hash }>`, read by
 * placement (D-4651-10) and project grouping (D-4651-13). One fetch per
 * environment runs at a time; a trigger during a fetch queues one more. An
 * owner that predates the route answers 404 and simply has no cached list.
 */
import type { MachineProject } from '@overdeck/contracts';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { machineProjectsHash } from '../../../lib/anywhere/project-origin.js';
import type { HeartbeatPayload } from './link-heartbeat.js';

export const MACHINE_PROJECTS_PATH = '/api/machines/projects';

export interface LinkedProjectsSyncDeps {
  fetch: (environmentId: string, path: string, init: { actor: 'operator' }) => Promise<{ status: number; json: unknown }>;
  log: (message: string) => void;
}

export interface LinkedProjectsSync {
  onConnect(link: MachineLink): Promise<void>;
  onHeartbeat(link: MachineLink, payload: HeartbeatPayload): Promise<void>;
  prune(activeEnvironmentIds: readonly string[]): void;
  /** The cached list for one linked machine; null before the first successful fetch. */
  projectsFor(environmentId: string): readonly MachineProject[] | null;
}

const defaultDeps: LinkedProjectsSyncDeps = {
  fetch: linkFetch,
  log: (message) => console.warn(`[anywhere] ${message}`),
};

function isMachineProject(value: unknown): value is MachineProject {
  const row = value as Partial<MachineProject> | null;
  return !!row && typeof row === 'object' && typeof row.key === 'string' && typeof row.name === 'string'
    && (row.gitOrigin === null || typeof row.gitOrigin === 'string');
}

function decodeProjects(json: unknown): MachineProject[] | null {
  const body = json as { projects?: unknown } | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.projects)) return null;
  return body.projects.filter(isMachineProject).map(({ key, name, gitOrigin }) => ({ key, name, gitOrigin }));
}

export function createLinkedProjectsSync(overrides: Partial<LinkedProjectsSyncDeps> = {}): LinkedProjectsSync {
  const deps = { ...defaultDeps, ...overrides };
  const cache = new Map<string, { projects: MachineProject[]; hash: string }>();
  const running = new Map<string, { again: boolean }>();

  async function fetchOnce(link: MachineLink): Promise<void> {
    let response: { status: number; json: unknown };
    try {
      response = await deps.fetch(link.environmentId, MACHINE_PROJECTS_PATH, { actor: 'operator' });
    } catch (error) {
      deps.log(`could not fetch ${link.label}'s projects: ${(error as Error).message}`);
      return;
    }
    if (response.status !== 200) {
      if (response.status !== 404) deps.log(`${link.label} answered ${response.status} for its projects`);
      return;
    }
    const projects = decodeProjects(response.json);
    if (!projects) {
      deps.log(`${link.label} sent a malformed project list`);
      return;
    }
    cache.set(link.environmentId, { projects, hash: machineProjectsHash(projects) });
  }

  async function sync(link: MachineLink): Promise<void> {
    const current = running.get(link.environmentId);
    if (current) {
      current.again = true;
      return;
    }
    const state = { again: false };
    running.set(link.environmentId, state);
    try {
      do {
        state.again = false;
        await fetchOnce(link);
      } while (state.again);
    } finally {
      running.delete(link.environmentId);
    }
  }

  return {
    onConnect: (link) => sync(link),
    async onHeartbeat(link, payload) {
      const hash = payload.projectsHash;
      if (hash === undefined || cache.get(link.environmentId)?.hash === hash) return;
      await sync(link);
    },
    prune(activeEnvironmentIds) {
      const active = new Set(activeEnvironmentIds);
      for (const environmentId of cache.keys()) if (!active.has(environmentId)) cache.delete(environmentId);
    },
    projectsFor: (environmentId) => cache.get(environmentId)?.projects ?? null,
  };
}

let current: LinkedProjectsSync | null = null;

/** The primary dashboard's sync (set in `startAnywhere`); null elsewhere. */
export function currentLinkedProjects(): LinkedProjectsSync | null {
  return current;
}

export function setLinkedProjectsSync(sync: LinkedProjectsSync | null): void {
  current = sync;
}
