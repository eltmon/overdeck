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
 *   - **Replay, not excision.** Removing an already-merged commit from the
 *     middle of a branch is fragile, so a hold-out instead restarts assembly
 *     with the remaining features. Each pass drops at least one feature, so the
 *     loop is bounded by the feature count.
 *
 * Pure orchestrator: all git and store I/O is injected, so every path — happy,
 * conflict-resolved, held-out, push-failed — is unit-testable with fake deps.
 */

import { makeUatCandidateName } from './uat-candidate-name.js';
import { generationFolderName } from './uat-generation-engine.js';
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
}

export interface PolyrepoAssembleDeps {
  /** One GenerationGitDeps per repoKey — see buildPolyrepoGitDeps. */
  repoGit: ReadonlyMap<string, GenerationGitDeps>;
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
  conflictingIssueIds: string[];
}

/** Everything one assembly pass produced, before it is accepted or replayed. */
interface AssemblyPass {
  /** Per-repo base SHA and worktree, in merge order. */
  repos: UatGenerationRepo[];
  /** issueId → the repos it merged cleanly into. */
  mergedByIssue: Map<string, RepoMergeOutcome[]>;
  /** The first feature that failed in some repo, which forces a replay. */
  blocked: { issueId: string; repoKey: string; branch: string; headSha: string; reason: string } | null;
  /** A repo-level failure (worktree creation) aborts the whole generation. */
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
  const name = makeUatCandidateName({ label: input.label, dateIso: input.dateIso });
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

  const finish = (
    status: UatGenerationStatus,
    repos: UatGenerationRepo[],
    members: UatGenerationMember[],
    resolutions: UatGenerationResolution[],
  ): UatGeneration => {
    const baseSha = compositeBaseAnchor(repos);
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

  /** Repos that had a worktree built in any pass, including abandoned ones. */
  const everTouched = new Set<string>();

  // Each pass either succeeds outright or drops one feature and replays, so the
  // loop cannot run more times than there are features.
  let pass: AssemblyPass | null = null;
  for (let attempt = 0; attempt <= input.features.length; attempt++) {
    const remaining = input.features.filter((f) => !heldOutIds.has(f.issueId));
    if (remaining.length === 0) break;

    // Recomputed per pass: holding a feature out can leave a repo with nothing
    // to contribute, and such a repo must get no branch at all.
    const active = contributingRepos(remaining, input.repos);
    for (const repo of active) everTouched.add(repo.repoKey);

    pass = await runAssemblyPass(name, remaining, active, repoWorktree, deps, log);

    if (pass.fatal) {
      log(`[uat-polyrepo] ${name}: ${pass.fatal}`);
      return finish('failed', pass.repos, [], []);
    }

    if (!pass.blocked) break;

    const { issueId, repoKey, branch, headSha, reason } = pass.blocked;
    heldOutIds.add(issueId);
    heldOut.push({ issueId, branch, headSha, reason });
    deps.store.update(name, { heldOut });
    log(`[uat-polyrepo] ${name}: holding ${issueId} out of the whole generation (${repoKey}); replaying ${input.features.length - heldOutIds.size} feature(s)`);
    pass = null;
  }

  if (!pass) {
    log(`[uat-polyrepo] ${name}: every feature held out — marking failed`);
    return finish('failed', [], [], []);
  }

  // A repo can be dropped between passes once the feature that needed it is
  // held out. Its worktree lives inside the generation folder and its branch was
  // never pushed, but cleanup must know the local artifacts exist.
  const abandoned = [...everTouched].filter((key) => !pass!.repos.some((r) => r.repoKey === key));
  if (abandoned.length > 0) {
    log(`[uat-polyrepo] ${name}: repo(s) ${abandoned.join(', ')} lost every contribution to a hold-out — no branch published; local worktree reaped with the generation folder`);
  }

  const { members, resolutions } = collectMembers(input.features, heldOutIds, pass.mergedByIssue);

  if (members.length === 0) {
    log(`[uat-polyrepo] ${name}: nothing merged (${heldOut.length} held out) — marking failed`);
    return finish('failed', pass.repos, [], []);
  }

  // Push every repo. A partial push is recoverable — cleanup reaps the branches
  // that did land — but the generation is not testable, so it is failed.
  for (const repo of pass.repos) {
    try {
      await deps.repoGit.get(repo.repoKey)!.push(name);
    } catch (err) {
      log(`[uat-polyrepo] ${name}: push failed in ${repo.repoKey}: ${err instanceof Error ? err.message : String(err)}`);
      return finish('failed', pass.repos, members, resolutions);
    }
  }

  for (const older of deps.store.listChain(input.projectRoot, ['ready'])) {
    if (older.name !== name) deps.store.update(older.name, { status: 'superseded' });
  }

  log(`[uat-polyrepo] ${name}: ready — ${members.length} member(s) across ${pass.repos.length} repo(s), ${resolutions.length} resolution(s), ${heldOut.length} held out`);
  return finish('ready', pass.repos, members, resolutions);
}

/**
 * Build every repo's branch from base and merge the given features in order.
 * Stops at the first feature that cannot land in some repo and reports it, so
 * the caller can hold it out globally and replay.
 */
async function runAssemblyPass(
  name: string,
  features: readonly ReadyFeature[],
  active: readonly ResolvedProjectRepo[],
  repoWorktree: (repoKey: string) => string,
  deps: PolyrepoAssembleDeps,
  log: (msg: string) => void,
): Promise<AssemblyPass> {
  const repos: UatGenerationRepo[] = [];
  const mergedByIssue = new Map<string, RepoMergeOutcome[]>();

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
        blocked: null,
        fatal: `worktree creation failed in ${repo.repoKey}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    repos.push({
      repoKey: repo.repoKey,
      repoPath: repo.repoPath,
      branch: name,
      baseSha,
      worktreePath: path,
      mergeOrder: repo.mergeOrder,
      promotedAt: null,
    });

    const mergedHere: string[] = [];
    for (const feature of features) {
      const contribution = contributionFor(feature, repo.repoKey);
      if (!contribution) continue;

      const outcome = await mergeOneFeature({
        name,
        feature,
        featureBranch: contribution.branch,
        repoKey: repo.repoKey,
        worktreePath: path,
        mergedIssueIds: mergedHere,
        mergeOrderInRepo: mergedHere.length + 1,
        git,
      }, deps, log);
      if ('reason' in outcome) {
        return {
          repos,
          mergedByIssue,
          blocked: {
            issueId: feature.issueId,
            repoKey: repo.repoKey,
            branch: contribution.branch,
            headSha: outcome.headSha,
            reason: `${outcome.reason} (in ${repo.repoKey})`,
          },
          fatal: null,
        };
      }

      mergedHere.push(feature.issueId);
      mergedByIssue.set(feature.issueId, [...(mergedByIssue.get(feature.issueId) ?? []), outcome]);
    }
  }

  return { repos, mergedByIssue, blocked: null, fatal: null };
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
      if (!outcome.resolution) continue;
      resolutions.push({
        issueIds: [feature.issueId, ...outcome.conflictingIssueIds],
        files: outcome.resolution.files,
        commitSha: outcome.resolution.commitSha,
      });
    }
  }

  return { members, resolutions };
}
