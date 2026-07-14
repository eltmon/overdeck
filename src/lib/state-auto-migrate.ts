import { listProjectsSync, type ProjectConfig, type ResolvedProject } from './projects.js';
import {
  clearStateMigrationCache,
  ensureStateWorktree,
  inspectStateMigration,
  type StateWorktreeStatus,
} from './state-home.js';

export type AutomaticStateMigrationResult =
  | { status: 'ready'; projectKey: string; worktree: StateWorktreeStatus['status'] }
  | { status: 'blocked'; projectKey: string; reason: string };

export interface AutomaticStateMigrationDependencies {
  inspect: typeof inspectStateMigration;
  ensureWorktree: typeof ensureStateWorktree;
  migrate: (projectKey: string, project: ProjectConfig) => Promise<void>;
  clearCache: typeof clearStateMigrationCache;
}

const inFlight = new Map<string, Promise<AutomaticStateMigrationResult>>();

const defaultDependencies: AutomaticStateMigrationDependencies = {
  inspect: inspectStateMigration,
  ensureWorktree: ensureStateWorktree,
  migrate: async (projectKey, project) => {
    const { migrateProjectState } = await import('../cli/commands/admin/state-migrate.js');
    await migrateProjectState(projectKey, {}, project);
  },
  clearCache: clearStateMigrationCache,
};

function blocked(projectKey: string, error: unknown): AutomaticStateMigrationResult {
  const reason = error instanceof Error ? error.message : String(error);
  return { status: 'blocked', projectKey, reason };
}

function worktreeBlockReason(status: Extract<StateWorktreeStatus, { status: 'dirty' | 'error' }>): string {
  return `The canonical overdeck-state worktree is ${status.status}: ${status.detail}`;
}

async function reconcile(
  projectKey: string,
  project: ProjectConfig,
  dependencies: AutomaticStateMigrationDependencies,
): Promise<AutomaticStateMigrationResult> {
  try {
    const before = await dependencies.inspect(project);
    if (!before.migrated) {
      await dependencies.migrate(projectKey, project);
      dependencies.clearCache();
      const after = await dependencies.inspect(project);
      if (!after.migrated) {
        return blocked(projectKey, 'Migration completed without a valid marker on origin/overdeck-state.');
      }
    }

    const worktree = await dependencies.ensureWorktree(project, { projectKey });
    if (worktree.status === 'dirty' || worktree.status === 'error') {
      return blocked(projectKey, worktreeBlockReason(worktree));
    }
    if (worktree.status === 'legacy') {
      return blocked(projectKey, 'The remote migration marker is valid but the local state worktree still resolves to the legacy project checkout.');
    }
    return { status: 'ready', projectKey, worktree: worktree.status };
  } catch (error) {
    return blocked(projectKey, error);
  }
}

/**
 * Make the canonical state plane ready before pipeline work can write durable
 * state. Concurrent dashboard/CLI callers on this process share one attempt;
 * the migration command supplies the cross-process lock and no-loss gates.
 */
export function ensureAutomaticStateMigration(
  projectKey: string,
  project: ProjectConfig,
  dependencies: AutomaticStateMigrationDependencies = defaultDependencies,
): Promise<AutomaticStateMigrationResult> {
  const existing = inFlight.get(projectKey);
  if (existing) return existing;
  const task = reconcile(projectKey, project, dependencies)
    .finally(() => inFlight.delete(projectKey));
  inFlight.set(projectKey, task);
  return task;
}

export function formatAutomaticStateMigrationBlock(result: Extract<AutomaticStateMigrationResult, { status: 'blocked' }>): string {
  return `State migration for ${result.projectKey} is blocked: ${result.reason} `
    + 'Overdeck will not start pipeline work because that would write permanent state into the legacy project checkout. '
    + `Resolve the stated prerequisite, then run "pan sync"; do not commit project-root .pan/ or .beads/ files.`;
}

export async function requireAutomaticStateMigration(resolved: ResolvedProject): Promise<void> {
  let projectEntry: { key: string; config: ProjectConfig } | undefined;
  try {
    projectEntry = listProjectsSync().find(({ key, config }) =>
      key === resolved.projectKey || config.name === resolved.projectName || config.path === resolved.projectPath);
  } catch {
    // Embedded callers may expose only the issue projection; production
    // polyrepo metadata comes from the registered project entry above.
  }
  projectEntry ??= { key: resolved.projectKey, config: { name: resolved.projectName, path: resolved.projectPath } };
  const result = await ensureAutomaticStateMigration(projectEntry.key, projectEntry.config);
  if (result.status === 'blocked') throw new Error(formatAutomaticStateMigrationBlock(result));
}
