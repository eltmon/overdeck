/**
 * Git info enricher (PAN-1523)
 *
 * Derives branch + worktree-status for an absolute filesystem path. Used to
 * surface branch/worktree chips on conversation rows, conversation terminals,
 * and agent terminals.
 *
 * Two enricher entrypoints with different semantics:
 *   - resolveConversationGitInfo() — best-effort: returns null branch when
 *     the path isn't a git repo. Used for conversations whose cwd can be
 *     anywhere.
 *   - resolveAgentGitInfo() — verifies a work-agent workspace against its
 *     expected feature branch. Reports drift and missing-workspace state
 *     because both are silent failure modes today.
 *
 * Cache: in-memory, 30s TTL, keyed by absolute path. Cache entries are
 * invalidated when the mtime of <path>/.git/HEAD changes, so a checkout
 * under a live conversation is picked up on the next list call without
 * waiting for TTL.
 *
 * All I/O is async (execFile / fs.promises). No execSync, no readFileSync.
 */

import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const GIT_INFO_TTL_MS = 30_000;
const GIT_INFO_TIMEOUT_MS = 2_000;

export interface ConversationGitInfo {
  /** Current branch (HEAD), null if cwd is not a git repo. */
  branch: string | null;
  /** True when cwd points at a secondary git worktree (not the primary checkout). */
  isWorktree: boolean;
}

export interface AgentGitInfo {
  /** Current branch (HEAD), null if the workspace path is missing or not a git repo. */
  actualBranch: string | null;
  /** True when actualBranch differs from the expected feature branch. */
  branchDrifted: boolean;
  /** True when the workspacePath does not exist on disk, or is no longer a git worktree. */
  workspaceMissing: boolean;
}

interface CacheEntry {
  value: ConversationGitInfo;
  expiresAt: number;
  headMtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Locate the HEAD file for a working tree at `absPath`.
 *
 * In a primary checkout `.git` is a directory and HEAD lives at `.git/HEAD`.
 * In a secondary worktree `.git` is a small text file containing
 * `gitdir: /abs/path/to/.git/worktrees/<name>` and HEAD lives at
 * `<that-gitdir>/HEAD`. We follow the pointer so the mtime check actually
 * sees branch flips in worktrees.
 */
async function locateHeadPath(absPath: string): Promise<string | null> {
  const gitMarker = join(absPath, '.git');
  let markerStat;
  try {
    markerStat = await stat(gitMarker);
  } catch {
    return null;
  }

  if (markerStat.isDirectory()) {
    return join(gitMarker, 'HEAD');
  }

  if (markerStat.isFile()) {
    try {
      const contents = await readFile(gitMarker, 'utf-8');
      const match = contents.match(/^gitdir:\s*(.+)$/m);
      if (!match) return null;
      return join(match[1].trim(), 'HEAD');
    } catch {
      return null;
    }
  }

  return null;
}

async function readHeadMtimeMs(absPath: string): Promise<number | null> {
  const headPath = await locateHeadPath(absPath);
  if (headPath === null) return null;
  try {
    const stats = await stat(headPath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}

async function readGitInfoFresh(absPath: string): Promise<ConversationGitInfo> {
  const [branchResult, worktreeResult] = await Promise.all([
    execFileAsync('git', ['-C', absPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf-8',
      timeout: GIT_INFO_TIMEOUT_MS,
    }).catch(() => null),
    execFileAsync('git', ['-C', absPath, 'rev-parse', '--git-common-dir', '--git-dir'], {
      encoding: 'utf-8',
      timeout: GIT_INFO_TIMEOUT_MS,
    }).catch(() => null),
  ]);

  if (!branchResult) {
    return { branch: null, isWorktree: false };
  }

  const branch = branchResult.stdout.trim() || null;

  // A secondary worktree has `git-dir` !== `git-common-dir` (worktree-specific
  // dir lives at <primary>/.git/worktrees/<name>; common dir is <primary>/.git).
  // The primary checkout has them equal.
  let isWorktree = false;
  if (worktreeResult) {
    const [commonDir, gitDir] = worktreeResult.stdout.trim().split('\n').map((line) => line.trim());
    if (commonDir && gitDir && commonDir !== gitDir) {
      isWorktree = true;
    }
  }

  return { branch, isWorktree };
}

/**
 * Resolve branch + worktree status for a conversation cwd. Cached for
 * GIT_INFO_TTL_MS, invalidated on HEAD mtime change.
 */
export async function resolveConversationGitInfo(absPath: string): Promise<ConversationGitInfo> {
  const now = Date.now();
  const headMtimeMs = await readHeadMtimeMs(absPath);
  if (headMtimeMs === null) {
    return { branch: null, isWorktree: false };
  }

  const cached = cache.get(absPath);
  if (cached && cached.expiresAt > now && cached.headMtimeMs === headMtimeMs) {
    return cached.value;
  }

  const value = await readGitInfoFresh(absPath);
  cache.set(absPath, {
    value,
    expiresAt: now + GIT_INFO_TTL_MS,
    headMtimeMs,
  });
  return value;
}

/**
 * Resolve drift + missing-workspace state for a work-agent workspace.
 * `expectedBranch` is the deterministic feature/<issue-id> branch from
 * resource-discovery. Reuses the conversation cache for the branch read,
 * then layers drift detection on top.
 */
export async function resolveAgentGitInfo(
  workspacePath: string,
  expectedBranch: string,
): Promise<AgentGitInfo> {
  const headMtimeMs = await readHeadMtimeMs(workspacePath);
  if (headMtimeMs === null) {
    return {
      actualBranch: null,
      branchDrifted: false,
      workspaceMissing: true,
    };
  }

  const info = await resolveConversationGitInfo(workspacePath);
  if (info.branch === null) {
    // .git/HEAD exists but rev-parse failed — corrupt or stale worktree.
    return {
      actualBranch: null,
      branchDrifted: false,
      workspaceMissing: true,
    };
  }

  return {
    actualBranch: info.branch,
    branchDrifted: info.branch !== expectedBranch,
    workspaceMissing: false,
  };
}

/** Test-only: reset the cache between unit tests. */
export function _resetGitInfoCacheForTests(): void {
  cache.clear();
}
