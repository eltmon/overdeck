/**
 * PAN-382: Inspection checkpoint system.
 *
 * Tracks commit SHAs where inspections passed. The active inspection diff is
 * scoped to the parent of HEAD because the work role contract is one bead per
 * commit; checkpoints remain the durable record after a pass.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { resolveWorkspaceRepoRootsSync, type WorkspaceRepoRoot } from '../project-repos.js';
import { snapshotWorkspaceHeadsPromise } from '../git-utils.js';

const execAsync = promisify(exec);

const OVERDECK_HOME = join(homedir(), '.overdeck');

export interface InspectCheckpoint {
  itemId: string;
  commitSha: string;
  passedAt: string; // ISO 8601
}

export interface InspectCheckpointFile {
  issueId: string;
  checkpoints: InspectCheckpoint[];
}

/**
 * Get the directory for a project's inspect checkpoints.
 */
function getCheckpointDir(projectKey: string): string {
  return join(OVERDECK_HOME, 'specialists', projectKey, 'inspect-agent', 'checkpoints');
}

/**
 * Get the checkpoint file path for an issue.
 */
function getCheckpointPath(projectKey: string, issueId: string): string {
  return join(getCheckpointDir(projectKey), `${issueId.toUpperCase()}.json`);
}

/**
 * Load checkpoints for an issue. Returns null if no checkpoints exist.
 */
export function loadCheckpoints(projectKey: string, issueId: string): InspectCheckpointFile | null {
  const filePath = getCheckpointPath(projectKey, issueId);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Get the last checkpoint for an issue, or null if none exist.
 */
export function getLastCheckpoint(projectKey: string, issueId: string): InspectCheckpoint | null {
  const data = loadCheckpoints(projectKey, issueId);
  if (!data || data.checkpoints.length === 0) return null;
  return data.checkpoints[data.checkpoints.length - 1];
}

/**
 * Save a new checkpoint after a successful inspection.
 */
export function saveCheckpoint(
  projectKey: string,
  issueId: string,
  itemId: string,
  commitSha: string
): InspectCheckpoint {
  const dir = getCheckpointDir(projectKey);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const data = loadCheckpoints(projectKey, issueId) || {
    issueId: issueId.toUpperCase(),
    checkpoints: [],
  };

  const checkpoint: InspectCheckpoint = {
    itemId,
    commitSha,
    passedAt: new Date().toISOString(),
  };

  data.checkpoints.push(checkpoint);
  writeFileSync(getCheckpointPath(projectKey, issueId), JSON.stringify(data, null, 2));

  return checkpoint;
}

export interface InspectDiffRepo {
  repoKey: string;
  dir: string;
  headSha: string;
  diffBase: string;
}

export interface InspectDiffContext {
  currentHead: string;
  checkpoint: string;
  diffStats: string;
  diffCommand: string;
  repos: InspectDiffRepo[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseCompositeSnapshot(snapshot: string | undefined): Map<string, string> {
  const heads = new Map<string, string>();
  if (!snapshot) return heads;
  for (const token of snapshot.split(/\s+/)) {
    const separator = token.lastIndexOf('@');
    if (separator <= 0 || separator === token.length - 1) continue;
    heads.set(token.slice(0, separator), token.slice(separator + 1));
  }
  return heads;
}

async function readHead(root: WorkspaceRepoRoot): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', {
      cwd: root.dir,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function resolveTargetBase(root: WorkspaceRepoRoot): Promise<string> {
  for (const target of [`origin/${root.targetBranch}`, root.targetBranch]) {
    try {
      const { stdout } = await execAsync(`git merge-base ${shellQuote(target)} HEAD`, {
        cwd: root.dir,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      const base = stdout.trim();
      if (base) return base;
    } catch { /* try the next target */ }
  }
  try {
    const { stdout } = await execAsync('git rev-parse HEAD^', {
      cwd: root.dir,
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return stdout.trim();
  } catch {
    return root.targetBranch;
  }
}

/**
 * Resolve the per-item inspection diff across the actual workspace repositories.
 * Polyrepo checkpoints store composite `repo@sha` snapshots so unchanged repos
 * are omitted instead of reviewing their previous, unrelated commit.
 */
async function getInspectDiffContextPromise(
  projectKey: string,
  issueId: string,
  workspacePath: string,
): Promise<InspectDiffContext> {
  const roots = resolveWorkspaceRepoRootsSync(issueId, workspacePath);
  const isPolyrepo = roots.some(root => root.isPolyrepo);
  const previousHeads = isPolyrepo
    ? parseCompositeSnapshot(getLastCheckpoint(projectKey, issueId)?.commitSha)
    : new Map<string, string>();
  const repos: InspectDiffRepo[] = [];

  for (const root of roots) {
    const headSha = await readHead(root);
    if (!headSha) continue;

    let diffBase: string;
    if (isPolyrepo) {
      const previousHead = previousHeads.get(root.repoKey);
      if (previousHead === headSha) continue;
      diffBase = previousHead ?? await resolveTargetBase(root);
      if (diffBase === headSha) continue;
    } else {
      try {
        const { stdout } = await execAsync('git rev-parse HEAD^', {
          cwd: root.dir,
          encoding: 'utf-8',
          timeout: 10_000,
        });
        diffBase = stdout.trim();
      } catch {
        diffBase = root.targetBranch;
      }
    }

    repos.push({ repoKey: root.repoKey, dir: root.dir, headSha, diffBase });
  }

  const statSections: string[] = [];
  const commands: string[] = [];
  for (const repo of repos) {
    let stat = 'Unable to compute diff stats';
    try {
      const { stdout } = await execAsync(`git diff --stat ${shellQuote(repo.diffBase)}...HEAD`, {
        cwd: repo.dir,
        encoding: 'utf-8',
        timeout: 15_000,
      });
      stat = stdout.trim() || 'No changes detected';
    } catch { /* retain the human-readable fallback */ }

    statSections.push(isPolyrepo ? `── ${repo.repoKey} ──\n${stat}` : stat);
    commands.push(
      `${isPolyrepo ? `printf '\\n── ${repo.repoKey} ──\\n'\n` : ''}` +
      `git -C ${shellQuote(repo.dir)} diff ${shellQuote(repo.diffBase)}...HEAD`,
    );
  }

  const currentHead = await snapshotWorkspaceHeadsPromise(issueId, workspacePath) ?? 'unknown';
  return {
    currentHead,
    checkpoint: repos.length > 0
      ? repos.map(repo => isPolyrepo ? `${repo.repoKey}@${repo.diffBase.slice(0, 8)}` : repo.diffBase).join(' ')
      : currentHead,
    diffStats: statSections.join('\n') || 'No changes detected across workspace repositories',
    diffCommand: commands.join('\n') || `printf '%s\\n' 'No changes detected across workspace repositories'`,
    repos,
  };
}

export function getInspectDiffContext(
  projectKey: string,
  issueId: string,
  workspacePath: string,
): Effect.Effect<InspectDiffContext> {
  return Effect.promise(() => getInspectDiffContextPromise(projectKey, issueId, workspacePath));
}

/** Resolve the code HEAD(s), never the polyrepo wrapper commit. */
export function getCurrentHead(issueId: string, workspacePath: string): Effect.Effect<string> {
  return Effect.promise(async () =>
    await snapshotWorkspaceHeadsPromise(issueId, workspacePath) ?? 'unknown'
  );
}
