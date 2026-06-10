/**
 * Batch promotion (PAN-1737: UAT batch trains) — "merge what you tested".
 *
 * Promoting a generation merges the uat/* branch itself into main (one no-ff
 * merge), so main receives EXACTLY the tree the operator exercised — including
 * the assembly agent's conflict resolutions. Per-feature PRs are marked merged
 * by GitHub automatically (their head commits become reachable from main), and
 * each member issue then flows through the standard per-issue post-merge
 * lifecycle exactly once, behind the PAN-328 in-flight guard.
 *
 * Hard precondition: the generation's baseSha must still equal origin/main —
 * promoting a stale tree would silently drop commits that landed since
 * assembly. Stale promotes are rejected with reassemble guidance (the
 * reconciler rebuilds automatically anyway).
 *
 * Pure orchestration with injected deps; real git in buildUatPromoteGitDeps.
 */
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import type { UatGeneration, UatGenerationStatus } from '../database/uat-generations-db.js';
import type { GenerationStorePort } from './uat-generation-engine.js';

const execAsync = promisify(exec);

export interface UatPromoteGitDeps {
  /** `git fetch origin main` and return the origin/main head SHA. */
  fetchMain(): Promise<string>;
  /**
   * Merge the generation branch into main with the given message (no-ff, in a
   * throwaway worktree — NEVER the primary checkout) and push. Returns the
   * merge commit SHA.
   */
  mergeIntoMain(branchName: string, message: string): Promise<string>;
}

export interface UatPromoteDeps {
  git: UatPromoteGitDeps;
  store: GenerationStorePort & { get(name: string): UatGeneration | null };
  teardownStack(generation: UatGeneration): Promise<void>;
  /**
   * Kick off the per-issue post-merge lifecycle (through the PAN-328 guard).
   * Returns false when a run for that issue is already in flight.
   */
  firePostMerge(issueId: string): boolean;
  log?: (msg: string) => void;
}

export type PromoteFailureReason = 'not-found' | 'wrong-status' | 'stale-base' | 'merge-failed';

export type PromoteResult =
  | {
      success: true;
      generation: string;
      mergeSha: string;
      members: string[];
      /** Members whose post-merge lifecycle started (false = already in flight). */
      postMergeStarted: string[];
      invalidated: string[];
    }
  | { success: false; reason: PromoteFailureReason; message: string };

const PROMOTABLE: readonly UatGenerationStatus[] = ['ready', 'superseded'];

export function buildPromoteMergeMessage(gen: UatGeneration): string {
  const ids = gen.members.map((m) => m.issueId).join(', ');
  const resolutionNote = gen.resolutions.length > 0
    ? `\n\nIncludes ${gen.resolutions.length} uat-assembly conflict resolution(s): ` +
      gen.resolutions.map((r) => r.issueIds.join(' <-> ')).join('; ')
    : '';
  return `Merge UAT batch ${gen.name} (${ids})${resolutionNote}`;
}

export async function promoteUatGeneration(
  name: string,
  projectRoot: string,
  deps: UatPromoteDeps,
): Promise<PromoteResult> {
  const log = deps.log ?? (() => {});

  const gen = deps.store.get(name);
  if (!gen || gen.projectRoot !== projectRoot) {
    return { success: false, reason: 'not-found', message: `No UAT generation named ${name}` };
  }
  if (!PROMOTABLE.includes(gen.status)) {
    return {
      success: false,
      reason: 'wrong-status',
      message: `${name} is ${gen.status} — only a ready or superseded batch can be merged to main`,
    };
  }

  const mainSha = await deps.git.fetchMain();
  if (gen.baseSha !== mainSha) {
    return {
      success: false,
      reason: 'stale-base',
      message:
        `${name} was assembled off ${gen.baseSha.slice(0, 9)} but main is now at ${mainSha.slice(0, 9)} — ` +
        `the tree you tested is stale. A fresh batch reassembles automatically; rebuild and re-test before merging.`,
    };
  }

  let mergeSha: string;
  try {
    mergeSha = await deps.git.mergeIntoMain(gen.name, buildPromoteMergeMessage(gen));
  } catch (err) {
    return {
      success: false,
      reason: 'merge-failed',
      message: err instanceof Error ? (err.message.split('\n')[0] ?? 'merge failed') : String(err),
    };
  }
  log(`[uat-promote] ${name}: merged to main at ${mergeSha.slice(0, 9)} (${gen.members.length} member(s))`);

  // The batch is on main: this generation is done, every other live
  // generation is stale by definition (main moved).
  deps.store.update(gen.name, { status: 'promoted' });
  await deps.teardownStack(gen).catch((err) => {
    log(`[uat-promote] ${name}: stack teardown failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const invalidated: string[] = [];
  for (const other of deps.store.listChain(projectRoot, ['ready', 'superseded'])) {
    if (other.name === gen.name) continue;
    deps.store.update(other.name, { status: 'invalidated' });
    invalidated.push(other.name);
    await deps.teardownStack(other).catch(() => {});
  }

  // Standard per-issue post-merge handoff, exactly once each (PAN-328 guard).
  const postMergeStarted: string[] = [];
  for (const member of gen.members) {
    if (deps.firePostMerge(member.issueId)) postMergeStarted.push(member.issueId);
    else log(`[uat-promote] ${name}: post-merge for ${member.issueId} already in flight — skipped`);
  }

  return {
    success: true,
    generation: gen.name,
    mergeSha,
    members: gen.members.map((m) => m.issueId),
    postMergeStarted,
    invalidated,
  };
}

/** Real git wiring: throwaway detached worktree off origin/main, no-ff merge, push. */
export function buildUatPromoteGitDeps(projectRoot: string): UatPromoteGitDeps {
  const run = (cmd: string, cwd: string) =>
    execAsync(cmd, { cwd, maxBuffer: 16 * 1024 * 1024 });

  return {
    fetchMain: async () => {
      await run('git fetch origin main', projectRoot);
      return (await run('git rev-parse origin/main', projectRoot)).stdout.trim();
    },
    mergeIntoMain: async (branchName, message) => {
      const worktreePath = join(tmpdir(), `uat-promote-${branchName.replace(/[^a-z0-9]/gi, '-')}`);
      await run(`git worktree remove "${worktreePath}" --force`, projectRoot).catch(() => {});
      await run('git worktree prune', projectRoot).catch(() => {});
      await run(`git worktree add --detach "${worktreePath}" origin/main`, projectRoot);
      try {
        const ref = await run(`git rev-parse --verify "origin/${branchName}"`, worktreePath)
          .then(() => `origin/${branchName}`)
          .catch(() => branchName);
        const escapedMessage = message.replace(/"/g, '\\"');
        await run(`git merge --no-ff "${ref}" -m "${escapedMessage}"`, worktreePath);
        await run('git push origin HEAD:main', worktreePath);
        return (await run('git rev-parse HEAD', worktreePath)).stdout.trim();
      } finally {
        await run(`git worktree remove "${worktreePath}" --force`, projectRoot).catch(() => {});
        await run('git worktree prune', projectRoot).catch(() => {});
      }
    },
  };
}
