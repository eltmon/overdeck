import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { listProjectsSync, resolveInfraRepo, type ProjectConfig, type ResolvedProject } from './projects.js';
import {
  clearStateMigrationCache,
  ensureStateWorktree,
  inspectStateMigration,
  type StateWorktreeStatus,
} from './state-home.js';

const execFileAsync = promisify(execFile);

export type AutomaticStateMigrationResult =
  | { status: 'ready'; projectKey: string; worktree: StateWorktreeStatus['status'] }
  | { status: 'blocked'; projectKey: string; reason: string };

export interface AutomaticStateMigrationDependencies {
  inspect: typeof inspectStateMigration;
  ensureWorktree: typeof ensureStateWorktree;
  migrate: (projectKey: string, project: ProjectConfig) => Promise<void>;
  clearCache: typeof clearStateMigrationCache;
  /** True when `path` is inside a git work tree — gates the migration cleanliness check. */
  isGitWorkTree: (path: string) => Promise<boolean>;
}

const inFlight = new Map<string, Promise<AutomaticStateMigrationResult>>();

async function pathIsGitWorkTree(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: path,
      encoding: 'utf8',
      timeout: 15_000,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

const defaultDependencies: AutomaticStateMigrationDependencies = {
  inspect: inspectStateMigration,
  ensureWorktree: ensureStateWorktree,
  migrate: async (projectKey, project) => {
    const { migrateProjectState } = await import('../cli/commands/admin/state-migrate.js');
    await migrateProjectState(projectKey, {}, project);
  },
  clearCache: clearStateMigrationCache,
  isGitWorkTree: pathIsGitWorkTree,
};

/**
 * A clear, operator-readable block reason for a project whose state path is not
 * a git repository (PAN-2676). A polyrepo container root — e.g. auricle, whose
 * frontend/ and backend/ are the real git repos while the container root has no
 * `.git` — otherwise fails the top-level `git status --porcelain` cleanliness
 * check with a raw "Command failed" fatal that repeats every boot. Pure so the
 * classification is unit-testable.
 */
export function describeUnmigratableProjectPath(projectKey: string, project: ProjectConfig, statePath: string): string {
  if (project.workspace?.type === 'polyrepo') {
    return `Project ${projectKey} is a polyrepo whose state path (${statePath}) is not itself a git repository, `
      + 'so the top-level state-migration cleanliness check cannot run there. '
      + 'Point pan_records.repo at the polyrepo\'s designated state-host sub-repo, then run "pan sync".';
  }
  return `Project ${projectKey}'s state path (${statePath}) is not a git repository, `
    + 'so the state-migration cleanliness check cannot run there. '
    + 'Ensure the project path is a git checkout (or set pan_records.repo to a sub-repo), then run "pan sync".';
}

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
      // A polyrepo container root / non-git project path cannot run the
      // top-level git-cleanliness migration check; classify it clearly instead
      // of surfacing a raw "Command failed: git status --porcelain" (PAN-2676).
      const { repoPath } = resolveInfraRepo(project);
      if (!(await dependencies.isGitWorkTree(repoPath))) {
        return blocked(projectKey, describeUnmigratableProjectPath(projectKey, project, repoPath));
      }
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

export interface DeaconBootGateBlockedProject {
  projectKey: string;
  reason: string;
  /** Human-readable prerequisite text (from formatAutomaticStateMigrationBlock). */
  notice: string;
}

export interface DeaconBootGateDecision {
  /**
   * Start the Deacon unless every registered project is blocked. With no
   * projects (fresh install) or at least one usable project, the Deacon starts.
   */
  startDeacon: boolean;
  blockedProjects: DeaconBootGateBlockedProject[];
  usableProjects: string[];
}

/**
 * Decide whether the Deacon may auto-start given each project's state-migration
 * result (PAN-2676). A single blocked project — a dirty operator checkout, a
 * dirty state worktree — must NOT take the whole orchestrator down: the Deacon
 * starts whenever at least one project is usable (and on a fresh install with no
 * projects), and blocked projects are reported so the operator can see which are
 * excluded. Only the all-blocked corner (one or more blocked, none usable)
 * refuses to start.
 *
 * Pure and boot-free so the boot gate can be unit-tested without a server.
 * Blocked projects are already kept out of NEW pipeline work by the state write
 * door (`requireAutomaticStateMigration`, enforced at `pan start`), so this
 * decision only governs Deacon start plus operator-facing reporting.
 */
export function decideDeaconBootGate(migrations: AutomaticStateMigrationResult[]): DeaconBootGateDecision {
  const blockedProjects: DeaconBootGateBlockedProject[] = [];
  const usableProjects: string[] = [];
  for (const migration of migrations) {
    if (migration.status === 'blocked') {
      blockedProjects.push({
        projectKey: migration.projectKey,
        reason: migration.reason,
        notice: formatAutomaticStateMigrationBlock(migration),
      });
    } else {
      usableProjects.push(migration.projectKey);
    }
  }
  const startDeacon = blockedProjects.length === 0 || usableProjects.length > 0;
  return { startDeacon, blockedProjects, usableProjects };
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
