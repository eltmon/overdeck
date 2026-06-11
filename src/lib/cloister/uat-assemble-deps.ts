/**
 * Real git wiring for UAT candidate assembly (PAN-1691). Lazy-loaded; only runs
 * when an operator clicks "Assemble UAT candidate". Creates a disposable git
 * worktree on the candidate branch off origin/main, merges each feature branch
 * onto it, pushes the candidate, and removes the worktree (the branch persists).
 *
 * Pure I/O — exercised only live — so not unit-tested; the orchestrator
 * (assembleUatCandidate) and the naming/queue logic it feeds are.
 */
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import type { UatAssembleDeps } from './uat-assemble.js';

const execAsync = promisify(exec);

export interface UatAssembleSession {
  deps: UatAssembleDeps;
  /** Push the assembled candidate branch to origin. */
  push: () => Promise<void>;
  /** Remove the temporary worktree (the branch + remote ref remain). */
  cleanup: () => Promise<void>;
}

export function buildUatAssembleSession(projectPath: string): UatAssembleSession {
  let worktreePath = '';
  let branch = '';
  const run = (cmd: string, cwd: string) => execAsync(cmd, { cwd, maxBuffer: 16 * 1024 * 1024 });

  return {
    deps: {
      createCandidateBranch: async (name) => {
        branch = name;
        // Stable worktree path (no pid) so a prior assembly of the same per-day
        // candidate is cleaned up here rather than colliding.
        worktreePath = join(tmpdir(), `uat-${name.replace(/[^a-z0-9]/gi, '-')}`);
        await run('git fetch origin main', projectPath);
        // Idempotent re-assembly: drop any leftover worktree, then -B force-resets
        // the candidate branch onto current origin/main so re-running rebuilds the
        // SAME branch from the current bundle instead of creating a new one.
        await run(`git worktree remove "${worktreePath}" --force`, projectPath).catch(() => {});
        await run('git worktree prune', projectPath).catch(() => {});
        await run(`git worktree add -B ${name} "${worktreePath}" origin/main`, projectPath);
      },
      mergeBranch: async (featureBranch) => {
        try {
          await run(`git merge --no-edit ${featureBranch}`, worktreePath);
          return { ok: true };
        } catch (e) {
          await run('git merge --abort', worktreePath).catch(() => {});
          return { ok: false, reason: e instanceof Error ? e.message.split('\n')[0] : String(e) };
        }
      },
    },
    push: async () => {
      // Force-push: the candidate branch is force-reset onto current main each
      // assembly, so its history is intentionally rewritten. It is a throwaway
      // uat/* branch, never main.
      if (branch && worktreePath) await run(`git push -f -u origin ${branch}`, worktreePath);
    },
    cleanup: async () => {
      if (worktreePath) await run(`git worktree remove "${worktreePath}" --force`, projectPath).catch(() => {});
      await run('git worktree prune', projectPath).catch(() => {});
    },
  };
}
