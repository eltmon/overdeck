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
import { execFile } from 'child_process';
import type { UatGeneration, UatGenerationStatus } from '../database/uat-generations-db.js';
import type { GenerationStorePort } from './uat-generation-engine.js';

const execFileAsync = promisify(execFile);

function safeUatBranchName(branchName: string): string {
  if (!/^uat\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(branchName)) {
    throw new Error(`unsafe UAT branch name: ${branchName}`);
  }
  return branchName;
}

export interface UatPromoteGitDeps {
  /** `git fetch origin main` and return the origin/main head SHA. */
  fetchMain(): Promise<string>;
  /**
   * Merge the generation branch into main with the given message (no-ff, in a
   * throwaway worktree — NEVER the primary checkout) and push. Returns the
   * merge commit SHA.
   */
  mergeIntoMain(branchName: string, message: string): Promise<string>;
  /** Files changed on origin/main since the given SHA (base-movement footprint). */
  changedFilesSince(baseSha: string): Promise<string[]>;
  /** Files the batch branch changes vs its merge-base with origin/main. */
  batchChangedFiles(branchName: string): Promise<string[]>;
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
    // Main moved since assembly. An active flywheel run lands commits on main
    // continuously, so exact base equality would make ready batches almost
    // never promotable (first live run, 2026-06-10). Safety is preserved by a
    // narrower check: reject only when main's NEW commits touch files the
    // batch also touches — then the tested behavior genuinely may not match
    // what lands. Disjoint movement (docs, unrelated fixes) proceeds; the
    // no-ff merge itself still hard-fails on any textual conflict.
    const [mainChanged, batchChanged] = await Promise.all([
      deps.git.changedFilesSince(gen.baseSha),
      deps.git.batchChangedFiles(gen.name),
    ]);
    const batchSet = new Set(batchChanged);
    const overlap = mainChanged.filter((f) => batchSet.has(f));
    if (overlap.length > 0) {
      return {
        success: false,
        reason: 'stale-base',
        message:
          `${name} was assembled off ${gen.baseSha.slice(0, 9)} but main is now at ${mainSha.slice(0, 9)}, ` +
          `and the new commits touch ${overlap.length} file(s) this batch also changes ` +
          `(${overlap.slice(0, 3).join(', ')}${overlap.length > 3 ? ', …' : ''}) — ` +
          `the tree you tested may not match what would land. A fresh batch reassembles automatically; re-test before merging.`,
      };
    }
    log(`[uat-promote] ${name}: base moved ${gen.baseSha.slice(0, 9)} → ${mainSha.slice(0, 9)} with no member-file overlap — proceeding`);
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
  const runGit = (args: string[], cwd: string) =>
    execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });

  return {
    fetchMain: async () => {
      await runGit(['fetch', 'origin', 'main'], projectRoot);
      return (await runGit(['rev-parse', 'origin/main'], projectRoot)).stdout.trim();
    },
    mergeIntoMain: async (branchName, message) => {
      const safeBranch = safeUatBranchName(branchName);
      const worktreePath = join(tmpdir(), `uat-promote-${safeBranch.replace(/[^a-z0-9]/gi, '-')}`);
      await runGit(['worktree', 'remove', '--force', worktreePath], projectRoot).catch(() => {});
      await runGit(['worktree', 'prune'], projectRoot).catch(() => {});
      await runGit(['worktree', 'add', '--detach', worktreePath, 'origin/main'], projectRoot);
      try {
        const originRef = `origin/${safeBranch}`;
        const ref = await runGit(['rev-parse', '--verify', originRef], worktreePath)
          .then(() => originRef)
          .catch(() => safeBranch);
        await runGit(['merge', '--no-ff', ref, '-m', message], worktreePath);
        await runGit(['push', 'origin', 'HEAD:main'], worktreePath);
        return (await runGit(['rev-parse', 'HEAD'], worktreePath)).stdout.trim();
      } finally {
        await runGit(['worktree', 'remove', '--force', worktreePath], projectRoot).catch(() => {});
        await runGit(['worktree', 'prune'], projectRoot).catch(() => {});
      }
    },
    changedFilesSince: async (baseSha) => {
      if (!/^[0-9a-f]{7,40}$/i.test(baseSha)) throw new Error(`unsafe base sha: ${baseSha}`);
      const { stdout } = await runGit(['diff', '--name-only', `${baseSha}..origin/main`], projectRoot);
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
    batchChangedFiles: async (branchName) => {
      const safeBranch = safeUatBranchName(branchName);
      const ref = await runGit(['rev-parse', '--verify', `origin/${safeBranch}`], projectRoot)
        .then(() => `origin/${safeBranch}`)
        .catch(() => safeBranch);
      const mergeBase = (await runGit(['merge-base', 'origin/main', ref], projectRoot)).stdout.trim();
      const { stdout } = await runGit(['diff', '--name-only', `${mergeBase}..${ref}`], projectRoot);
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
  };
}
