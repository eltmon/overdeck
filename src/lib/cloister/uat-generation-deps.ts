/**
 * Real git + store wiring for the UAT generation engine (PAN-1737).
 *
 * Generation worktrees are PERSISTENT under `<projectRoot>/workspaces/` — the
 * live UAT stack serves from them, and the deterministic daily folder name yields the Traefik
 * host (`uat-<label>-<codename>-<mmdd>.overdeck.localhost`) via the standard
 * FEATURE_FOLDER devcontainer template.
 *
 * Pure I/O — exercised live; the orchestrator (uat-generation-engine.ts) holds
 * the tested logic.
 */
import { execFile } from 'child_process';
import { rm } from 'fs/promises';
import { isAbsolute, relative, resolve } from 'path';
import { promisify } from 'util';
import {
  insertUatGenerationSync,
  listUatGenerationNamesSync,
  listUatGenerationsSync,
  updateUatGenerationSync,
} from '../overdeck/merge-sync.js';
import type { GenerationGitDeps, GenerationStorePort } from './uat-generation-engine.js';
import type { PolyrepoRepoGit } from './uat-polyrepo-engine.js';
import type { ResolvedProjectRepo } from '../project-repos.js';

const execFileAsync = promisify(execFile);

const runGit = (args: string[], cwd: string) =>
  execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });

/**
 * Validate a branch name against its expected namespace.
 *
 * `feature` accepts a CONFIGURED prefix, not a hardcoded `feature/`: a member
 * repo may set `branch_prefix: feat/`, and rejecting that made every one of its
 * contributions throw and get held out. The character class is unchanged, so
 * shell metacharacters and path traversal are still refused.
 */
export function safeBranchName(
  branchName: string,
  prefix: 'feature' | 'uat',
  featurePrefix = 'feature/',
): string {
  const namespace = prefix === 'uat' ? 'uat/' : featurePrefix;
  const escaped = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}[A-Za-z0-9][A-Za-z0-9._-]*$`);
  if (!pattern.test(branchName)) {
    throw new Error(`unsafe ${prefix} branch name: ${branchName}`);
  }
  return branchName;
}

export function safeGenerationWorktreePath(projectRoot: string, worktreePath: string): string {
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

export interface UatGenerationGitDepsOptions {
  /**
   * Root whose `workspaces/` directory may hold the worktree. Defaults to
   * `projectRoot`. A polyrepo member repo runs git in its own git root but
   * places its worktree under the WRAPPER project's `workspaces/`, so the two
   * roots differ and the path check has to be told which one governs.
   */
  workspacesRoot?: string;
  /** Branch the generation is cut from and merged back into. Defaults to `main`. */
  targetBranch?: string;
  /**
   * Namespace this repo's FEATURE branches live in, e.g. `feat/`. Defaults to
   * `feature/`. Comes from the repo's configured `branch_prefix`; a mismatch
   * makes every contribution fail validation and get held out.
   */
  featureBranchPrefix?: string;
}

/**
 * Git deps for one assembly run. The worktree path is bound on createWorktree
 * and reused by the merge/push operations that follow.
 */
export function buildUatGenerationGitDeps(
  projectRoot: string,
  options: UatGenerationGitDepsOptions = {},
): GenerationGitDeps {
  let worktreePath = '';
  const workspacesRoot = options.workspacesRoot ?? projectRoot;
  const targetBranch = options.targetBranch ?? 'main';
  const originTarget = `origin/${targetBranch}`;
  const featurePrefix = options.featureBranchPrefix ?? 'feature/';

  return {
    fetchMain: async () => {
      await runGit(['fetch', 'origin', targetBranch], projectRoot);
      const { stdout } = await runGit(['rev-parse', originTarget], projectRoot);
      return stdout.trim();
    },

    createWorktree: async (branchName, path) => {
      const safeBranch = safeBranchName(branchName, 'uat');
      worktreePath = safeGenerationWorktreePath(workspacesRoot, path);
      // A leftover worktree at this path means a previous assembly of the SAME
      // name crashed mid-build (names are collision-checked) — reclaim it.
      await runGit(['worktree', 'remove', '--force', worktreePath], projectRoot).catch(() => {});
      await runGit(['worktree', 'prune'], projectRoot).catch(() => {});
      await runGit(['worktree', 'add', '-B', safeBranch, worktreePath, originTarget], projectRoot);
    },

    branchHeadSha: async (branch) => {
      const safeBranch = safeBranchName(branch, 'feature', featurePrefix);
      const tryRef = async (ref: string) => (await runGit(['rev-parse', ref], projectRoot)).stdout.trim();
      return tryRef(`origin/${safeBranch}`).catch(() => tryRef(safeBranch));
    },

    isBranchContainedInMain: async (branch) => {
      const safeBranch = safeBranchName(branch, 'uat');
      const ref = await runGit(['rev-parse', '--verify', `origin/${safeBranch}`], projectRoot)
        .then(() => `origin/${safeBranch}`)
        .catch(() => safeBranch);
      return runGit(['merge-base', '--is-ancestor', ref, originTarget], projectRoot)
        .then(() => true)
        .catch(() => false);
    },

    mergeBranch: async (featureBranch) => {
      // Prefer the origin ref — feature branches are pushed by work agents and
      // the local ref may lag.
      const safeFeatureBranch = safeBranchName(featureBranch, 'feature', featurePrefix);
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

    /**
     * Flyway migrations tracked at a ref, for the union lint (PAN-3166). Reads
     * the ref rather than a worktree so a candidate can be linted before it is
     * merged.
     *
     * Feature branches resolve origin-first for the same reason mergeBranch
     * prefers it — work agents push, and the local ref may lag. The GENERATION
     * branch resolves locally only: its name is deterministic per day and
     * force-pushed, so `origin/uat/…` can still hold yesterday's tree while the
     * local ref is the one assembly just cut.
     */
    listMigrationFiles: async (ref) => {
      const safeRef = safeRefName(ref);
      const resolved = safeRef.startsWith('uat/')
        ? safeRef
        : await runGit(['rev-parse', '--verify', `origin/${safeRef}`], projectRoot)
            .then(() => `origin/${safeRef}`)
            .catch(() => safeRef);
      const { stdout } = await runGit(['ls-tree', '-r', '--name-only', resolved], projectRoot);
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((path) => /(^|\/)V\d[\w.]*__.+\.sql$/i.test(path));
    },

    /** One migration's SQL at a ref, so the lint can see what it touches. */
    readMigrationFile: async (ref, path) => {
      const safeRef = safeRefName(ref);
      const resolved = safeRef.startsWith('uat/')
        ? safeRef
        : await runGit(['rev-parse', '--verify', `origin/${safeRef}`], projectRoot)
            .then(() => `origin/${safeRef}`)
            .catch(() => safeRef);
      const { stdout } = await runGit(['show', `${resolved}:${safeRepoPath(path)}`], projectRoot);
      return stdout;
    },

    /**
     * Renumber migrations on the generation branch and commit. `git mv` keeps
     * the rename visible in history, and the commit lands on the branch that
     * promotes to main — so what the operator UATs is exactly what ships.
     */
    renameMigrations: async (renames, message) => {
      if (!worktreePath) throw new Error('renameMigrations before createWorktree');
      for (const { from, to } of renames) {
        await runGit(['mv', safeRepoPath(from), safeRepoPath(to)], worktreePath);
      }
      await runGit(['commit', '--no-verify', '-m', message], worktreePath);
      const { stdout } = await runGit(['rev-parse', 'HEAD'], worktreePath);
      return stdout.trim();
    },
  };
}

/**
 * A repo-relative path safe to hand to git: no leading dash (git would read it
 * as a flag), no absolute path, no traversal out of the repo.
 */
function safeRepoPath(path: string): string {
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(path) || path.includes('..')) {
    throw new Error(`unsafe repo path: ${path}`);
  }
  return path;
}

/**
 * A ref safe to pass as a git argument: no leading dash (which git would read
 * as a flag), no path traversal, no shell metacharacters. Accepts both `uat/…`
 * and any configured feature namespace, so the union lint can read either.
 */
function safeRefName(ref: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..')) {
    throw new Error(`unsafe git ref: ${ref}`);
  }
  return ref;
}

/**
 * The namespace part of a configured source branch: `feat/min-1` -> `feat/`.
 *
 * Exported because EVERY construction of the feature-branch adapter must use
 * the same namespace — assembly and the reconciler's anchor path both build one,
 * and a mismatch makes the reconciler reject a branch assembly just accepted.
 */
export function featureNamespaceOf(sourceBranch: string): string {
  const slash = sourceBranch.lastIndexOf('/');
  return slash >= 0 ? sourceBranch.slice(0, slash + 1) : 'feature/';
}

/**
 * Per-repo git deps for a polyrepo assembly, keyed by repoKey (PAN-3093).
 * Each repo runs git in its own root but writes its worktree under the wrapper
 * project's `workspaces/`, and cuts from its own configured target branch.
 */
export function buildPolyrepoGitDeps(
  repos: readonly ResolvedProjectRepo[],
  /** Containment-only callers include read-only repos recorded on old generations. */
  options: { includeReadOnly?: boolean } = {},
): Map<string, PolyrepoRepoGit> {
  return new Map(
    repos
      // A repo configured `readonly: true` (required === false) is never a
      // write target. Assembly uses the default filter; terminal containment
      // opts in because historical generations can record read-only repos.
      .filter((repo) => repo.required || options.includeReadOnly)
      .map((repo) => {
        let worktreePath = '';
        let generationBranch = '';
        const base = buildUatGenerationGitDeps(repo.repoPath, {
          workspacesRoot: repo.projectPath,
          targetBranch: repo.targetBranch,
          // From this repo's own configured branch_prefix.
          featureBranchPrefix: featureNamespaceOf(repo.sourceBranch),
        });

        const git: PolyrepoRepoGit = {
          ...base,
          createWorktree: async (branchName, path) => {
            await base.createWorktree(branchName, path);
            generationBranch = safeBranchName(branchName, 'uat');
            worktreePath = safeGenerationWorktreePath(repo.projectPath, path);
          },
          generationHeadSha: async () =>
            (await runGit(['rev-parse', 'HEAD'], worktreePath)).stdout.trim(),
          /**
           * Undo the merges applied since `sha` by re-pointing the generation
           * branch at it. `git reset --hard` is forbidden repo-wide, and
           * `checkout -B` reaches the same state: the branch moves, the
           * worktree follows, and nothing outside this throwaway branch moves.
           */
          resetGenerationTo: async (sha) => {
            if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`unsafe rollback sha: ${sha}`);
            if (!generationBranch) throw new Error('rollback before createWorktree');
            await runGit(['checkout', '-B', generationBranch, sha], worktreePath);
          },
        };
        return [repo.repoKey, git] as const;
      }),
  );
}

/**
 * Union of uat/* branches across every member repo. A generation name collides
 * if ANY member repo already has it, since the name is shared across repos.
 */
export async function listRemoteUatBranchesMulti(
  repos: readonly ResolvedProjectRepo[],
): Promise<string[]> {
  const perRepo = await Promise.all(repos.map((repo) => listRemoteUatBranches(repo.repoPath)));
  return [...new Set(perRepo.flat())];
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

/**
 * Polyrepo cleanup deps (PAN-3093). Each member repo owns its own worktree and
 * branch, and the wrapper folder holds them all.
 *
 * `removeGenerationResidue` also deletes the generation branch from EVERY
 * configured member repo, not just the ones the generation recorded: a global
 * hold-out can drop a repo after its branch was already created locally. That
 * branch is never pushed, but it would linger. Deleting a branch that does not
 * exist is a no-op, so the sweep is safe.
 */
export function buildPolyrepoCleanupGit(
  repos: readonly ResolvedProjectRepo[],
  projectPath: string,
): {
  removeWorktree(worktreePath: string): Promise<void>;
  deleteBranch(branchName: string): Promise<void>;
  removeRepoArtifacts(repo: { repoKey: string; repoPath: string; branch: string; worktreePath: string }): Promise<void>;
  removeGenerationResidue(
    generation: { name: string; worktreePath: string },
    recordedRepoKeys?: readonly string[],
  ): Promise<void>;
} {
  // Cleanup deletes branches locally AND on the remote, so a read-only repo must
  // be excluded here for the same reason it is excluded from assembly.
  const writable = repos.filter((repo) => repo.required);
  const byKey = new Map(writable.map((r) => [r.repoKey, r]));

  const deleteBranchIn = async (repoPath: string, branchName: string) => {
    const safeBranch = safeBranchName(branchName, 'uat');
    await runGit(['branch', '-D', safeBranch], repoPath).catch(() => {});
    await runGit(['push', 'origin', '--delete', safeBranch], repoPath).catch(() => {});
  };

  return {
    // Unused on the polyrepo path (removeRepoArtifacts supersedes them) but the
    // deps contract still requires them.
    removeWorktree: async () => {},
    deleteBranch: async () => {},

    removeRepoArtifacts: async (repo) => {
      // Unknown key here means the repo is not in the writable set — refuse
      // rather than fall back to the caller-supplied path.
      const configured = byKey.get(repo.repoKey);
      if (!configured) {
        throw new Error(`[uat-cleanup] refusing to mutate non-writable or unknown repo: ${repo.repoKey}`);
      }
      const repoPath = configured.repoPath;
      const safePath = safeGenerationWorktreePath(projectPath, repo.worktreePath);
      await runGit(['worktree', 'remove', '--force', safePath], repoPath).catch(() => {});
      await runGit(['worktree', 'prune'], repoPath).catch(() => {});
      await deleteBranchIn(repoPath, repo.branch);
    },

    removeGenerationResidue: async (generation, recordedRepoKeys = []) => {
      // Only repos the generation did NOT record: removeRepoArtifacts already
      // deleted the branch for every recorded repo, and repeating it costs a
      // full remote handshake per repo before its expected failure.
      const recorded = new Set(recordedRepoKeys);
      for (const repo of writable) {
        if (recorded.has(repo.repoKey)) continue;
        await deleteBranchIn(repo.repoPath, generation.name);
        await runGit(['worktree', 'prune'], repo.repoPath).catch(() => {});
      }
      // Validate before deleting: this is a recursive removal, and the check
      // refuses anything outside <projectPath>/workspaces.
      const safeFolder = safeGenerationWorktreePath(projectPath, generation.worktreePath);
      await rm(safeFolder, { recursive: true, force: true });
    },
  };
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
