import { listProjectsSync } from '../../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../../lib/state-read-home.js';
import { createBeadsResolver, type BeadRecord, type BeadsResolver } from '../../../lib/beads/resolver.js';

export interface BeadRollup {
  total: number;
  closed: number;
  inProgress: number;
  lastUpdated: string | null;
}

export interface ProjectRollupState {
  rollups: Map<string, BeadRollup>;
  stale: boolean;
}

export interface BeadsRollupServiceDependencies {
  projects?: () => Array<{ key: string; beadsCwd: string }>;
  createResolver?: (beadsCwd: string) => BeadsResolver;
  subscribe?: (listener: (event: { type: string; payload?: Record<string, unknown> }) => void) => (() => void) | void;
  now?: () => number;
  debounceMs?: number;
}

const DEBOUNCE_MS = 2_000;

function defaultProjects() {
  return listProjectsSync().map(({ key, config }) => ({
    key,
    beadsCwd: resolveStateReadHomeSync(config).root,
  }));
}

function defaultCreateResolver(beadsCwd: string): BeadsResolver {
  return createBeadsResolver(beadsCwd, {
    retry: { acquisitionTimeoutMs: 5_000 },
  });
}

function extractIssueLabels(labels: string[]): string[] {
  const result = new Set<string>();
  for (const label of labels) {
    const normalized = label.toLowerCase();
    if (/^[a-z]+-\d+$/.test(normalized)) {
      result.add(normalized);
    }
    const workspaceMatch = /^workspace:([a-z]+-\d+)$/.exec(normalized);
    if (workspaceMatch) {
      result.add(workspaceMatch[1]!);
    }
  }
  return Array.from(result);
}

function maxUpdated(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function computeRollups(beads: BeadRecord[]): Map<string, BeadRollup> {
  const groups = new Map<string, BeadRollup>();
  for (const bead of beads) {
    const issueLabels = extractIssueLabels(bead.labels);
    if (issueLabels.length === 0) continue;
    const status = typeof bead.status === 'string' ? bead.status.toLowerCase() : 'open';
    const updatedAt = typeof bead.updated_at === 'string'
      ? bead.updated_at
      : typeof bead.updatedAt === 'string'
        ? bead.updatedAt
        : null;
    for (const label of issueLabels) {
      const existing = groups.get(label);
      if (existing) {
        existing.total += 1;
        if (status === 'closed') existing.closed += 1;
        else if (status === 'in_progress') existing.inProgress += 1;
        existing.lastUpdated = maxUpdated(existing.lastUpdated, updatedAt);
      } else {
        groups.set(label, {
          total: 1,
          closed: status === 'closed' ? 1 : 0,
          inProgress: status === 'in_progress' ? 1 : 0,
          lastUpdated: updatedAt,
        });
      }
    }
  }
  return groups;
}

export function createBeadsRollupService(dependencies: BeadsRollupServiceDependencies = {}) {
  const projects = dependencies.projects ?? defaultProjects;
  const createResolver = dependencies.createResolver ?? defaultCreateResolver;
  const subscribe = dependencies.subscribe;
  const now = dependencies.now ?? Date.now;
  const debounceMs = dependencies.debounceMs ?? DEBOUNCE_MS;

  const stateByProject = new Map<string, ProjectRollupState>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  let unsubscribe: (() => void) | undefined;
  let stopped = false;

  async function refreshProject(projectKey: string, beadsCwd: string): Promise<void> {
    const resolver = createResolver(beadsCwd);
    const result = await resolver.getAllBeads();
    if (result.ok) {
      stateByProject.set(projectKey, { rollups: computeRollups(result.value), stale: false });
    } else {
      const previous = stateByProject.get(projectKey);
      stateByProject.set(projectKey, {
        rollups: previous?.rollups ?? new Map<string, BeadRollup>(),
        stale: true,
      });
    }
  }

  function scheduleRefresh(projectKey: string): void {
    const existing = debounceTimers.get(projectKey);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      projectKey,
      setTimeout(() => {
        debounceTimers.delete(projectKey);
        const project = projects().find((p) => p.key === projectKey);
        if (project) {
          void refreshProject(project.key, project.beadsCwd);
        }
      }, debounceMs),
    );
  }

  function start(): void {
    if (stopped) return;
    for (const project of projects()) {
      void refreshProject(project.key, project.beadsCwd);
    }
    if (subscribe) {
      unsubscribe = subscribe((event) => {
        if (event.type !== 'beads.freshness_changed') return;
        const payload = event.payload ?? {};
        const projectKey = typeof payload.projectKey === 'string' ? payload.projectKey : undefined;
        if (projectKey) scheduleRefresh(projectKey);
      }) as (() => void) | undefined;
    }
  }

  function stop(): void {
    stopped = true;
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = undefined;
    }
  }

  function getProjectRollups(projectKey: string): ProjectRollupState | null {
    return stateByProject.get(projectKey) ?? null;
  }

  return { start, stop, getProjectRollups };
}
