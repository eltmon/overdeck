/**
 * Polyrepo UAT generation assembly (PAN-3093).
 *
 * The single-repo engine (uat-generation-engine.ts) builds one branch off one
 * main in one worktree. A polyrepo project's generation is an N-tuple: one
 * `uat/<label>-<codename>-<MMDD>` branch per member repo that some ready
 * feature actually contributes to, each cut from that repo's own target head.
 * This module orchestrates that; the single-repo engine is untouched and its
 * `GenerationGitDeps` contract is reused verbatim, one instance per repo.
 *
 * Two rules distinguish it from N independent assemblies:
 *
 *   - **Global hold-out.** A feature that cannot be merged and resolved in ANY
 *     repo is held out of the WHOLE generation. Testers must never see a
 *     feature half-applied across repos.
 *   - **Atomic per feature, with rollback.** A feature applies to every repo it
 *     contributes to or to none. Each target repo's head is captured first, and
 *     a repo that already merged the feature is re-pointed at that head when a
 *     later repo rejects it. Accepted features are never rebuilt, so the work
 *     is linear in repos x features.
 *
 * Pure orchestrator: all git and store I/O is injected, so every path — happy,
 * conflict-resolved, held-out, push-failed — is unit-testable with fake deps.
 */

import { makeUniqueUatCandidateName } from './uat-candidate-name.js';
import { generationFolderName } from './uat-generation-engine.js';
import {
  applyUnionLintPlan,
  planUnionLint,
  plannedFiles,
  seedUnionLedger,
  type MigrationVersionLedger,
  type UnionLintPlan,
} from './uat-union-lint.js';
import type {
  ConflictContext,
  ConflictResolutionResult,
  GenerationGitDeps,
  GenerationStorePort,
  ReadyFeature,
} from './uat-generation-engine.js';
import type {
  UatGeneration,
  UatGenerationHeldOut,
  UatGenerationMember,
  UatGenerationMemberRepo,
  UatGenerationRepo,
  UatGenerationResolution,
  UatGenerationStatus,
} from '../overdeck/merge-sync.js';
import type { ResolvedProjectRepo } from '../project-repos.js';

export interface PolyrepoAssembleInput {
  /** Wrapper project path. Not a git repo; it owns `workspaces/`. */
  projectRoot: string;
  /** Project label for the codename, e.g. 'min'. */
  label: string;
  /** ISO date; MMDD goes into the branch name. */
  dateIso: string;
  /**
   * Ready features in merge-queue order. Each carries `repoContributions`
   * naming the member repos it has a branch in (see
   * computePolyrepoMergeQueueFromCandidates).
   */
  features: readonly ReadyFeature[];
  /** Every configured member repo for the project. */
  repos: readonly ResolvedProjectRepo[];
  takenBranchNames?: readonly string[];
}

/**
 * One member repo's git, plus the two primitives per-feature atomicity needs.
 *
 * Without them the only way to un-apply a feature that failed in a later repo
 * is to rebuild every repo branch from base and replay the survivors — O(R×F²)
 * heavyweight git work, which for a 20-feature batch across 3 repos is hundreds
 * of merges and can hold the project's single-flight reconcile slot for hours.
 */
export interface PolyrepoRepoGit extends GenerationGitDeps {
  /** Current head of this repo's generation branch. */
  generationHeadSha(): Promise<string>;
  /** Move this repo's generation branch back to a previously captured head. */
  resetGenerationTo(sha: string): Promise<void>;
}

export interface PolyrepoAssembleDeps {
  /** One PolyrepoRepoGit per repoKey — see buildPolyrepoGitDeps. */
  repoGit: ReadonlyMap<string, PolyrepoRepoGit>;
  store: GenerationStorePort;
  /**
   * The assembly agent, called mid-conflict with the conflicting repo named in
   * `repoKey`. Absent hook = every conflict is held out.
   */
  resolveConflict?: (ctx: ConflictContext) => Promise<ConflictResolutionResult | null>;
  log?: (msg: string) => void;
}

/** A feature's merge outcome inside one repo during a single assembly pass. */
interface RepoMergeOutcome {
  repoKey: string;
  headSha: string;
  mergeOrderInRepo: number;
  resolution?: ConflictResolutionResult;
  /** Union-lint renumbering applied on this repo's branch (PAN-3166). */
  renumber?: { files: string[]; commitSha: string; note: string };
  conflictingIssueIds: string[];
}

/** A feature that could not be applied everywhere and is held out globally. */
interface BlockedFeature {
  issueId: string;
  /** The repo that rejected it. */
  repoKey: string;
  branch: string;
  reason: string;
}

/** Everything the assembly pass produced. */
interface AssemblyPass {
  /** Per-repo base SHA and worktree, in merge order. */
  repos: UatGenerationRepo[];
  /** issueId → the repos it merged cleanly into. */
  mergedByIssue: Map<string, RepoMergeOutcome[]>;
  /** A repo-level failure (worktree creation, failed rollback) aborts the generation. */
  fatal: string | null;
}

const SHORT_SHA_LENGTH = 7;

/**
 * `fe@abc1234 api@def5678` — the one anchor format for every per-repo SHA
 * tuple. Base anchors, member anchors, and the reconciler's live anchors are
 * all built here: the reconciler decides staleness by STRING EQUALITY against
 * what assembly stored, so any two producers that disagree on ordering or SHA
 * length would make every generation look permanently stale and reassemble
 * forever.
 */
export function compositeAnchor(
  entries: ReadonlyArray<{ repoKey: string; sha: string; mergeOrder: number }>,
): string {
  return [...entries]
    .sort((a, b) => a.mergeOrder - b.mergeOrder || a.repoKey.localeCompare(b.repoKey))
    .map((e) => `${e.repoKey}@${e.sha.slice(0, SHORT_SHA_LENGTH)}`)
    .join(' ');
}

/** The generation's base anchor, across the repos it branched. */
export function compositeBaseAnchor(repos: readonly UatGenerationRepo[]): string {
  return compositeAnchor(repos.map((r) => ({ repoKey: r.repoKey, sha: r.baseSha, mergeOrder: r.mergeOrder })));
}

/**
 * One member's anchor, across the repos it contributed to, ordered by repoKey.
 *
 * Deliberately NOT ordered by merge order: assembly knows `mergeOrderInRepo`
 * (position within one repo's own sequence) while the reconciler only has the
 * repo's configured order, and those are different numbers. Sorting on a field
 * only one side can compute would silently yield two different strings for the
 * same state, so every generation would read stale and reassemble forever.
 * repoKey is available to both and is stable.
 */
export function compositeMemberAnchor(
  repos: ReadonlyArray<{ repoKey: string; headSha: string }>,
): string {
  return [...repos]
    .sort((a, b) => a.repoKey.localeCompare(b.repoKey))
    .map((r) => `${r.repoKey}@${r.headSha.slice(0, SHORT_SHA_LENGTH)}`)
    .join(' ');
}

/**
 * Composite anchor over every repo a held-out feature contributes to, in the
 * same shape a merged member gets, so the reconciler's per-feature anchor can
 * be compared against it by string equality.
 */
async function heldOutAnchor(
  feature: ReadyFeature | undefined,
  deps: PolyrepoAssembleDeps,
): Promise<string> {
  const contributions = feature?.repoContributions ?? [];
  if (contributions.length === 0) return 'unknown';

  const entries = await Promise.all(
    contributions.map(async (c) => ({
      repoKey: c.repoKey,
      headSha: await deps.repoGit.get(c.repoKey)?.branchHeadSha(c.branch).catch(() => 'unknown') ?? 'unknown',
    })),
  );
  return compositeMemberAnchor(entries);
}

/** Repos some feature contributes to, in configured merge order. */
function contributingRepos(
  features: readonly ReadyFeature[],
  repos: readonly ResolvedProjectRepo[],
): ResolvedProjectRepo[] {
  const touched = new Set<string>();
  for (const feature of features) {
    for (const contribution of feature.repoContributions ?? []) touched.add(contribution.repoKey);
  }
  return repos
    .filter((repo) => touched.has(repo.repoKey))
    .sort((a, b) => a.mergeOrder - b.mergeOrder || a.repoKey.localeCompare(b.repoKey));
}

function contributionFor(feature: ReadyFeature, repoKey: string) {
  return (feature.repoContributions ?? []).find((c) => c.repoKey === repoKey);
}

function conflictingWith(feature: ReadyFeature, mergedIssueIds: readonly string[]): string[] {
  const merged = new Set(mergedIssueIds.map((id) => id.toUpperCase()));
  return (feature.conflictsWith ?? []).filter((id) => merged.has(id.toUpperCase()));
}

/**
 * Assemble one polyrepo generation. Always returns the generation row (status
 * 'ready' or 'failed'); throws only on store failures. On success, older
 * 'ready' generations for the project flip to 'superseded'.
 */
export async function assemblePolyrepoUatGeneration(
  input: PolyrepoAssembleInput,
  deps: PolyrepoAssembleDeps,
): Promise<UatGeneration> {
  const log = deps.log ?? (() => {});
  const name = makeUniqueUatCandidateName(
    { label: input.label, dateIso: input.dateIso },
    [...deps.store.listNames(), ...(input.takenBranchNames ?? [])],
  );
  const worktreePath = `${input.projectRoot}/workspaces/${generationFolderName(name)}`;
  const repoWorktree = (repoKey: string) => `${worktreePath}/${repoKey}`;

  deps.store.insert({
    name,
    worktreePath,
    projectRoot: input.projectRoot,
    baseSha: '',
    status: 'assembling',
    repos: [],
    members: [],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    cleanedAt: null,
  });

  const heldOut: UatGenerationHeldOut[] = [];
  const heldOutIds = new Set<string>();

  /**
   * Base SHA per repo, accumulated across passes. The generation's base anchor
   * covers every repo the INPUT features contribute to, not just the repos the
   * final pass branched: a hold-out can drop a repo, and if the anchor shrank
   * with it the reconciler — which derives its anchor from the ready set —
   * could never match, so it would rebuild the same generation every tick.
   */
  const baseShaByRepo = new Map<string, string>();

  const finish = (
    status: UatGenerationStatus,
    repos: UatGenerationRepo[],
    members: UatGenerationMember[],
    resolutions: UatGenerationResolution[],
    anchorRepos?: readonly ResolvedProjectRepo[],
  ): UatGeneration => {
    const baseSha = anchorRepos
      ? compositeAnchor(
          anchorRepos
            .filter((r) => baseShaByRepo.has(r.repoKey))
            .map((r) => ({ repoKey: r.repoKey, sha: baseShaByRepo.get(r.repoKey)!, mergeOrder: r.mergeOrder })),
        )
      : compositeBaseAnchor(repos);
    deps.store.update(name, { status, baseSha, repos, members, heldOut, resolutions });
    return {
      name, worktreePath, projectRoot: input.projectRoot, baseSha,
      status, repos, members, heldOut, resolutions,
      stackStartedAt: null, cleanedAt: null, createdAt: '', updatedAt: '',
    };
  };

  const allContributing = contributingRepos(input.features, input.repos);
  if (allContributing.length === 0) {
    log(`[uat-polyrepo] ${name}: no member repo has a contributing feature branch — marking failed`);
    return finish('failed', [], [], []);
  }
  log(`[uat-polyrepo] ${name}: assembling across ${allContributing.map((r) => r.repoKey).join(', ')}`);

  const missingDeps = allContributing.filter((repo) => !deps.repoGit.has(repo.repoKey));
  if (missingDeps.length > 0) {
    log(`[uat-polyrepo] ${name}: no git deps for repo(s) ${missingDeps.map((r) => r.repoKey).join(', ')} — marking failed`);
    return finish('failed', [], [], []);
  }

  // ONE pass, feature-atomic. Each feature is merged into every repo it
  // contributes to; if any repo rejects it, the repos that already took it are
  // rolled back to the head they had before that feature, and assembly moves on.
  // Earlier accepted features are never rebuilt, so the work is O(R x F) rather
  // than the O(R x F^2) a rebuild-and-replay design costs.
  const pass = await runAssemblyPass(name, input.features, allContributing, repoWorktree, deps, log, {
    onHeldOut: async (blocked) => {
      heldOutIds.add(blocked.issueId);
      // The reconciler compares a held-out feature's stored headSha against a
      // composite anchor over ALL its contributions, so storing the single
      // blocking repo's SHA would never match and would churn the generation
      // every tick. Record the same composite shape members use.
      const blockedFeature = input.features.find((f) => f.issueId === blocked.issueId);
      heldOut.push({
        issueId: blocked.issueId,
        // The LOGICAL feature branch, not the blocking repo's contribution
        // branch: the reconciler keys its head anchors by ReadyFeature.branch,
        // and a repo with a custom branch_prefix (feat/ vs feature/) would make
        // that lookup miss forever and rebuild the generation every tick. The
        // blocking repo is already named in the reason.
        branch: blockedFeature?.branch ?? blocked.branch,
        headSha: await heldOutAnchor(blockedFeature, deps),
        reason: blocked.reason,
      });
      deps.store.update(name, { heldOut });
      log(`[uat-polyrepo] ${name}: holding ${blocked.issueId} out of the whole generation (${blocked.repoKey})`);
    },
  });
  for (const repo of pass.repos) baseShaByRepo.set(repo.repoKey, repo.baseSha);

  if (pass.fatal) {
    log(`[uat-polyrepo] ${name}: ${pass.fatal}`);
    return finish('failed', pass.repos, [], []);
  }

  // A repo every one of whose features was held out carries nothing. Its
  // worktree and branch exist locally but are never pushed; cleanup reaps them
  // with the generation folder.
  const carrying = new Set([...pass.mergedByIssue.values()].flat().map((o) => o.repoKey));
  const abandoned = pass.repos.filter((r) => !carrying.has(r.repoKey));
  if (abandoned.length > 0) {
    log(`[uat-polyrepo] ${name}: repo(s) ${abandoned.map((r) => r.repoKey).join(', ')} lost every contribution to a hold-out — no branch published; local worktree reaped with the generation folder`);
  }
  const publishedRepos = pass.repos.filter((r) => carrying.has(r.repoKey));

  const { members, resolutions } = collectMembers(input.features, heldOutIds, pass.mergedByIssue);

  if (members.length === 0) {
    // Anchor on the full candidate set even though nothing published: the
    // reconciler's desired anchor covers every ready-set contribution, and
    // FAILED_RETRY_BACKOFF_MS only suppresses a repeat when the two signatures
    // match exactly. Without it an all-held-out batch reassembles every tick.
    log(`[uat-polyrepo] ${name}: nothing merged (${heldOut.length} held out) — marking failed`);
    return finish('failed', publishedRepos, [], [], allContributing);
  }

  // Push every repo. A partial push is recoverable — cleanup reaps the branches
  // that did land — but the generation is not testable, so it is failed.
  for (const repo of publishedRepos) {
    try {
      await deps.repoGit.get(repo.repoKey)!.push(name);
    } catch (err) {
      log(`[uat-polyrepo] ${name}: push failed in ${repo.repoKey}: ${err instanceof Error ? err.message : String(err)}`);
      return finish('failed', publishedRepos, members, resolutions);
    }
  }

  for (const older of deps.store.listChain(input.projectRoot, ['ready'])) {
    if (older.name !== name) deps.store.update(older.name, { status: 'superseded' });
  }

  log(`[uat-polyrepo] ${name}: ready — ${members.length} member(s) across ${publishedRepos.length} repo(s), ${resolutions.length} resolution(s), ${heldOut.length} held out`);
  return finish('ready', publishedRepos, members, resolutions, allContributing);
}

/**
 * Build every repo's branch from base, then apply features one at a time.
 *
 * A feature is applied to every repo it contributes to or to none: if a later
 * repo rejects it, the repos that already merged it are reset to the head they
 * had before, and it is reported held out. Accepted features are never
 * disturbed, so total git work is linear in (repos x features).
 */
async function runAssemblyPass(
  name: string,
  features: readonly ReadyFeature[],
  active: readonly ResolvedProjectRepo[],
  repoWorktree: (repoKey: string) => string,
  deps: PolyrepoAssembleDeps,
  log: (msg: string) => void,
  hooks: { onHeldOut: (blocked: BlockedFeature) => Promise<void> },
): Promise<AssemblyPass> {
  const repos: UatGenerationRepo[] = [];
  const mergedByIssue = new Map<string, RepoMergeOutcome[]>();
  /** Merge count per repo, which is that repo's mergeOrderInRepo counter. */
  const mergedInRepo = new Map<string, string[]>();
  /** Union lint state per repo (PAN-3166) — absent when the repo's deps omit it. */
  const ledgers = new Map<string, MigrationVersionLedger>();

  for (const repo of active) {
    const git = deps.repoGit.get(repo.repoKey)!;
    const path = repoWorktree(repo.repoKey);

    let baseSha: string;
    try {
      baseSha = await git.fetchMain();
      await git.createWorktree(name, path);
    } catch (err) {
      return {
        repos,
        mergedByIssue,
        fatal: `worktree creation failed in ${repo.repoKey}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    repos.push({
      repoKey: repo.repoKey,
      repoPath: repo.repoPath,
      branch: name,
      baseSha,
      // Persisted so promote merges back into the branch this was cut from,
      // rather than assuming main long after assembly.
      targetBranch: repo.targetBranch,
      worktreePath: path,
      mergeOrder: repo.mergeOrder,
      promotedAt: null,
      mergeSha: null,
    });
    mergedInRepo.set(repo.repoKey, []);

    // Union lint (PAN-3166), per repo: owners from this repo's freshly cut
    // branch, reservations from every contributing candidate branch in THIS
    // repo. A read failure is fatal to the assembly rather than silently
    // disabling the lint.
    try {
      const candidates = features
        .map((feature) => contributionFor(feature, repo.repoKey)?.branch)
        .filter((branch): branch is string => Boolean(branch));
      const ledger = await seedUnionLedger(git, name, candidates);
      if (ledger) ledgers.set(repo.repoKey, ledger);
    } catch (err) {
      return {
        repos,
        mergedByIssue,
        fatal: `union lint could not read migrations in ${repo.repoKey}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  for (const feature of features) {
    const targets = active.filter((repo) => contributionFor(feature, repo.repoKey));
    if (targets.length === 0) continue;

    // Union lint (PAN-3166) — planned for every repo BEFORE any merge, so a
    // hold-out costs one `git ls-tree` per repo and never needs the rollback
    // machinery. A hold-out is global here, exactly like a merge conflict: one
    // repo's colliding migration keeps the whole feature out of the generation.
    const plans = new Map<string, UnionLintPlan>();
    let unionCollision: BlockedFeature | null = null;
    for (const repo of targets) {
      const contribution = contributionFor(feature, repo.repoKey)!;
      const plan = await planUnionLint({
        git: deps.repoGit.get(repo.repoKey)!,
        ledger: ledgers.get(repo.repoKey) ?? null,
        generationBranch: name,
        featureBranch: contribution.branch,
        issueId: feature.issueId,
      });
      plans.set(repo.repoKey, plan);
      if (plan.disposition.kind === 'hold-out') {
        unionCollision = {
          issueId: feature.issueId,
          repoKey: repo.repoKey,
          branch: contribution.branch,
          reason: `${plan.disposition.reason} (in ${repo.repoKey})`,
        };
        break;
      }
    }
    if (unionCollision) {
      log(`[uat-polyrepo] ${name}: holding ${feature.issueId} out — ${unionCollision.reason}`);
      await hooks.onHeldOut(unionCollision);
      continue;
    }

    // Capture each target's head BEFORE this feature, so a partial application
    // can be undone without rebuilding the branch from base.
    const snapshots = new Map<string, string>();
    let snapshotFailure: string | null = null;
    for (const repo of targets) {
      try {
        snapshots.set(repo.repoKey, await deps.repoGit.get(repo.repoKey)!.generationHeadSha());
      } catch (err) {
        snapshotFailure = `could not read ${repo.repoKey} head: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }
    if (snapshotFailure) {
      await hooks.onHeldOut({
        issueId: feature.issueId,
        repoKey: targets[0]!.repoKey,
        branch: contributionFor(feature, targets[0]!.repoKey)?.branch ?? feature.branch,
        reason: snapshotFailure,
      });
      continue;
    }

    const applied: RepoMergeOutcome[] = [];
    let blocked: BlockedFeature | null = null;

    for (const repo of targets) {
      const contribution = contributionFor(feature, repo.repoKey)!;
      const git = deps.repoGit.get(repo.repoKey)!;
      const outcome = await mergeOneFeature({
        name,
        feature,
        featureBranch: contribution.branch,
        repoKey: repo.repoKey,
        worktreePath: repoWorktree(repo.repoKey),
        mergedIssueIds: mergedInRepo.get(repo.repoKey) ?? [],
        mergeOrderInRepo: (mergedInRepo.get(repo.repoKey)?.length ?? 0) + 1,
        git,
      }, deps, log);

      if ('reason' in outcome) {
        blocked = {
          issueId: feature.issueId,
          repoKey: repo.repoKey,
          branch: contribution.branch,
          reason: `${outcome.reason} (in ${repo.repoKey})`,
        };
        break;
      }
      applied.push(outcome);

      // The renumbering can only land once the merge brought the files onto
      // this repo's branch. It is committed ABOVE the snapshot taken before
      // this feature, so the rollback below removes it with everything else —
      // a rolled-back feature never leaves an orphaned rename behind.
      const plan = plans.get(repo.repoKey);
      if (plan) {
        try {
          const renumber = await applyUnionLintPlan(git, plan, feature.issueId);
          if (renumber) {
            outcome.renumber = renumber;
            log(`[uat-polyrepo] ${name}: renumbered ${feature.issueId} migrations in ${repo.repoKey} — ${renumber.note}`);
          } else if (plan.disposition.kind === 'renumber') {
            blocked = {
              issueId: feature.issueId,
              repoKey: repo.repoKey,
              branch: contribution.branch,
              reason: `migration renumbering is required but no rename primitive is wired (in ${repo.repoKey})`,
            };
            break;
          }
        } catch (err) {
          blocked = {
            issueId: feature.issueId,
            repoKey: repo.repoKey,
            branch: contribution.branch,
            reason: `migration renumbering failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)} (in ${repo.repoKey})`,
          };
          break;
        }
      }
    }

    if (blocked) {
      // Roll the repos that took it back to their pre-feature head. A failure
      // here cannot be ignored: the branch would carry a feature recorded as
      // held out, so the generation is abandoned rather than shipped wrong.
      for (const outcome of applied) {
        const snapshot = snapshots.get(outcome.repoKey)!;
        try {
          await deps.repoGit.get(outcome.repoKey)!.resetGenerationTo(snapshot);
        } catch (err) {
          return {
            repos,
            mergedByIssue,
            fatal:
              `could not roll ${outcome.repoKey} back to ${snapshot.slice(0, 9)} after holding out ` +
              `${feature.issueId}: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
      await hooks.onHeldOut(blocked);
      continue;
    }

    // Only now, with the feature accepted in EVERY repo it contributes to, is
    // it attributed in the ledgers — and by its POST-rename paths. Recording
    // per repo as the loop went would leave a half-recorded rename behind when
    // a later repo rejected the feature and rolled the earlier ones back.
    for (const outcome of applied) {
      mergedInRepo.get(outcome.repoKey)!.push(feature.issueId);
      const plan = plans.get(outcome.repoKey);
      if (plan) ledgers.get(outcome.repoKey)?.record(plannedFiles(plan), feature.issueId);
    }
    mergedByIssue.set(feature.issueId, applied);
  }

  return { repos, mergedByIssue, fatal: null };
}

interface MergeOneFeatureArgs {
  name: string;
  feature: ReadyFeature;
  featureBranch: string;
  repoKey: string;
  /** This repo's worktree — the mid-conflict state the hook edits. */
  worktreePath: string;
  mergedIssueIds: readonly string[];
  mergeOrderInRepo: number;
  git: GenerationGitDeps;
}

/** Merge one feature into one repo's generation branch. */
async function mergeOneFeature(
  args: MergeOneFeatureArgs,
  deps: PolyrepoAssembleDeps,
  log: (msg: string) => void,
): Promise<RepoMergeOutcome | { reason: string; headSha: string }> {
  const { name, feature, featureBranch, repoKey, worktreePath, mergedIssueIds, mergeOrderInRepo, git } = args;
  const headSha = await git.branchHeadSha(featureBranch).catch(() => 'unknown');
  const conflictingIssueIds = conflictingWith(feature, mergedIssueIds);

  let result: Awaited<ReturnType<GenerationGitDeps['mergeBranch']>>;
  try {
    result = await git.mergeBranch(featureBranch);
  } catch (err) {
    await git.abortMerge().catch(() => {});
    return { headSha, reason: `merge failed: ${err instanceof Error ? (err.message.split('\n')[0] ?? 'merge failed') : String(err)}` };
  }

  if (result.ok) {
    return { repoKey, headSha, mergeOrderInRepo, conflictingIssueIds };
  }

  if (!result.conflict || !deps.resolveConflict) {
    await git.abortMerge().catch(() => {});
    return {
      headSha,
      reason: result.conflict
        ? `conflicts with ${conflictingIssueIds.join(', ') || 'an earlier member'} — no assembly agent available`
        : result.reason,
    };
  }

  log(`[uat-polyrepo] ${name}: resolving conflict in ${repoKey} ${feature.issueId} <-> ${conflictingIssueIds.join(', ') || '(unknown member)'}`);
  let resolution: ConflictResolutionResult | null = null;
  try {
    resolution = await deps.resolveConflict({
      feature,
      mergedIssueIds,
      conflictingIssueIds,
      branchName: name,
      worktreePath,
      repoKey,
    });
  } catch (err) {
    log(`[uat-polyrepo] ${name}: conflict agent threw in ${repoKey}: ${err instanceof Error ? err.message : String(err)}`);
    resolution = null;
  }

  if (!resolution) {
    await git.abortMerge().catch(() => {});
    return {
      headSha,
      reason: `conflict with ${conflictingIssueIds.join(', ') || 'an earlier member'} could not be auto-resolved — waits for the next generation`,
    };
  }

  return { repoKey, headSha, mergeOrderInRepo, resolution, conflictingIssueIds };
}

/**
 * Fold the accepted pass into store-shaped members and resolutions, preserving
 * the ready-set order so mergeOrder reads the same as the monorepo path.
 */
function collectMembers(
  features: readonly ReadyFeature[],
  heldOutIds: ReadonlySet<string>,
  mergedByIssue: ReadonlyMap<string, RepoMergeOutcome[]>,
): { members: UatGenerationMember[]; resolutions: UatGenerationResolution[] } {
  const members: UatGenerationMember[] = [];
  const resolutions: UatGenerationResolution[] = [];

  for (const feature of features) {
    if (heldOutIds.has(feature.issueId)) continue;
    const outcomes = mergedByIssue.get(feature.issueId);
    if (!outcomes || outcomes.length === 0) continue;

    const repos: UatGenerationMemberRepo[] = outcomes.map((o) => ({
      repoKey: o.repoKey,
      branch: contributionFor(feature, o.repoKey)?.branch ?? feature.branch,
      headSha: o.headSha,
      mergeOrderInRepo: o.mergeOrderInRepo,
    }));

    members.push({
      issueId: feature.issueId,
      title: feature.title,
      branch: feature.branch,
      // The generation row keeps ONE headSha per member, which the reconciler
      // compares by string equality to decide staleness — so for a polyrepo
      // member it must be the composite anchor over every repo it touched, not
      // one repo's SHA. Per-repo SHAs are also kept individually in `repos`.
      headSha: compositeMemberAnchor(repos),
      mergeOrder: members.length + 1,
      ...(feature.pr !== undefined ? { pr: feature.pr } : {}),
      ...(feature.prUrl !== undefined ? { prUrl: feature.prUrl } : {}),
      repos,
    });

    for (const outcome of outcomes) {
      if (outcome.resolution) {
        resolutions.push({
          issueIds: [feature.issueId, ...outcome.conflictingIssueIds],
          files: outcome.resolution.files,
          commitSha: outcome.resolution.commitSha,
          kind: 'conflict',
        });
      }
      if (outcome.renumber) {
        resolutions.push({
          issueIds: [feature.issueId],
          files: outcome.renumber.files,
          commitSha: outcome.renumber.commitSha,
          kind: 'migration-renumber',
          note: `${outcome.renumber.note} (in ${outcome.repoKey})`,
        });
      }
    }
  }

  return { members, resolutions };
}
