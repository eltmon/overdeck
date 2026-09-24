import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import type { FlywheelPipelineItem } from '@overdeck/contracts';
import { resolveGitHubIssue } from './tracker-utils.js';
import { compileGlob, type CompiledGlob } from './xbrief/dag.js';
import { findProjectByPath, getProjectSwarmHotspots } from './projects.js';
import type { ResolvedProjectRepo } from './project-repos.js';

export interface MergeQueueItem {
  issueId: string;
  title: string;
  branchName: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  conflictsWith: string[];
  /** PAN-1691: 'batch' = disjoint, mergeable together in one pass; 'serialize' = conflicts, must go one at a time. */
  batchGroup?: 'batch' | 'serialize';
}

function issueNumber(issueId: string): number {
  const match = issueId.match(/\d+$/);
  return match ? parseInt(match[0], 10) : 0;
}

export interface MergeCandidateMeta {
  issueId: string;
  /** Number of files this branch changes vs main. */
  footprint: number;
  /** How many other ready branches this one overlaps files with. */
  conflictCount: number;
}

export type FootprintSource = 'declared' | 'actual';

export interface IssueFileFootprint {
  issueId: string;
  files: Iterable<string>;
  source: FootprintSource;
}

export interface PredictedConflictSignal extends MergeCandidateMeta {
  source: FootprintSource;
  conflictsWith: string[];
}

/**
 * PAN-1691 conflict-aware merge order. Disjoint (no-conflict) items come first
 * so they can batch through in a single verification pass; then conflicting
 * items broadest-file-footprint first, so the remaining cluster members rebase
 * once onto the worst offender instead of repeatedly. Issue number is the
 * stable tiebreak within each tier. Pure — exported for testing.
 */
export function orderMergeCandidates<T extends MergeCandidateMeta>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => {
    const aConf = a.conflictCount > 0 ? 1 : 0;
    const bConf = b.conflictCount > 0 ? 1 : 0;
    if (aConf !== bConf) return aConf - bConf;
    if (aConf === 1 && a.footprint !== b.footprint) return b.footprint - a.footprint;
    return issueNumber(a.issueId) - issueNumber(b.issueId);
  });
}

export interface MergeTrainPlan {
  /** Disjoint candidates that can merge together in one verification pass. */
  batch: string[];
  /** Conflicting candidates that must serialize, broadest-footprint first. */
  serialize: string[];
  /** Full ordered list (batch, then serialize). */
  order: string[];
}

function pathMatchesAnyCompiled(filePath: string, patterns: CompiledGlob[]): boolean {
  return patterns.some(pattern => pattern.regex.test(filePath) || pattern.exactDirectory === filePath);
}

function normalizedFootprintFiles(files: Iterable<string>, hotspots: CompiledGlob[]): Set<string> {
  const normalized = new Set<string>();
  for (const file of files) {
    if (!file || pathMatchesAnyCompiled(file, hotspots)) continue;
    normalized.add(file);
  }
  return normalized;
}

function sourcePriority(source: FootprintSource): number {
  return source === 'actual' ? 2 : 1;
}

export function computePredictedConflictSignals(
  footprints: ReadonlyArray<IssueFileFootprint>,
  options: { hotspots?: string[] } = {},
): PredictedConflictSignal[] {
  const hotspots = (options.hotspots ?? []).map(compileGlob);
  const byIssue = new Map<string, { issueId: string; source: FootprintSource; files: Set<string> }>();

  for (const footprint of footprints) {
    const files = normalizedFootprintFiles(footprint.files, hotspots);
    const current = byIssue.get(footprint.issueId);
    if (!current || sourcePriority(footprint.source) > sourcePriority(current.source)) {
      byIssue.set(footprint.issueId, { issueId: footprint.issueId, source: footprint.source, files });
      continue;
    }
    if (sourcePriority(footprint.source) === sourcePriority(current.source)) {
      for (const file of files) current.files.add(file);
    }
  }

  const conflictsMap = new Map<string, Set<string>>();
  const entries = Array.from(byIssue.values());
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i]!;
      const right = entries[j]!;
      if (![...left.files].some(file => right.files.has(file))) continue;
      if (!conflictsMap.has(left.issueId)) conflictsMap.set(left.issueId, new Set());
      if (!conflictsMap.has(right.issueId)) conflictsMap.set(right.issueId, new Set());
      conflictsMap.get(left.issueId)!.add(right.issueId);
      conflictsMap.get(right.issueId)!.add(left.issueId);
    }
  }

  return entries.map(entry => {
    const conflictsWith = [...(conflictsMap.get(entry.issueId) ?? [])]
      .sort((a, b) => issueNumber(a) - issueNumber(b));
    return {
      issueId: entry.issueId,
      source: entry.source,
      footprint: entry.files.size,
      conflictCount: conflictsWith.length,
      conflictsWith,
    };
  });
}

export interface UatCandidatePlan {
  /** Branch name for the on-demand UAT candidate (auto-merge-OFF mode). */
  branchName: string;
  /** Issue IDs bundled onto the candidate — the disjoint, mergeable-together batch. */
  bundled: string[];
}

const branchExists = (branch: string, cwd: string) =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cmd = ChildProcess.make('git', ['rev-parse', '--verify', branch], { cwd });
    return yield* spawner.exitCode(cmd).pipe(
      Effect.map((code) => code === 0),
      Effect.orElseSucceed(() => false),
    );
  });

export const changedFilesVsMain = (branch: string, cwd: string, base = 'main') =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const cmd = ChildProcess.make('git', ['diff', '--name-only', `${base}...${branch}`], { cwd });
    return yield* spawner.string(cmd).pipe(
      Effect.map((stdout) => new Set(stdout.trim().split('\n').filter(Boolean))),
      Effect.orElseSucceed(() => new Set<string>()),
    );
  });

const MERGE_QUEUE_GIT_CONCURRENCY = 4;

export interface ComputeMergeQueueOptions {
  getPrUrl?: (item: { issueId: string; pr?: number }) => string | undefined;
  gitConcurrency?: number;
  /** Called for each verb-tagged item the eligibility gate rejects. */
  onIneligible?: (issueId: string, reason: string) => void;
  /** Files treated as common hotspots and excluded from predicted-conflict math. */
  hotspots?: string[];
}

/**
 * Server-side PR URL resolution for merge-queue items: the GitHub repo plus
 * the candidate's PR number — the browser never guesses repo slugs.
 */
export function resolveMergeQueuePrUrl(item: { issueId: string; pr?: number }): string | undefined {
  if (item.pr === undefined) return undefined;
  const githubIssue = resolveGitHubIssue(item.issueId.toUpperCase());
  if (!githubIssue.isGitHub) return undefined;
  return `https://github.com/${githubIssue.owner}/${githubIssue.repo}/pull/${item.pr}`;
}

/**
 * PAN-1696 ready-set-source: Compute merge queue from a pre-filtered candidate list.
 * Accepts candidates from review-status or flywheel pipeline — decouples the source.
 * This refactored version extracts the core conflict-analysis logic from computeMergeQueue.
 */
export const computeMergeQueueFromCandidates = (
  candidates: ReadonlyArray<{ issueId: string; title: string; pr?: number }>,
  projectRoot: string,
  options: ComputeMergeQueueOptions = {},
) =>
  Effect.gen(function*() {
    if (candidates.length === 0) return [] as MergeQueueItem[];
    const gitConcurrency = Math.max(1, Math.floor(options.gitConcurrency ?? MERGE_QUEUE_GIT_CONCURRENCY));

    const branches = candidates.map((item) => `feature/${item.issueId.toLowerCase()}`);

    const existsFlags = yield* Effect.all(
      branches.map((branch) => branchExists(branch, projectRoot)),
      { concurrency: gitConcurrency },
    );

    const existing = candidates
      .map((item, i) => ({ item, branch: branches[i]!, exists: existsFlags[i]! }))
      .filter(({ exists }) => exists);

    if (existing.length === 0) return [] as MergeQueueItem[];

    const fileSets = yield* Effect.all(
      existing.map(({ branch }) => changedFilesVsMain(branch, projectRoot)),
      { concurrency: gitConcurrency },
    );
    const hotspots = options.hotspots ?? getProjectSwarmHotspots(findProjectByPath(projectRoot));
    const conflictSignals = computePredictedConflictSignals(
      existing.map((e, i) => ({ issueId: e.item.issueId, source: 'actual' as const, files: fileSets[i]! })),
      { hotspots },
    );
    const signalByIssue = new Map(conflictSignals.map(signal => [signal.issueId, signal]));
    const conflictsMap = new Map(conflictSignals.map(signal => [signal.issueId, new Set(signal.conflictsWith)]));

    const sorted = orderMergeCandidates(
      existing.map((e, i) => ({
        item: e.item,
        issueId: e.item.issueId,
        footprint: signalByIssue.get(e.item.issueId)?.footprint ?? fileSets[i]!.size,
        conflictCount: signalByIssue.get(e.item.issueId)?.conflictCount ?? 0,
      })),
    );

    return sorted.map(({ item, conflictCount }, idx) => ({
      issueId: item.issueId,
      title: item.title,
      branchName: `feature/${item.issueId.toLowerCase()}`,
      pr: item.pr,
      prUrl: options.getPrUrl?.(item),
      mergeOrder: idx + 1,
      conflictsWith: [...(conflictsMap.get(item.issueId) ?? [])],
      batchGroup: (conflictCount === 0 ? 'batch' : 'serialize') as 'batch' | 'serialize',
    }));
  });

/** One member repo a candidate actually has a feature branch in. */
export interface PolyrepoRepoContribution {
  repoKey: string;
  repoPath: string;
  /**
   * The LOGICAL feature branch, always `feature/<issue>` — never
   * origin-qualified. Assembly hands this straight to `GenerationGitDeps`,
   * whose `safeBranchName(branch, 'feature')` accepts only `feature/…` and
   * which already resolves origin-first internally. Passing `origin/feature/…`
   * here makes every merge throw and every feature get held out.
   */
  branch: string;
  /** Branch this repo merges into, from the repo's own config. */
  targetBranch: string;
  /** Configured merge order for this repo within the project. */
  mergeOrder: number;
}

export interface PolyrepoMergeQueueItem extends MergeQueueItem {
  repoContributions: PolyrepoRepoContribution[];
}

export interface ComputePolyrepoMergeQueueOptions extends ComputeMergeQueueOptions {
  /** Called for each candidate dropped because no member repo has its branch. */
  onExcluded?: (issueId: string, reason: string) => void;
  /**
   * Called once with the repo paths whose ref refresh failed, if any.
   *
   * An empty queue caused by an outage is NOT the same fact as a verified empty
   * ready set, and the caller must not conflate them: the reconciler treats an
   * empty array as authoritative, marks every live member departed, invalidates
   * the generation, and tears its stack down. A transport or auth blip would
   * then destroy the current testable batch even though no feature left the
   * queue. Callers should report unavailability (null) instead.
   */
  onRefreshUnavailable?: (repoPaths: readonly string[]) => void;
}

/** The `feature/` (or configured) namespace a source branch lives in. */
function branchNamespace(sourceBranch: string): string {
  const slash = sourceBranch.lastIndexOf('/');
  return slash >= 0 ? sourceBranch.slice(0, slash + 1) : '';
}

/**
 * Refresh every feature-branch tracking ref in one repo with ONE remote
 * negotiation, and report whether it succeeded.
 *
 * Three things this must get right, each of which caused a real defect:
 *
 *  - **One fetch per repo, not per candidate.** Fetching per candidate/repo pair
 *    performs F x R remote negotiations every reconciler minute, which on a
 *    large ready set can outrun the interval and hold the project's
 *    single-flight slot permanently.
 *  - **Force (`+`) the refspec.** Without it a force-with-lease rebase on the
 *    feature branch makes the update non-fast-forward, so the fetch fails and
 *    the stale tracking ref survives — assembly would then test and promote
 *    obsolete code.
 *  - **Prune.** A deleted remote branch must drop its tracking ref, or the
 *    probe keeps reporting a contribution that no longer exists.
 *
 * Returns false on ANY operational failure (transport, auth, bad repo). The
 * caller must fail closed: a stale ref is indistinguishable from a current one
 * once the fetch is gone, so silently continuing risks assembling old code.
 */
const refreshFeatureRefs = (namespaces: readonly string[], cwd: string) =>
  Effect.gen(function*() {
    if (namespaces.length === 0) return true;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const refspecs = namespaces.map((ns) => `+refs/heads/${ns}*:refs/remotes/origin/${ns}*`);
    const cmd = ChildProcess.make('git', ['fetch', '--prune', 'origin', ...refspecs], { cwd });
    return yield* spawner.exitCode(cmd).pipe(
      Effect.map((code) => Number(code) === 0),
      Effect.orElseSucceed(() => false),
    );
  });

/**
 * Origin-first feature-branch probe, matching branchHeadSha in
 * uat-generation-deps.ts: work agents push their branches, so the local ref can
 * lag or be missing entirely in a repo the operator never checked out.
 * Returns the ref that exists, or null when neither does.
 *
 * Purely local — refreshFeatureRefs has already contacted the remote for this
 * repo, so `git rev-parse origin/<branch>` now reads a ref that is known
 * current rather than whatever was cached.
 */
const resolveFeatureRef = (branch: string, repoPath: string) =>
  Effect.gen(function*() {
    const originRef = `origin/${branch}`;
    if (yield* branchExists(originRef, repoPath)) return originRef;
    if (yield* branchExists(branch, repoPath)) return branch;
    return null;
  });

/**
 * PAN-3093 polyrepo ready set. The monorepo sibling
 * (computeMergeQueueFromCandidates) derives one `feature/<issue>` branch and
 * runs git against one project root; a polyrepo candidate instead contributes
 * to some subset of the project's member repos, and only those repos with a
 * real feature branch belong in the generation.
 *
 * Conflict prediction runs over the union of each candidate's per-repo changed
 * files, prefixed `<repoKey>:` so the same path in two repos cannot read as an
 * overlap. Hotspot globs are applied per repo BEFORE prefixing — a glob like
 * `package.json` would never match `fe:package.json`.
 */
export const computePolyrepoMergeQueueFromCandidates = (
  candidates: ReadonlyArray<{ issueId: string; title: string; pr?: number }>,
  reposByIssue: ReadonlyMap<string, ReadonlyArray<ResolvedProjectRepo>>,
  projectRoot: string,
  options: ComputePolyrepoMergeQueueOptions = {},
) =>
  Effect.gen(function*() {
    if (candidates.length === 0) return [] as PolyrepoMergeQueueItem[];
    const gitConcurrency = Math.max(1, Math.floor(options.gitConcurrency ?? MERGE_QUEUE_GIT_CONCURRENCY));

    // A repo configured `readonly: true` (required === false) must never become
    // a UAT target: assembly pushes branches to it, promote pushes merges, and
    // cleanup deletes remote branches. Excluding it here keeps it out of every
    // one of those write paths.
    const perCandidate = candidates.map((item) => {
      const configured = reposByIssue.get(item.issueId) ?? [];
      return {
        item,
        configured,
        repos: configured.filter((repo) => repo.required),
        readOnlySkipped: configured.filter((repo) => !repo.required),
      };
    });

    // ONE remote refresh per repo, before any probing. Doing it per
    // candidate/repo pair made F x R remote negotiations every minute.
    const namespacesByRepo = new Map<string, { repoPath: string; namespaces: Set<string> }>();
    for (const entry of perCandidate) {
      for (const repo of entry.repos) {
        const existing = namespacesByRepo.get(repo.repoPath) ?? { repoPath: repo.repoPath, namespaces: new Set<string>() };
        existing.namespaces.add(branchNamespace(repo.sourceBranch));
        namespacesByRepo.set(repo.repoPath, existing);
      }
    }
    const refreshResults = yield* Effect.all(
      [...namespacesByRepo.values()].map(({ repoPath, namespaces }) =>
        refreshFeatureRefs([...namespaces], repoPath).pipe(
          Effect.map((ok) => ({ repoPath, ok })),
        ),
      ),
      { concurrency: gitConcurrency },
    );
    const staleRepoPaths = new Set(refreshResults.filter((r) => !r.ok).map((r) => r.repoPath));
    if (staleRepoPaths.size > 0) options.onRefreshUnavailable?.([...staleRepoPaths]);

    // One flat, concurrency-governed collection: nesting Effect.all inside
    // Effect.all applies the limit at both levels, making the real ceiling
    // gitConcurrency² git subprocesses per project.
    // Repos whose refresh failed are skipped entirely — their tracking refs may
    // be arbitrarily old, and a stale ref is indistinguishable from a current
    // one, so probing them could assemble obsolete code.
    const probeJobs = perCandidate.flatMap((entry, candidateIndex) =>
      entry.repos
        .filter((repo) => !staleRepoPaths.has(repo.repoPath))
        .map((repo) => ({ candidateIndex, repo })),
    );
    const probeResults = yield* Effect.all(
      probeJobs.map(({ candidateIndex, repo }) =>
        resolveFeatureRef(repo.sourceBranch, repo.repoPath).pipe(
          Effect.map((ref) => ({ candidateIndex, repo, ref })),
        ),
      ),
      { concurrency: gitConcurrency },
    );

    const foundByCandidate = perCandidate.map(() => [] as Array<{ repo: ResolvedProjectRepo; ref: string }>);
    for (const { candidateIndex, repo, ref } of probeResults) {
      if (ref !== null) foundByCandidate[candidateIndex]!.push({ repo, ref });
    }

    const resolved = perCandidate.map((entry, candidateIndex) => {
      const found = [...foundByCandidate[candidateIndex]!].sort(
        (a, b) => a.repo.mergeOrder - b.repo.mergeOrder || a.repo.repoKey.localeCompare(b.repo.repoKey),
      );
      return {
        ...entry,
        contributions: found.map(({ repo }) => ({
          repoKey: repo.repoKey,
          repoPath: repo.repoPath,
          // Logical name only — see PolyrepoRepoContribution.branch.
          branch: repo.sourceBranch,
          targetBranch: repo.targetBranch,
          mergeOrder: repo.mergeOrder,
        })) as PolyrepoRepoContribution[],
        // The resolved ref is for THIS function's diffing only; it never leaves
        // as part of the contribution contract.
        diffRefs: found.map(({ ref }) => ref),
      };
    });

    const contributing: Array<{
      item: typeof candidates[number];
      contributions: PolyrepoRepoContribution[];
      diffRefs: string[];
    }> = [];
    for (const entry of resolved) {
      // Fail closed. Including this candidate would assemble it from whatever
      // its unrefreshed repos happen to hold, and excluding only the failed repo
      // would silently build a partial batch from a feature that spans more.
      const unrefreshed = entry.repos.filter((repo) => staleRepoPaths.has(repo.repoPath));
      if (unrefreshed.length > 0) {
        options.onExcluded?.(
          entry.item.issueId,
          `could not refresh feature refs in ${unrefreshed.map((r) => r.repoKey).join(', ')} — ` +
          `excluding rather than risk assembling stale code`,
        );
        continue;
      }
      if (entry.contributions.length === 0) {
        const readOnlyNote = entry.readOnlySkipped.length > 0
          ? ` (${entry.readOnlySkipped.map((r) => r.repoKey).join(', ')} excluded as read-only)`
          : '';
        options.onExcluded?.(
          entry.item.issueId,
          entry.repos.length === 0
            ? `no writable member repos resolved for this issue${readOnlyNote}`
            : `no feature branch in any of ${entry.repos.length} writable member repo(s): ${entry.repos.map((r) => r.repoKey).join(', ')}${readOnlyNote}`,
        );
        continue;
      }
      contributing.push({
        item: entry.item,
        contributions: entry.contributions,
        diffRefs: entry.diffRefs,
      });
    }

    if (contributing.length === 0) return [] as PolyrepoMergeQueueItem[];

    const hotspots = (options.hotspots ?? getProjectSwarmHotspots(findProjectByPath(projectRoot))).map(compileGlob);

    // Flattened to ONE concurrency-governed collection: nesting Effect.all
    // inside Effect.all applies the limit at both levels, so the real ceiling
    // was gitConcurrency² subprocesses per project.
    const diffJobs = contributing.flatMap(({ contributions, diffRefs }, candidateIndex) =>
      contributions.map((c, repoIndex) => ({ candidateIndex, contribution: c, ref: diffRefs[repoIndex]! })),
    );
    const diffResults = yield* Effect.all(
      // The diff uses the RESOLVED ref (possibly origin-qualified); the
      // contribution keeps the logical name for assembly.
      diffJobs.map(({ candidateIndex, contribution, ref }) =>
        changedFilesVsMain(ref, contribution.repoPath, contribution.targetBranch).pipe(
          // Filter hotspots against the real path, then namespace by repo so
          // fe/src/x.ts and api/src/x.ts are not mistaken for one file.
          Effect.map((files) => ({
            candidateIndex,
            files: [...normalizedFootprintFiles(files, hotspots)].map((f) => `${contribution.repoKey}:${f}`),
          })),
        ),
      ),
      { concurrency: gitConcurrency },
    );

    const fileSets = contributing.map(() => new Set<string>());
    for (const { candidateIndex, files } of diffResults) {
      for (const file of files) fileSets[candidateIndex]!.add(file);
    }

    // Hotspots were already applied per repo above; re-applying them to prefixed
    // paths would silently match nothing.
    const conflictSignals = computePredictedConflictSignals(
      contributing.map((c, i) => ({ issueId: c.item.issueId, source: 'actual' as const, files: fileSets[i]! })),
    );
    const signalByIssue = new Map(conflictSignals.map((signal) => [signal.issueId, signal]));
    const conflictsMap = new Map(conflictSignals.map((signal) => [signal.issueId, new Set(signal.conflictsWith)]));

    const sorted = orderMergeCandidates(
      contributing.map((c, i) => ({
        item: c.item,
        contributions: c.contributions,
        issueId: c.item.issueId,
        footprint: signalByIssue.get(c.item.issueId)?.footprint ?? fileSets[i]!.size,
        conflictCount: signalByIssue.get(c.item.issueId)?.conflictCount ?? 0,
      })),
    );

    return sorted.map(({ item, contributions, conflictCount }, idx) => ({
      issueId: item.issueId,
      title: item.title,
      // The per-repo refs live in repoContributions; this stays the logical
      // feature-branch name so the field means the same thing as monorepo.
      branchName: `feature/${item.issueId.toLowerCase()}`,
      pr: item.pr,
      prUrl: options.getPrUrl?.(item),
      mergeOrder: idx + 1,
      conflictsWith: [...(conflictsMap.get(item.issueId) ?? [])],
      batchGroup: (conflictCount === 0 ? 'batch' : 'serialize') as 'batch' | 'serialize',
      repoContributions: contributions,
    }));
  });

export interface SequencePickResult {
  issueId: string;
  rank: number;
  gate: string;
  planning: string;
  predictedConflictCount?: number;
  predictedConflictsWith?: string[];
}

