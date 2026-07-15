/**
 * State-home resolver and dedicated overdeck-state worktree manager (PAN-2541).
 *
 * Migration is complete only when the tip of origin/overdeck-state contains a
 * valid migration-complete.json whose stateBranchSha is an ancestor of the tip.
 * An unmarked branch is an in-progress migration and continues using legacy
 * project-root state paths.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { getOverdeckHome } from './paths.js';
import { resolveInfraRepo, type ProjectConfig } from './projects.js';
import { projectKey } from './project-key.js';
import { STATE_BRANCH_PATHS } from './state-plane.js';

const execFileAsync = promisify(execFile);
export const STATE_BRANCH = 'overdeck-state';
export const MIGRATION_COMPLETE_MARKER = 'migration-complete.json';

export interface MigrationCompleteMarker {
  sourceMainSha: string;
  stateBranchSha: string;
  completedAt: string;
  version: number;
}

export interface StateHome {
  worktreePath: string;
  repoPath: string;
  recordsPath: string;
  migrated: boolean;
  migrationInProgress: boolean;
  remoteTip: string | null;
}

export interface StateReadHome {
  root: string;
  migrated: boolean;
}

export type StateWorktreeStatus =
  | { status: 'healthy'; path: string }
  | { status: 'created'; path: string }
  | { status: 'recreated'; path: string }
  | { status: 'legacy'; path: string }
  | { status: 'dirty'; path: string; detail: string }
  | { status: 'error'; path: string; detail: string };

interface StateHomeOptions {
  projectKey?: string;
}

const migrationCache = new Map<string, { remoteTip: string | null; migrated: boolean }>();

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15_000,
    killSignal: 'SIGTERM',
  });
  return stdout.trim();
}

export function stateWorktreePath(project: ProjectConfig, options: StateHomeOptions = {}): string {
  return join(getOverdeckHome(), 'state', projectKey(project, options.projectKey));
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

export function parseMigrationCompleteMarker(value: unknown): MigrationCompleteMarker | null {
  if (!value || typeof value !== 'object') return null;
  const marker = value as Partial<MigrationCompleteMarker>;
  if (!isSha(marker.sourceMainSha) || !isSha(marker.stateBranchSha)) return null;
  if (typeof marker.completedAt !== 'string' || !Number.isFinite(Date.parse(marker.completedAt))) return null;
  if (!Number.isInteger(marker.version) || (marker.version ?? 0) < 1) return null;
  return marker as MigrationCompleteMarker;
}

async function remoteStateTip(repoPath: string): Promise<string | null> {
  const output = await git(repoPath, ['ls-remote', '--heads', 'origin', `refs/heads/${STATE_BRANCH}`]);
  const sha = output.split(/\s+/)[0];
  return isSha(sha) ? sha : null;
}

async function markerAtRemoteTip(repoPath: string, tip: string): Promise<MigrationCompleteMarker | null> {
  await git(repoPath, [
    'fetch',
    '--quiet',
    'origin',
    `refs/heads/${STATE_BRANCH}:refs/remotes/origin/${STATE_BRANCH}`,
  ]);
  const fetchedTip = await git(repoPath, ['rev-parse', `refs/remotes/origin/${STATE_BRANCH}`]);
  if (fetchedTip !== tip) return null;

  let raw: string;
  try {
    raw = await git(repoPath, ['show', `${tip}:${MIGRATION_COMPLETE_MARKER}`]);
  } catch {
    return null;
  }
  let marker: MigrationCompleteMarker | null;
  try {
    marker = parseMigrationCompleteMarker(JSON.parse(raw));
  } catch {
    marker = null;
  }
  if (!marker) return null;

  // The marker's stateBranchSha must be an ancestor of (or equal to) the tip —
  // the state branch keeps growing after migration (records, specs, notes),
  // so requiring the marker to be the LAST commit would un-migrate the project
  // on its first post-migration state write. Ancestry still proves the marker
  // belongs to this branch's history rather than a graft from elsewhere.
  const anchored = await git(repoPath, ['merge-base', '--is-ancestor', marker.stateBranchSha, tip])
    .then(() => true)
    .catch(() => false);
  return anchored ? marker : null;
}

export async function inspectStateMigration(project: ProjectConfig): Promise<{
  migrated: boolean;
  migrationInProgress: boolean;
  remoteTip: string | null;
}> {
  const { repoPath } = resolveInfraRepo(project);
  let tip: string | null;
  try {
    tip = await remoteStateTip(repoPath);
  } catch {
    return { migrated: false, migrationInProgress: false, remoteTip: null };
  }
  const cached = migrationCache.get(repoPath);
  if (cached?.remoteTip === tip) {
    return { migrated: cached.migrated, migrationInProgress: tip !== null && !cached.migrated, remoteTip: tip };
  }
  const migrated = tip !== null && await markerAtRemoteTip(repoPath, tip) !== null;
  migrationCache.set(repoPath, { remoteTip: tip, migrated });
  return { migrated, migrationInProgress: tip !== null && !migrated, remoteTip: tip };
}

export async function isStateMigrated(project: ProjectConfig): Promise<boolean> {
  return (await inspectStateMigration(project)).migrated;
}

export function shouldCommitLegacyWorkspaceArtifacts(migrated: boolean): boolean {
  return !migrated;
}

export async function findRecreatedLegacyStatePaths(project: ProjectConfig): Promise<string[]> {
  if (!(await isStateMigrated(project))) return [];
  // The recreation tripwire scans the LEGACY SOURCE (project.path) — the
  // location the migration reads and deletes legacy state from
  // (state-migrate.ts `legacyStateSource`). This is deliberately NOT the state
  // HOST (resolveInfraRepo, used above to gate `isStateMigrated` and to locate
  // where migrated state now lives): for a polyrepo the source is the non-git
  // root while the host is a sub-repo, so a stray writer recreates state at the
  // root, not the host. Rooting this scan at the host would blind the tripwire
  // in exactly the polyrepo case.
  const legacyStateRoot = project.path;
  return STATE_BRANCH_PATHS
    .map((statePath) => join(legacyStateRoot, '.pan', statePath.slice(0, -1)))
    .filter(existsSync);
}

export async function resolveStateHome(project: ProjectConfig, options: StateHomeOptions = {}): Promise<StateHome> {
  const legacy = resolveInfraRepo(project);
  const migration = await inspectStateMigration(project);
  const worktreePath = stateWorktreePath(project, options);
  return migration.migrated
    ? { ...migration, worktreePath, repoPath: worktreePath, recordsPath: '.' }
    : { ...migration, worktreePath, repoPath: legacy.repoPath, recordsPath: legacy.recordsPath };
}

/**
 * Synchronous read-door resolution for legacy synchronous APIs. The async
 * resolver remains authoritative for migration detection; this compatibility
 * door uses only an already-materialized, valid state-worktree marker and
 * otherwise falls back read-only to the legacy checkout.
 */
export function resolveStateReadHomeSync(
  project: ProjectConfig,
  options: StateHomeOptions = {},
): StateReadHome {
  const worktreePath = stateWorktreePath(project, options);
  const markerPath = join(worktreePath, MIGRATION_COMPLETE_MARKER);
  if (existsSync(markerPath)) {
    try {
      if (parseMigrationCompleteMarker(JSON.parse(readFileSync(markerPath, 'utf8')))) {
        return { root: worktreePath, migrated: true };
      }
    } catch {
      // Invalid or interrupted marker: preserve D12's legacy resolution.
    }
  }
  return { root: resolveInfraRepo(project).repoPath, migrated: false };
}

export function resolveStateDomainPathSync(
  project: ProjectConfig,
  domain: string,
  options: StateHomeOptions = {},
): string {
  const home = resolveStateReadHomeSync(project, options);
  return home.migrated ? join(home.root, domain) : join(home.root, '.pan', domain);
}

async function addStateWorktree(repoPath: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const localBranchExists = await git(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${STATE_BRANCH}`])
    .then(() => true, () => false);
  const args = localBranchExists
    ? ['worktree', 'add', path, STATE_BRANCH]
    : ['worktree', 'add', '--track', '-b', STATE_BRANCH, path, `origin/${STATE_BRANCH}`];
  await git(repoPath, args);
}

export async function ensureStateWorktree(
  project: ProjectConfig,
  options: StateHomeOptions = {},
): Promise<StateWorktreeStatus> {
  const migration = await inspectStateMigration(project);
  const path = stateWorktreePath(project, options);
  if (!migration.migrated) return { status: 'legacy', path };

  const { repoPath } = resolveInfraRepo(project);
  if (!existsSync(path)) {
    await addStateWorktree(repoPath, path);
    return { status: 'created', path };
  }

  let branch: string;
  try {
    branch = await git(path, ['branch', '--show-current']);
  } catch (error) {
    return { status: 'error', path, detail: error instanceof Error ? error.message : String(error) };
  }
  if (branch === STATE_BRANCH) return { status: 'healthy', path };

  try {
    const dirty = await git(path, ['status', '--porcelain']);
    if (dirty) return { status: 'dirty', path, detail: 'state worktree has uncommitted changes; refusing destructive repair' };
    await git(repoPath, ['worktree', 'remove', path]);
    await rm(path, { recursive: true, force: true });
    await addStateWorktree(repoPath, path);
    return { status: 'recreated', path };
  } catch (error) {
    return { status: 'error', path, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function clearStateMigrationCache(): void {
  migrationCache.clear();
}
