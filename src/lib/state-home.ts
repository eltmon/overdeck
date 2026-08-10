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
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
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
  | { status: 'legacy'; path: string; detail: string }
  | { status: 'dirty'; path: string; detail: string }
  | { status: 'error'; path: string; detail: string };

export interface StateMigrationInspection {
  migrated: boolean;
  migrationInProgress: boolean;
  remoteTip: string | null;
  completedAt?: string;
  fallback?: 'cache' | 'local';
  remoteCheckFailed?: true;
}

export interface LegacyStatePathInspection {
  postMigrationWrites: string[];
  inertDirectories: string[];
  staleFiles: string[];
}

type StateGit = (repoPath: string, args: string[], signal?: AbortSignal) => Promise<string>;

interface StateHomeOptions {
  projectKey?: string;
  signal?: AbortSignal;
  git?: StateGit;
}

const migrationCache = new Map<string, { remoteTip: string | null; migrated: boolean; completedAt?: string }>();

async function git(repoPath: string, args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15_000,
    killSignal: 'SIGTERM',
    signal,
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

function readMigrationCompleteMarker(path: string): MigrationCompleteMarker | null {
  if (!existsSync(path)) return null;
  try {
    return parseMigrationCompleteMarker(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

async function remoteStateTip(repoPath: string, signal?: AbortSignal, runGit: StateGit = git): Promise<string | null> {
  const output = await runGit(repoPath, ['ls-remote', '--heads', 'origin', `refs/heads/${STATE_BRANCH}`], signal);
  const sha = output.split(/\s+/)[0];
  return isSha(sha) ? sha : null;
}

interface RemoteMarkerInspection {
  marker: MigrationCompleteMarker | null;
  tip: string;
}

async function markerAtRemoteTip(
  repoPath: string,
  initialTip: string,
  signal?: AbortSignal,
  runGit: StateGit = git,
): Promise<RemoteMarkerInspection> {
  let tip = initialTip;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await runGit(repoPath, [
      'fetch',
      '--quiet',
      'origin',
      `refs/heads/${STATE_BRANCH}:refs/remotes/origin/${STATE_BRANCH}`,
    ], signal);
    const fetchedTip = await runGit(repoPath, ['rev-parse', `refs/remotes/origin/${STATE_BRANCH}`], signal);
    if (!isSha(fetchedTip)) throw new Error(`Invalid origin/${STATE_BRANCH} tip: ${fetchedTip}`);
    if (fetchedTip === tip || attempt === 2) {
      tip = fetchedTip;
      break;
    }
    tip = fetchedTip;
  }

  let raw: string;
  try {
    raw = await runGit(repoPath, ['show', `${tip}:${MIGRATION_COMPLETE_MARKER}`], signal);
  } catch {
    signal?.throwIfAborted();
    return { marker: null, tip };
  }
  let marker: MigrationCompleteMarker | null;
  try {
    marker = parseMigrationCompleteMarker(JSON.parse(raw));
  } catch {
    marker = null;
  }
  if (!marker) return { marker: null, tip };

  // The marker's stateBranchSha must be an ancestor of (or equal to) the tip —
  // the state branch keeps growing after migration (records, specs, notes),
  // so requiring the marker to be the LAST commit would un-migrate the project
  // on its first post-migration state write. Ancestry still proves the marker
  // belongs to this branch's history rather than a graft from elsewhere.
  const anchored = await runGit(repoPath, ['merge-base', '--is-ancestor', marker.stateBranchSha, tip], signal)
    .then(() => true)
    .catch(() => {
      signal?.throwIfAborted();
      return false;
    });
  return { marker: anchored ? marker : null, tip };
}

export async function inspectStateMigration(
  project: ProjectConfig,
  options: StateHomeOptions = {},
): Promise<StateMigrationInspection> {
  const { repoPath } = resolveInfraRepo(project);
  const cached = migrationCache.get(repoPath);
  const runGit = options.git ?? git;
  try {
    const listedTip = await remoteStateTip(repoPath, options.signal, runGit);
    if (cached?.remoteTip === listedTip) {
      return {
        migrated: cached.migrated,
        migrationInProgress: listedTip !== null && !cached.migrated,
        remoteTip: listedTip,
        ...(cached.completedAt ? { completedAt: cached.completedAt } : {}),
      };
    }
    if (listedTip === null) {
      migrationCache.set(repoPath, { remoteTip: null, migrated: false });
      return { migrated: false, migrationInProgress: false, remoteTip: null };
    }

    const remote = await markerAtRemoteTip(repoPath, listedTip, options.signal, runGit);
    const migrated = remote.marker !== null;
    const completedAt = remote.marker?.completedAt;
    migrationCache.set(repoPath, { remoteTip: remote.tip, migrated, completedAt });
    return {
      migrated,
      migrationInProgress: !migrated,
      remoteTip: remote.tip,
      ...(completedAt ? { completedAt } : {}),
    };
  } catch {
    options.signal?.throwIfAborted();
    if (cached?.migrated) {
      return {
        migrated: true,
        migrationInProgress: false,
        remoteTip: cached.remoteTip,
        ...(cached.completedAt ? { completedAt: cached.completedAt } : {}),
        fallback: 'cache',
      };
    }
    const localMarker = readMigrationCompleteMarker(
      join(stateWorktreePath(project, options), MIGRATION_COMPLETE_MARKER),
    );
    if (localMarker) {
      return {
        migrated: true,
        migrationInProgress: false,
        remoteTip: null,
        completedAt: localMarker.completedAt,
        fallback: 'local',
      };
    }
    return { migrated: false, migrationInProgress: false, remoteTip: null, remoteCheckFailed: true };
  }
}

export async function isStateMigrated(project: ProjectConfig): Promise<boolean> {
  return (await inspectStateMigration(project)).migrated;
}

export function shouldCommitLegacyWorkspaceArtifacts(migrated: boolean): boolean {
  return !migrated;
}

async function inspectLegacyStatePath(
  path: string,
  completedAtMs: number,
): Promise<LegacyStatePathInspection> {
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch {
    return { postMigrationWrites: [], inertDirectories: [], staleFiles: [] };
  }

  const postMigrationWrites = pathStat.mtimeMs > completedAtMs ? [path] : [];
  if (!pathStat.isDirectory()) {
    return {
      postMigrationWrites,
      inertDirectories: [],
      staleFiles: postMigrationWrites.length === 0 ? [path] : [],
    };
  }

  let entries;
  try {
    entries = await readdir(path);
  } catch {
    return { postMigrationWrites, inertDirectories: [], staleFiles: [] };
  }
  if (entries.length === 0) {
    return {
      postMigrationWrites,
      inertDirectories: postMigrationWrites.length === 0 ? [path] : [],
      staleFiles: [],
    };
  }
  if (postMigrationWrites.length > 0) {
    return { postMigrationWrites, inertDirectories: [], staleFiles: [] };
  }

  const children = await Promise.all(entries.sort().map(entry => inspectLegacyStatePath(join(path, entry), completedAtMs)));
  return children.reduce<LegacyStatePathInspection>((result, child) => ({
    postMigrationWrites: [...result.postMigrationWrites, ...child.postMigrationWrites],
    inertDirectories: [...result.inertDirectories, ...child.inertDirectories],
    staleFiles: [...result.staleFiles, ...child.staleFiles],
  }), { postMigrationWrites, inertDirectories: [], staleFiles: [] });
}

/**
 * Inspects legacy state only after a completed migration. A path is evidence of
 * a stray writer only when its mtime is newer than the completion marker.
 */
export async function inspectLegacyStatePaths(project: ProjectConfig): Promise<LegacyStatePathInspection> {
  const migration = await inspectStateMigration(project);
  if (!migration.migrated || !migration.completedAt) {
    return { postMigrationWrites: [], inertDirectories: [], staleFiles: [] };
  }
  // The recreation tripwire scans the LEGACY SOURCE (project.path) — the
  // location the migration reads and deletes legacy state from
  // (state-migrate.ts `legacyStateSource`). This is deliberately NOT the state
  // HOST (resolveInfraRepo, used above to gate `isStateMigrated` and to locate
  // where migrated state now lives): for a polyrepo the source is the non-git
  // root while the host is a sub-repo, so a stray writer recreates state at the
  // source root, not the host.
  const completedAtMs = new Date(migration.completedAt).getTime();
  const legacyStateRoot = project.path;
  const inspections = await Promise.all(STATE_BRANCH_PATHS.map(statePath =>
    inspectLegacyStatePath(join(legacyStateRoot, '.pan', statePath.slice(0, -1)), completedAtMs),
  ));
  return inspections.reduce<LegacyStatePathInspection>((result, inspection) => ({
    postMigrationWrites: [...result.postMigrationWrites, ...inspection.postMigrationWrites],
    inertDirectories: [...result.inertDirectories, ...inspection.inertDirectories],
    staleFiles: [...result.staleFiles, ...inspection.staleFiles],
  }), { postMigrationWrites: [], inertDirectories: [], staleFiles: [] });
}

export async function findRecreatedLegacyStatePaths(project: ProjectConfig): Promise<string[]> {
  return (await inspectLegacyStatePaths(project)).postMigrationWrites;
}

export async function resolveStateHome(project: ProjectConfig, options: StateHomeOptions = {}): Promise<StateHome> {
  const legacy = resolveInfraRepo(project);
  const migration = await inspectStateMigration(project, options);
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
  if (readMigrationCompleteMarker(markerPath)) return { root: worktreePath, migrated: true };
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

async function addStateWorktree(repoPath: string, path: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  const localBranchExists = await git(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${STATE_BRANCH}`], signal)
    .then(() => true)
    .catch(() => {
      signal?.throwIfAborted();
      return false;
    });
  const args = localBranchExists
    ? ['worktree', 'add', path, STATE_BRANCH]
    : ['worktree', 'add', '--track', '-b', STATE_BRANCH, path, `origin/${STATE_BRANCH}`];
  await git(repoPath, args, signal);
}

export async function ensureStateWorktree(
  project: ProjectConfig,
  options: StateHomeOptions = {},
): Promise<StateWorktreeStatus> {
  const migration = await inspectStateMigration(project, options);
  const path = stateWorktreePath(project, options);
  if (!migration.migrated) {
    const detail = migration.remoteCheckFailed
      ? 'The remote overdeck-state marker check failed transiently and no valid cached or local marker was available.'
      : 'The remote overdeck-state branch is reachable but does not contain a valid migration marker.';
    return { status: 'legacy', path, detail };
  }

  const { repoPath } = resolveInfraRepo(project);
  if (!existsSync(path)) {
    await addStateWorktree(repoPath, path, options.signal);
    return { status: 'created', path };
  }

  let branch: string;
  try {
    branch = await git(path, ['branch', '--show-current'], options.signal);
  } catch (error) {
    options.signal?.throwIfAborted();
    return { status: 'error', path, detail: error instanceof Error ? error.message : String(error) };
  }
  if (branch === STATE_BRANCH) return { status: 'healthy', path };

  try {
    const dirty = await git(path, ['status', '--porcelain'], options.signal);
    if (dirty) return { status: 'dirty', path, detail: 'state worktree has uncommitted changes; refusing destructive repair' };
    await git(repoPath, ['worktree', 'remove', path], options.signal);
    await rm(path, { recursive: true, force: true });
    await addStateWorktree(repoPath, path, options.signal);
    return { status: 'recreated', path };
  } catch (error) {
    options.signal?.throwIfAborted();
    return { status: 'error', path, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function clearStateMigrationCache(): void {
  migrationCache.clear();
}
