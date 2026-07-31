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
  /**
   * If this repo's uat branch is ALREADY contained in its target branch, the
   * merge commit that brought it in; otherwise null.
   *
   * Publishing and stamping are two operations against two systems. A process
   * death, a thrown state write, or a dropped connection after the remote
   * accepted the push leaves a repo genuinely landed with `promoted_at` null.
   * Retry would then re-classify it as pending and — because the target has
   * moved over the batch's own files — reject the whole promote as stale-base,
   * wedging a half-landed batch permanently. This lets recovery prove the truth
   * from git instead of trusting local state.
   */
  findLandedMerge(branchName: string): Promise<string | null>;
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
  runShip?: (generation: UatGeneration, shipVersion: string | undefined) => Promise<void>;
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
  options: { shipVersion?: string } = {},
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
    return promotePolyrepo(gen, projectRoot, deps, deps.polyrepoGit, log, options.shipVersion);
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
  return finishPromote(gen, projectRoot, deps, mergeSha, log, false, options.shipVersion);
}

/**
 * Composite merge reference for a polyrepo generation, rebuilt from the stored
 * per-repo merge SHAs rather than an in-memory list, so it survives a restart
 * between the last publish and finalization.
 */
/**
 * A merge that is live on its remote but has no durable record of it.
 *
 * Not rolled back — main is never rewound — and deliberately NOT finalized:
 * marking the generation promoted here would fire post-merge lifecycles against
 * `uat_generation_repos` rows that still read pending, and would end the
 * generation's promotable life, so the retry that is supposed to recover the
 * stamp could never run. Staying promotable is what makes recovery possible.
 */
function unstampableFailure(
  gen: UatGeneration,
  unstampable: ReadonlyArray<{ repoKey: string; mergeSha: string; error: unknown }>,
  log: (msg: string) => void,
): PromoteResult {
  const detail = unstampable
    .map((u) => `${u.repoKey}@${u.mergeSha.slice(0, 9)} (${u.error instanceof Error ? u.error.message.split('\n')[0] : String(u.error)})`)
    .join('; ');
  log(`[uat-promote] ${gen.name}: merges are live but unrecorded — not finalizing: ${detail}`);
  return {
    success: false,
    reason: 'merge-failed',
    message:
      `${gen.name}: ${unstampable.length} repo merge(s) are LIVE on their target but could not be recorded: ${detail}. ` +
      `Nothing is rolled back — a landed merge is never rewound. The batch stays promotable: fix the state store and ` +
      `retry, and the already-landed repos are detected and skipped rather than republished.`,
  };
}

/**
 * A repo row that claims a promote stamp but has no merge SHA and no merge
 * findable on its target.
 *
 * Deliberately non-terminal. `promotedAt` on its own is enough to keep the row
 * out of the pending set, so letting it through would finalize a generation
 * that can never produce complete per-repo merge evidence: post-merge
 * verification would refuse every member forever, while the terminal `promoted`
 * status would block the retry that is the only way to recover the missing SHA.
 * Failing here keeps the batch promotable so a later attempt — once the remote
 * is reachable, or the row is repaired — can finish it properly.
 */
function unprovenStampFailure(
  gen: UatGeneration,
  unproven: ReadonlyArray<{ repoKey: string; why: string }>,
  log: (msg: string) => void,
): PromoteResult {
  const detail = unproven.map((u) => `${u.repoKey} (${u.why})`).join('; ');
  log(`[uat-promote] ${gen.name}: stamped repo(s) cannot be proven merged — not finalizing: ${detail}`);
  return {
    success: false,
    reason: 'merge-failed',
    message:
      `${gen.name}: ${unproven.length} repo(s) are recorded as promoted but their merge cannot be proven: ${detail}. ` +
      `Nothing was published on this attempt. A batch is only finalized once every repo carries both a promote ` +
      `timestamp and the merge commit it landed, because post-merge verification checks each repo's merge against ` +
      `its own target branch and refuses on missing evidence. The batch stays promotable: retry once the remote is ` +
      `reachable, or correct the repo row, and repos that genuinely landed are detected and skipped rather than ` +
      `republished.`,
  };
}

/** The generation with its repo rows replaced by recovered/updated ones. */
function withRepos(gen: UatGeneration, repos: readonly UatGenerationRepo[]): UatGeneration {
  return { ...gen, repos: [...repos] };
}

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
  shipVersion?: string,
): Promise<PromoteResult> {
  const allRepos = [...(gen.repos ?? [])].sort((a, b) => a.mergeOrder - b.mergeOrder);
  if (allRepos.length === 0) {
    return { success: false, reason: 'merge-failed', message: `${gen.name} records no member repos to promote` };
  }

  const now = deps.now ?? (() => new Date());
  /** Repos whose merge is live on the remote but whose durable stamp failed. */
  const unstampable: Array<{ repoKey: string; mergeSha: string; error: unknown }> = [];
  /** Repos that claim a promote stamp but can produce no merge SHA to prove it. */
  const unproven: Array<{ repoKey: string; why: string }> = [];

  // Reconcile local state against the remotes BEFORE classifying anything as
  // pending. A repo whose push succeeded but whose stamp never landed is
  // genuinely published; treating it as pending would re-trial-merge it and
  // then reject the promote as stale-base, because the target has moved over
  // this batch's own files.
  const recovered: UatGenerationRepo[] = [];
  for (const repo of allRepos) {
    // A stamped row with no merge SHA still needs remote recovery: evidence is
    // all-or-nothing, so one such row withholds it for the whole generation and
    // post-merge verification refuses forever. Recovering the SHA is the only
    // way out, and it is exactly what findLandedMerge answers.
    if (repo.promotedAt && repo.mergeSha) { recovered.push(repo); continue; }
    const git = repoGit.get(repo.repoKey);
    if (!git) {
      // An unstamped row without deps is simply pending, and the `missing` check
      // below rejects it by name. A STAMPED one is the dangerous case: the stamp
      // alone keeps it out of `pending`, so with no way to look up its merge it
      // would sail through to finalization unproven.
      if (repo.promotedAt) {
        unproven.push({ repoKey: repo.repoKey, why: 'there are no promote git deps for it, so its target cannot be inspected' });
      }
      recovered.push(repo);
      continue;
    }

    let landedSha: string | null = null;
    try {
      landedSha = await git.findLandedMerge(repo.branch);
    } catch (err) {
      // Unknown is not "pending". Treating it as pending would trial-merge and
      // possibly republish a merge that is already live.
      return {
        success: false,
        reason: 'merge-failed',
        message:
          `${gen.name}: could not establish whether ${repo.repoKey} has already landed ` +
          `(${err instanceof Error ? err.message.split('\n')[0] : String(err)}). ` +
          `Nothing was published; retry once the remote is reachable.`,
      };
    }
    if (!landedSha) {
      // No stamp and no landed merge is the ordinary pending case. A stamp with
      // no merge SHA and no merge on the target is a row that CLAIMS to have
      // been promoted and cannot back it up — the probe just came back empty, so
      // there is no evidence left to find on this attempt.
      if (repo.promotedAt) {
        unproven.push({
          repoKey: repo.repoKey,
          why: `it is stamped promoted at ${repo.promotedAt} with no recorded merge sha, and ${repo.branch} is not contained in ${repo.targetBranch ?? 'main'}`,
        });
      }
      recovered.push(repo);
      continue;
    }

    log(
      `[uat-promote] ${gen.name}: ${repo.repoKey} is contained in its target (${landedSha.slice(0, 9)}) ` +
      `${repo.promotedAt ? 'but has no recorded merge sha' : 'but was never stamped'} — recovering`,
    );
    const promotedAt = repo.promotedAt ?? now().toISOString();
    try {
      deps.markRepoPromoted?.(gen.name, repo.repoKey, promotedAt, landedSha);
    } catch (err) {
      // Do NOT fabricate promoted state in memory. The canonical row still says
      // pending, so finalizing here would mark the generation terminal, fire
      // post-merge, and destroy the very state the "next attempt recovers" story
      // depends on — there would be no next attempt.
      unstampable.push({ repoKey: repo.repoKey, mergeSha: landedSha, error: err });
      log(`[uat-promote] ${gen.name}: recovery stamp failed for ${repo.repoKey}: ${err instanceof Error ? err.message : String(err)}`);
      recovered.push(repo);
      continue;
    }
    recovered.push({ ...repo, promotedAt, mergeSha: landedSha });
  }

  if (unstampable.length > 0) {
    return unstampableFailure(gen, unstampable, log);
  }
  if (unproven.length > 0) {
    return unprovenStampFailure(gen, unproven, log);
  }

  const alreadyLanded = recovered.filter((r) => r.promotedAt);
  const pending = recovered.filter((r) => !r.promotedAt);
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
    return finishPromote(
      withRepos(gen, recovered),
      projectRoot,
      deps,
      landedMergeRef(recovered),
      log,
      true,
      shipVersion,
    );
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
    try {
      deps.markRepoPromoted?.(gen.name, p.repoKey, now().toISOString(), p.mergeSha);
    } catch (err) {
      // The push succeeded, so the merge is live and must never be rolled back —
      // but without the durable stamp the canonical row still says pending.
      // Finalizing anyway would mark the generation terminal on state that does
      // not exist, so stop short of finalizing and stay promotable.
      unstampable.push({ repoKey: p.repoKey, mergeSha: p.mergeSha, error: err });
      log(`[uat-promote] ${gen.name}: publish stamp failed for ${p.repoKey} (merge IS live at ${p.mergeSha.slice(0, 9)}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (unstampable.length > 0) {
    await discardAll();
    return unstampableFailure(gen, unstampable, log);
  }

  await discardAll();

  // Built from stored SHAs plus this run's, so a resumed promote reports the
  // same reference a single-pass promote would.
  const landedByKey = new Map(landed.map((l) => [l.repoKey, l.mergeSha]));
  const mergeSha = landedMergeRef(
    recovered.map((r) => ({ ...r, mergeSha: landedByKey.get(r.repoKey) ?? r.mergeSha ?? null })),
  );
  log(`[uat-promote] ${gen.name}: merged to ${landed.length} repo target(s) — ${mergeSha}`);

  // finishPromote needs the per-repo merge evidence for post-merge verification,
  // and the in-memory gen predates this run's publishes.
  const promotedGen: UatGeneration = {
    ...gen,
    repos: recovered.map((r) => ({
      ...r,
      mergeSha: landedByKey.get(r.repoKey) ?? r.mergeSha ?? null,
      promotedAt: r.promotedAt ?? (landedByKey.has(r.repoKey) ? now().toISOString() : null),
    })),
  };

  return finishPromote(promotedGen, projectRoot, deps, mergeSha, log, true, shipVersion);
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
  shipVersion?: string,
): Promise<PromoteResult> {
  // The one place a generation becomes terminal, so the completeness invariant
  // is enforced here rather than at each caller: a polyrepo batch is finalized
  // only when EVERY repo carries both a promote stamp and the merge commit it
  // landed. Anything less cannot supply the per-repo evidence post-merge
  // verification needs, and `promoted` would foreclose the retry that could
  // still recover it.
  if (isPolyrepoGeneration) {
    const incomplete = (gen.repos ?? []).filter((r) => !r.promotedAt || !r.mergeSha);
    if (incomplete.length > 0) {
      return unprovenStampFailure(
        gen,
        incomplete.map((r) => ({
          repoKey: r.repoKey,
          why: r.promotedAt ? 'no merge sha was recorded for it' : 'it was never stamped as promoted',
        })),
        log,
      );
    }
  }

  deps.store.update(gen.name, { status: 'promoted' });
  try {
    deps.recordVerification?.(gen, mergeSha);
  } catch (err) {
    log(`[uat-promote] ${gen.name}: verification verdict recording failed after merge: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await deps.runShip?.(gen, shipVersion);
  } catch (err) {
    log(`[uat-promote] ${gen.name}: version ship failed after merge: ${err instanceof Error ? err.message : String(err)}`);
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
  //
  // The completeness guard above already refused anything short of a merge SHA
  // per repo, so this evidence set covers every repo the batch touched — never
  // a subset, which would advance every member's lifecycle having proven only
  // some of the repos their work landed in.
  const verifiedMergedRepos = isPolyrepoGeneration
    ? (gen.repos ?? []).map((r) => ({
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

        findLandedMerge: async (branchName) => {
          const safeBranch = safeUatBranchName(branchName);
          // This call establishes REMOTE truth after an ambiguous publish, so a
          // failed fetch must not be answered from a cached target ref: that
          // could report "not landed" for a merge that is live, and republish it.
          await runGit(['fetch', 'origin', target], repo.repoPath).catch((err) => {
            throw new Error(
              `cannot determine whether ${repo.repoKey} already landed: fetching origin/${target} failed ` +
              `(${err instanceof Error ? err.message.split('\n')[0] : String(err)})`,
            );
          });
          // Fetch the UAT ref as well: a fresh checkout has no tracking ref for
          // it, and resolving only from local refs would misclassify a landed
          // unstamped repo as pending. Absence here is normal (the branch may
          // already be reaped), so this one is best-effort.
          await runGit(
            ['fetch', 'origin', `+refs/heads/${safeBranch}:refs/remotes/origin/${safeBranch}`],
            repo.repoPath,
          ).catch(() => {});

          const ref = await runGit(['rev-parse', '--verify', `origin/${safeBranch}`], repo.repoPath)
            .then(() => `origin/${safeBranch}`)
            .catch(() => safeBranch);

          const tip = await runGit(['rev-parse', ref], repo.repoPath)
            .then(({ stdout }) => stdout.trim())
            .catch(() => '');
          if (!tip) return null;

          // Contained in the target? If not, this repo genuinely has not landed.
          const contained = await runGit(['merge-base', '--is-ancestor', tip, originTarget], repo.repoPath)
            .then(() => true)
            .catch(() => false);
          if (!contained) return null;

          // The merge commit that brought it in: the oldest merge on the
          // ancestry path from the batch tip to the target head.
          const { stdout } = await runGit(
            ['rev-list', '--ancestry-path', '--merges', '--reverse', `${tip}..${originTarget}`],
            repo.repoPath,
          ).catch(() => ({ stdout: '' }));
          const mergeCommit = stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0];
          // A fast-forwarded target has no merge commit; the tip itself is what landed.
          return mergeCommit ?? tip;
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
