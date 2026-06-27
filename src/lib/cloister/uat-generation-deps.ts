/**
 * Real git + store wiring for the UAT generation engine (PAN-1737).
 *
 * Generation worktrees are PERSISTENT under `<projectRoot>/workspaces/` — the
 * live UAT stack serves from them, and the deterministic daily folder name yields the Traefik
 * host (`uat-<label>-<codename>-<mmdd>.pan.localhost`) via the standard
 * FEATURE_FOLDER devcontainer template.
 *
 * Pure I/O — exercised live; the orchestrator (uat-generation-engine.ts) holds
 * the tested logic.
 */
import { execFile } from 'child_process';
import { isAbsolute, relative, resolve } from 'path';
import { promisify } from 'util';
import {
  insertUatGenerationSync,
  listUatGenerationNamesSync,
  listUatGenerationsSync,
  updateUatGenerationSync,
} from '../overdeck/merge-sync.js';
import type { GenerationGitDeps, GenerationStorePort } from './uat-generation-engine.js';

const execFileAsync = promisify(execFile);

const runGit = (args: string[], cwd: string) =>
  execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });

function safeBranchName(branchName: string, prefix: 'feature' | 'uat'): string {
  const pattern = prefix === 'feature'
    ? /^feature\/[A-Za-z0-9][A-Za-z0-9._-]*$/
    : /^uat\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
  if (!pattern.test(branchName)) {
    throw new Error(`unsafe ${prefix} branch name: ${branchName}`);
  }
  return branchName;
}

function safeGenerationWorktreePath(projectRoot: string, worktreePath: string): string {
  const workspacesRoot = resolve(projectRoot, 'workspaces');
  const target = resolve(worktreePath);
  const rel = relative(workspacesRoot, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`unsafe UAT worktree path outside project workspaces: ${worktreePath}`);
  }
  return target;
}

/** Store port backed by uat-generations-db. */
export function buildUatGenerationStore(): GenerationStorePort {
  return {
    insert: (gen) => { insertUatGenerationSync(gen); },
    update: (name, patch) => { updateUatGenerationSync(name, patch); },
    listNames: () => listUatGenerationNamesSync(),
    listChain: (projectRoot, statuses) =>
      listUatGenerationsSync({ projectRoot, ...(statuses ? { statuses } : {}) }),
  };
}

/**
 * Git deps for one assembly run. The worktree path is bound on createWorktree
 * and reused by the merge/push operations that follow.
 */
export function buildUatGenerationGitDeps(projectRoot: string): GenerationGitDeps {
  let worktreePath = '';

  return {
    fetchMain: async () => {
      await runGit(['fetch', 'origin', 'main'], projectRoot);
      const { stdout } = await runGit(['rev-parse', 'origin/main'], projectRoot);
      return stdout.trim();
    },

    createWorktree: async (branchName, path) => {
      const safeBranch = safeBranchName(branchName, 'uat');
      worktreePath = safeGenerationWorktreePath(projectRoot, path);
      // A leftover worktree at this path means a previous assembly of the SAME
      // name crashed mid-build (names are collision-checked) — reclaim it.
      await runGit(['worktree', 'remove', '--force', worktreePath], projectRoot).catch(() => {});
      await runGit(['worktree', 'prune'], projectRoot).catch(() => {});
      await runGit(['worktree', 'add', '-B', safeBranch, worktreePath, 'origin/main'], projectRoot);
    },

    branchHeadSha: async (branch) => {
      const safeBranch = safeBranchName(branch, 'feature');
      const tryRef = async (ref: string) => (await runGit(['rev-parse', ref], projectRoot)).stdout.trim();
      return tryRef(`origin/${safeBranch}`).catch(() => tryRef(safeBranch));
    },

    mergeBranch: async (featureBranch) => {
      // Prefer the origin ref — feature branches are pushed by work agents and
      // the local ref may lag.
      const safeFeatureBranch = safeBranchName(featureBranch, 'feature');
      const originRef = `origin/${safeFeatureBranch}`;
      const ref = await runGit(['rev-parse', '--verify', originRef], worktreePath)
        .then(() => originRef)
        .catch(() => safeFeatureBranch);
      try {
        await runGit(['merge', '--no-edit', ref], worktreePath);
        return { ok: true as const };
      } catch (err) {
        const { stdout } = await runGit(['ls-files', '-u'], worktreePath).catch(() => ({ stdout: '' }));
        const conflict = stdout.trim().length > 0;
        // Leave the worktree mid-conflict — the engine decides whether the
        // assembly agent gets a shot before aborting.
        return {
          ok: false as const,
          conflict,
          reason: err instanceof Error ? (err.message.split('\n')[0] ?? 'merge failed') : String(err),
        };
      }
    },

    abortMerge: async () => {
      await runGit(['merge', '--abort'], worktreePath).catch(() => {});
    },

    push: async (branchName) => {
      await runGit(['push', '-u', '--force-with-lease', 'origin', safeBranchName(branchName, 'uat')], worktreePath);
    },
  };
}

/** Branch names currently present on origin under uat/* — naming collision input. */
export async function listRemoteUatBranches(projectRoot: string): Promise<string[]> {
  const { stdout } = await runGit(['ls-remote', '--heads', 'origin', 'uat/*'], projectRoot).catch(() => ({ stdout: '' }));
  return stdout
    .split('\n')
    .map((line) => line.split('\t')[1] ?? '')
    .filter((ref) => ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length));
}

/** Cleanup deps: remove a generation worktree and delete its branch everywhere. */
export function buildUatGenerationCleanupGit(projectRoot: string): {
  removeWorktree(worktreePath: string): Promise<void>;
  deleteBranch(branchName: string): Promise<void>;
} {
  return {
    removeWorktree: async (path) => {
      const safePath = safeGenerationWorktreePath(projectRoot, path);
      await runGit(['worktree', 'remove', '--force', safePath], projectRoot).catch(() => {});
      await runGit(['worktree', 'prune'], projectRoot).catch(() => {});
    },
    deleteBranch: async (branchName) => {
      const safeBranch = safeBranchName(branchName, 'uat');
      await runGit(['branch', '-D', safeBranch], projectRoot).catch(() => {});
      await runGit(['push', 'origin', '--delete', safeBranch], projectRoot).catch(() => {});
    },
  };
}
