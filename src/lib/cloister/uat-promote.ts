/**
 * Batch promotion (PAN-1737: UAT batch trains) — "merge what you tested".
 *
 * Promoting a generation merges the uat/* branch itself into main (one no-ff
 * merge), so main receives EXACTLY the tree the operator exercised — including
 * the assembly agent's conflict resolutions. GitHub automatically marks each
 * feature PR merged because its head becomes reachable from main, and every
 * member issue then flows through the standard per-issue post-merge lifecycle
 * exactly once, behind the PAN-328
 * in-flight guard.
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
import type { UatGeneration, UatGenerationRepo, UatGenerationStatus } from '../overdeck/merge-sync.js';
import type { VerifiedMergedRepo } from './merge-verification.js';
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

/**
 * A merge prepared in a throwaway worktree but NOT pushed. Phase A produces one
 * per repo; phase B publishes them. The opaque `handle` is whatever the git
 * implementation needs to find the prepared tree again (a worktree path in the
 * real wiring).
 */
export interface PreparedRepoMerge {
  repoKey: string;
  handle: string;
  mergeSha: string;
}

/** Per-repo promote operations for one member repo of a polyrepo project. */
export interface PolyrepoRepoPromoteGit {
  /** Fetch the repo's target branch and return its head SHA. */
  targetHeadSha(): Promise<string>;
  /** Files changed on the target branch since the given SHA. */
  changedFilesSince(baseSha: string): Promise<string[]>;
  /** Files this repo's uat branch changes vs its merge-base with the target. */
  batchChangedFiles(branchName: string): Promise<string[]>;
  /** Merge the uat branch into the target locally. MUST NOT push. */
  trialMerge(branchName: string, message: string): Promise<PreparedRepoMerge>;
  /** Push an already-prepared merge to the target branch. */
  publishPrepared(prepared: PreparedRepoMerge): Promise<void>;
  /** Drop a prepared merge's worktree. Must be safe to call twice. */
  discardPrepared(prepared: PreparedRepoMerge): Promise<void>;
}

export interface UatPromoteDeps {
  git: UatPromoteGitDeps;
  /**
   * Per-repo git for a polyrepo project, keyed by repoKey. Its PRESENCE — not
   * a repo count — selects the two-phase path: a polyrepo project with a single
   * contributing repo still has no git repo at its own project root, so the
   * monorepo path would run git against a non-repo and fail.
   */
  polyrepoGit?: ReadonlyMap<string, PolyrepoRepoPromoteGit>;
  /**
   * Record that one repo's merge landed, so a retry after a partial publish
   * skips it. Required whenever polyrepoGit is supplied.
   */
  markRepoPromoted?: (name: string, repoKey: string, promotedAt: string, mergeSha?: string) => void;
  now?: () => Date;
  store: GenerationStorePort & { get(name: string): UatGeneration | null };
  teardownStack(generation: UatGeneration): Promise<void>;
  /**
   * Kick off the per-issue post-merge lifecycle (through the PAN-328 guard).
   * Returns false when a run for that issue is already in flight.
   */
  firePostMerge(
    issueId: string,
    options?: {
      sourceBranch?: string;
      verifiedMergedRef?: string;
      /** Per-repo merge evidence for a polyrepo batch (PAN-3093). */
      verifiedMergedRepos?: readonly VerifiedMergedRepo[];
    },
  ): boolean;
  /**
   * Authoritative per-member merge eligibility (PAN-1759), checked at promote
   * time as defense-in-depth: batch membership is computed from orchestrator
   * verbs at assembly time, and a member's pipeline state can change (or have
   * been wrong) between assembly and the operator clicking Merge. RUN-20
   * assembled a batch containing a mid-review issue; this gate refuses to land
   * it on main.
   */
  memberEligibility(issueId: string): { eligible: boolean; reason?: string };
  recordVerification?: (generation: UatGeneration, mergeSha: string) => void;
  log?: (msg: string) => void;
}

export type PromoteFailureReason = 'not-found' | 'wrong-status' | 'member-not-ready' | 'stale-base' | 'merge-failed';

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

  const notReady = gen.members
    .map((m) => ({ issueId: m.issueId, gate: deps.memberEligibility(m.issueId) }))
    .filter(({ gate }) => !gate.eligible);
  if (notReady.length > 0) {
    const detail = notReady.map(({ issueId, gate }) => `${issueId} (${gate.reason ?? 'not eligible'})`).join(', ');
    return {
      success: false,
      reason: 'member-not-ready',
      message:
        `${name} contains member(s) the pipeline has not cleared to merge: ${detail} — ` +
        `wait for them to pass review+test, or for the reconciler to rebuild the batch without them.`,
    };
  }

  if (deps.polyrepoGit) {
    return promotePolyrepo(gen, projectRoot, deps, deps.polyrepoGit, log);
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
  return finishPromote(gen, projectRoot, deps, mergeSha, log);
}

/**
 * Composite merge reference for a polyrepo generation, rebuilt from the stored
 * per-repo merge SHAs rather than an in-memory list, so it survives a restart
 * between the last publish and finalization.
 */
function landedMergeRef(repos: readonly UatGenerationRepo[]): string {
  return [...repos]
    .sort((a, b) => a.mergeOrder - b.mergeOrder)
    .map((r) => `${r.repoKey}@${(r.mergeSha ?? 'landed').slice(0, 7)}`)
    .join(' ');
}

/**
 * Two-phase polyrepo promote.
 *
 * Phase A validates and trial-merges EVERY repo without pushing anything, so
 * the all-or-nothing decision is made while nothing is published: a failure in
 * repo 3 of 3 leaves repos 1 and 2 untouched on their remotes.
 *
 * Phase B publishes the prepared merges in merge order. A failure partway is
 * NOT rolled back — undoing a landed merge means force-pushing a member repo's
 * main, a one-way door. It is instead resumable: each landed repo is stamped
 * with promoted_at, the result names landed vs pending, the generation stays
 * promotable, and a retry skips whatever already landed.
 */
async function promotePolyrepo(
  gen: UatGeneration,
  projectRoot: string,
  deps: UatPromoteDeps,
  repoGit: ReadonlyMap<string, PolyrepoRepoPromoteGit>,
  log: (msg: string) => void,
): Promise<PromoteResult> {
  const allRepos = [...(gen.repos ?? [])].sort((a, b) => a.mergeOrder - b.mergeOrder);
  if (allRepos.length === 0) {
    return { success: false, reason: 'merge-failed', message: `${gen.name} records no member repos to promote` };
  }

  const alreadyLanded = allRepos.filter((r) => r.promotedAt);
  const pending = allRepos.filter((r) => !r.promotedAt);
  if (alreadyLanded.length > 0) {
    log(`[uat-promote] ${gen.name}: resuming — ${alreadyLanded.map((r) => r.repoKey).join(', ')} already landed`);
  }
  if (pending.length === 0) {
    // Every repo already landed. This is the crash window between the last
    // publish stamp and finalization, and retry is the documented recovery —
    // so it is the idempotent completion case, not an error. Rejecting it
    // would leave a fully-published batch permanently unfinalizable: never
    // promoted, no verdicts recorded, no stack teardown, no post-merge.
    log(`[uat-promote] ${gen.name}: every repo already published — finalizing`);
    return finishPromote(gen, projectRoot, deps, landedMergeRef(allRepos), log, true);
  }

  const missing = pending.filter((r) => !repoGit.has(r.repoKey));
  if (missing.length > 0) {
    return {
      success: false,
      reason: 'merge-failed',
      message: `${gen.name}: no promote git deps for repo(s) ${missing.map((r) => r.repoKey).join(', ')}`,
    };
  }

  const message = buildPromoteMergeMessage(gen);
  const prepared: PreparedRepoMerge[] = [];
  const discardAll = async () => {
    for (const p of prepared) {
      await repoGit.get(p.repoKey)!.discardPrepared(p).catch((err) => {
        log(`[uat-promote] ${gen.name}: discarding ${p.repoKey} trial merge failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  };

  // ── Phase A: validate + trial-merge everything, push nothing ──────────────
  for (const repo of pending) {
    const git = repoGit.get(repo.repoKey)!;

    let targetHead: string;
    try {
      targetHead = await git.targetHeadSha();
    } catch (err) {
      await discardAll();
      return {
        success: false,
        reason: 'merge-failed',
        message: `${gen.name}: could not read ${repo.repoKey} target head: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (repo.baseSha !== targetHead) {
      // Same disjoint-movement rule as the monorepo path, per repo: reject only
      // when this repo's target gained commits touching files this repo's uat
      // branch also changes.
      const [targetChanged, batchChanged] = await Promise.all([
        git.changedFilesSince(repo.baseSha),
        git.batchChangedFiles(repo.branch),
      ]);
      const batchSet = new Set(batchChanged);
      const overlap = targetChanged.filter((f) => batchSet.has(f));
      if (overlap.length > 0) {
        await discardAll();
        return {
          success: false,
          reason: 'stale-base',
          message:
            `${gen.name} was assembled off ${repo.repoKey}@${repo.baseSha.slice(0, 9)} but that repo is now at ` +
            `${targetHead.slice(0, 9)}, and the new commits touch ${overlap.length} file(s) this batch also changes ` +
            `(${overlap.slice(0, 3).join(', ')}${overlap.length > 3 ? ', …' : ''}) — ` +
            `the tree you tested may not match what would land. Nothing was published. A fresh batch reassembles automatically; re-test before merging.`,
        };
      }
      log(`[uat-promote] ${gen.name}: ${repo.repoKey} base moved ${repo.baseSha.slice(0, 9)} → ${targetHead.slice(0, 9)} with no member-file overlap — proceeding`);
    }

    try {
      prepared.push(await git.trialMerge(repo.branch, message));
    } catch (err) {
      await discardAll();
      return {
        success: false,
        reason: 'merge-failed',
        message:
          `${gen.name}: trial merge failed in ${repo.repoKey} — ` +
          `${err instanceof Error ? (err.message.split('\n')[0] ?? 'merge failed') : String(err)}. ` +
          `Nothing was published; the batch is unchanged and still promotable.`,
      };
    }
  }

  log(`[uat-promote] ${gen.name}: all ${prepared.length} repo(s) trial-merged cleanly — publishing`);

  // ── Phase B: publish; a failure here is resumable, never rolled back ──────
  const landed: Array<{ repoKey: string; mergeSha: string }> = [];
  const now = deps.now ?? (() => new Date());
  for (const p of prepared) {
    try {
      await repoGit.get(p.repoKey)!.publishPrepared(p);
    } catch (err) {
      const stillPending = prepared.slice(prepared.indexOf(p)).map((x) => x.repoKey);
      await discardAll();
      return {
        success: false,
        reason: 'merge-failed',
        message:
          `${gen.name}: published ${landed.length > 0 ? landed.map((l) => l.repoKey).join(', ') : 'no repos'} ` +
          `but failed on ${p.repoKey} (${err instanceof Error ? (err.message.split('\n')[0] ?? 'push failed') : String(err)}). ` +
          `Still pending: ${stillPending.join(', ')}. Nothing is rolled back — main is never rewound — ` +
          `retry the merge and the repos that already landed are skipped.`,
      };
    }
    landed.push({ repoKey: p.repoKey, mergeSha: p.mergeSha });
    deps.markRepoPromoted?.(gen.name, p.repoKey, now().toISOString(), p.mergeSha);
  }

  await discardAll();

  // Built from stored SHAs plus this run's, so a resumed promote reports the
  // same reference a single-pass promote would.
  const landedByKey = new Map(landed.map((l) => [l.repoKey, l.mergeSha]));
  const mergeSha = landedMergeRef(
    allRepos.map((r) => ({ ...r, mergeSha: landedByKey.get(r.repoKey) ?? r.mergeSha ?? null })),
  );
  log(`[uat-promote] ${gen.name}: merged to ${landed.length} repo target(s) — ${mergeSha}`);

  // finishPromote needs the per-repo merge evidence for post-merge verification,
  // and the in-memory gen predates this run's publishes.
  const promotedGen: UatGeneration = {
    ...gen,
    repos: allRepos.map((r) => ({
      ...r,
      mergeSha: landedByKey.get(r.repoKey) ?? r.mergeSha ?? null,
      promotedAt: r.promotedAt ?? (landedByKey.has(r.repoKey) ? now().toISOString() : null),
    })),
  };

  return finishPromote(promotedGen, projectRoot, deps, mergeSha, log, true);
}

/**
 * Everything after the merge itself lands: status, verification verdicts, stack
 * teardown, invalidating the rest of the chain, and the per-issue post-merge
 * handoff. Shared so the monorepo and polyrepo paths cannot drift.
 */
async function finishPromote(
  gen: UatGeneration,
  projectRoot: string,
  deps: UatPromoteDeps,
  mergeSha: string,
  log: (msg: string) => void,
  isPolyrepoGeneration = false,
): Promise<PromoteResult> {
  deps.store.update(gen.name, { status: 'promoted' });
  try {
    deps.recordVerification?.(gen, mergeSha);
  } catch (err) {
    log(`[uat-promote] ${gen.name}: verification verdict recording failed after merge: ${err instanceof Error ? err.message : String(err)}`);
  }
  await deps.teardownStack(gen).catch((err) => {
    log(`[uat-promote] ${gen.name}: stack teardown failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const invalidated: string[] = [];
  for (const other of deps.store.listChain(projectRoot, ['ready', 'superseded'])) {
    if (other.name === gen.name) continue;
    deps.store.update(other.name, { status: 'invalidated' });
    invalidated.push(other.name);
    await deps.teardownStack(other).catch(() => {});
  }

  // Standard per-issue post-merge handoff, exactly once each (PAN-328 guard).
  // For polyrepo this runs only after EVERY repo published, so a member is
  // never handed off while part of its work is still unlanded.
  //
  // A polyrepo member's headSha is a composite anchor (`fe@abc api@def`), not a
  // git ref, and the wrapper project path is not a git repo — passing it as
  // verifiedMergedRef guarantees the ancestry check fails and the lifecycle
  // refuses. Per-repo merge commits are handed over instead, each verified in
  // its own repo against its own target branch.
  const verifiedMergedRepos = isPolyrepoGeneration
    ? (gen.repos ?? [])
        .filter((r) => r.mergeSha)
        .map((r) => ({
          repoKey: r.repoKey,
          repoPath: r.repoPath,
          mergeSha: r.mergeSha!,
          targetBranch: r.targetBranch ?? 'main',
        }))
    : [];

  const postMergeStarted: string[] = [];
  for (const member of gen.members) {
    const options = verifiedMergedRepos.length > 0
      ? { sourceBranch: member.branch, verifiedMergedRepos }
      : { sourceBranch: member.branch, verifiedMergedRef: member.headSha || member.branch };
    if (deps.firePostMerge(member.issueId, options)) postMergeStarted.push(member.issueId);
    else log(`[uat-promote] ${gen.name}: post-merge for ${member.issueId} already in flight — skipped`);
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

/**
 * Real per-repo promote wiring for a polyrepo project (PAN-3093), keyed by
 * repoKey. Each repo merges its own uat branch into its own target branch in a
 * throwaway detached worktree.
 *
 * The split that makes phase A safe: trialMerge does everything EXCEPT the
 * push, and leaves the worktree in place so publishPrepared only has to push
 * it. Nothing reaches a remote until every repo has produced a merge commit
 * locally.
 */
export function buildPolyrepoUatPromoteGitDeps(
  repos: ReadonlyArray<{ repoKey: string; repoPath: string; targetBranch?: string }>,
): Map<string, PolyrepoRepoPromoteGit> {
  const runGit = (args: string[], cwd: string) =>
    execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });

  return new Map(
    repos.map((repo) => {
      const target = repo.targetBranch ?? 'main';
      const originTarget = `origin/${target}`;
      const worktreeFor = (branchName: string) =>
        join(tmpdir(), `uat-promote-${repo.repoKey}-${branchName.replace(/[^a-z0-9]/gi, '-')}`);

      const git: PolyrepoRepoPromoteGit = {
        targetHeadSha: async () => {
          await runGit(['fetch', 'origin', target], repo.repoPath);
          return (await runGit(['rev-parse', originTarget], repo.repoPath)).stdout.trim();
        },

        changedFilesSince: async (baseSha) => {
          if (!/^[0-9a-f]{7,40}$/i.test(baseSha)) throw new Error(`unsafe base sha: ${baseSha}`);
          const { stdout } = await runGit(['diff', '--name-only', `${baseSha}..${originTarget}`], repo.repoPath);
          return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        },

        batchChangedFiles: async (branchName) => {
          const safeBranch = safeUatBranchName(branchName);
          const ref = await runGit(['rev-parse', '--verify', `origin/${safeBranch}`], repo.repoPath)
            .then(() => `origin/${safeBranch}`)
            .catch(() => safeBranch);
          const mergeBase = (await runGit(['merge-base', originTarget, ref], repo.repoPath)).stdout.trim();
          const { stdout } = await runGit(['diff', '--name-only', `${mergeBase}..${ref}`], repo.repoPath);
          return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
        },

        trialMerge: async (branchName, message) => {
          const safeBranch = safeUatBranchName(branchName);
          const worktreePath = worktreeFor(safeBranch);
          await runGit(['worktree', 'remove', '--force', worktreePath], repo.repoPath).catch(() => {});
          await runGit(['worktree', 'prune'], repo.repoPath).catch(() => {});
          await runGit(['worktree', 'add', '--detach', worktreePath, originTarget], repo.repoPath);
          try {
            const originRef = `origin/${safeBranch}`;
            const ref = await runGit(['rev-parse', '--verify', originRef], worktreePath)
              .then(() => originRef)
              .catch(() => safeBranch);
            await runGit(['merge', '--no-ff', ref, '-m', message], worktreePath);
            const mergeSha = (await runGit(['rev-parse', 'HEAD'], worktreePath)).stdout.trim();
            return { repoKey: repo.repoKey, handle: worktreePath, mergeSha };
          } catch (err) {
            // Clean up our own worktree before propagating; the caller discards
            // the ones that already succeeded.
            await runGit(['worktree', 'remove', '--force', worktreePath], repo.repoPath).catch(() => {});
            await runGit(['worktree', 'prune'], repo.repoPath).catch(() => {});
            throw err;
          }
        },

        publishPrepared: async (prepared) => {
          await runGit(['push', 'origin', `HEAD:${target}`], prepared.handle);
        },

        discardPrepared: async (prepared) => {
          await runGit(['worktree', 'remove', '--force', prepared.handle], repo.repoPath).catch(() => {});
          await runGit(['worktree', 'prune'], repo.repoPath).catch(() => {});
        },
      };

      return [repo.repoKey, git] as const;
    }),
  );
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
