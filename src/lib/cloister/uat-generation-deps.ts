/**
 * Real git + store wiring for the UAT generation engine (PAN-1737).
 *
 * Unlike the PAN-1691 candidate session (tmpdir worktree, removed after push),
 * generation worktrees are PERSISTENT under `<projectRoot>/workspaces/` — the
 * live UAT stack serves from them, and the folder name yields the Traefik
 * host (`uat-<label>-<codename>-<mmdd>.pan.localhost`) via the standard
 * FEATURE_FOLDER devcontainer template.
 *
 * Pure I/O — exercised live; the orchestrator (uat-generation-engine.ts) holds
 * the tested logic.
 */
import { promisify } from 'util';
import { exec } from 'child_process';
import {
  insertUatGenerationSync,
  listUatGenerationNamesSync,
  listUatGenerationsSync,
  updateUatGenerationSync,
} from '../database/uat-generations-db.js';
import type { GenerationGitDeps, GenerationStorePort } from './uat-generation-engine.js';

const execAsync = promisify(exec);

const run = (cmd: string, cwd: string) =>
  execAsync(cmd, { cwd, maxBuffer: 16 * 1024 * 1024 });

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
      await run('git fetch origin main', projectRoot);
      const { stdout } = await run('git rev-parse origin/main', projectRoot);
      return stdout.trim();
    },

    createWorktree: async (branchName, path) => {
      worktreePath = path;
      // A leftover worktree at this path means a previous assembly of the SAME
      // name crashed mid-build (names are collision-checked) — reclaim it.
      await run(`git worktree remove "${path}" --force`, projectRoot).catch(() => {});
      await run('git worktree prune', projectRoot).catch(() => {});
      await run(`git worktree add -B "${branchName}" "${path}" origin/main`, projectRoot);
    },

    branchHeadSha: async (branch) => {
      const tryRef = async (ref: string) => (await run(`git rev-parse "${ref}"`, projectRoot)).stdout.trim();
      return tryRef(`origin/${branch}`).catch(() => tryRef(branch));
    },

    mergeBranch: async (featureBranch) => {
      // Prefer the origin ref — feature branches are pushed by work agents and
      // the local ref may lag.
      const ref = await run(`git rev-parse --verify "origin/${featureBranch}"`, worktreePath)
        .then(() => `origin/${featureBranch}`)
        .catch(() => featureBranch);
      try {
        await run(`git merge --no-edit "${ref}"`, worktreePath);
        return { ok: true as const };
      } catch (err) {
        const { stdout } = await run('git ls-files -u', worktreePath).catch(() => ({ stdout: '' }));
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
      await run('git merge --abort', worktreePath).catch(() => {});
    },

    push: async (branchName) => {
      await run(`git push -u origin "${branchName}"`, worktreePath);
    },
  };
}

/** Branch names currently present on origin under uat/* — naming collision input. */
export async function listRemoteUatBranches(projectRoot: string): Promise<string[]> {
  const { stdout } = await run("git ls-remote --heads origin 'uat/*'", projectRoot).catch(() => ({ stdout: '' }));
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
      await run(`git worktree remove "${path}" --force`, projectRoot).catch(() => {});
      await run('git worktree prune', projectRoot).catch(() => {});
    },
    deleteBranch: async (branchName) => {
      await run(`git branch -D "${branchName}"`, projectRoot).catch(() => {});
      await run(`git push origin --delete "${branchName}"`, projectRoot).catch(() => {});
    },
  };
}
