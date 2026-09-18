/**
 * UAT batch train service (PAN-1737) — real wiring for the reconciler,
 * assembly engine, stacks, and promote path, plus the payload builders the
 * /api/merge-train/* routes expose.
 *
 * The reconciler interval is the heartbeat of "always one batch ready": every
 * 60s it walks every tracked project whose effective merge-train flag is on,
 * comparing that project's ready set against its generation chain and
 * assembling/invalidating as needed. PAN-1696 removed the active-flywheel-run
 * requirement — the ready set comes from review-status records, so batches
 * assemble with no run at all. Assemblies run minutes; the reconciler is
 * single-flight per project, so ticks never pile up.
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import {
  assembleUatGeneration,
  cleanupUatGenerations,
  type ReadyFeature,
} from '../../../lib/cloister/uat-generation-engine.js';
import {
  buildPolyrepoCleanupGit,
  buildPolyrepoGitDeps,
  buildUatGenerationGitDeps,
  featureNamespaceOf,
  buildUatGenerationStore,
  buildUatGenerationCleanupGit,
  listRemoteUatBranches,
  listRemoteUatBranchesMulti,
} from '../../../lib/cloister/uat-generation-deps.js';
import {
  assemblePolyrepoUatGeneration,
  compositeAnchor,
  compositeMemberAnchor,
} from '../../../lib/cloister/uat-polyrepo-engine.js';
import { buildConflictAgentHook } from '../../../lib/cloister/uat-conflict-agent.js';
import { reconcileUatGenerations, type ReconcileResult } from '../../../lib/cloister/uat-reconciler.js';
import { ensureUatStack, probeUatStack, teardownUatStack } from '../../../lib/cloister/uat-stack.js';
import {
  promoteUatGeneration,
  buildPolyrepoUatPromoteGitDeps,
  buildUatPromoteGitDeps,
  type PromoteResult,
  type UatPromoteDeps,
} from '../../../lib/cloister/uat-promote.js';
import { notifyFlywheelOfUatPromote } from '../../../lib/cloister/uat-promote-notify.js';
import {
  getUatGenerationSync,
  hasUncleanedTerminalUatGenerationSync,
  isMergeTrainEnabled,
  listUatGenerationsSync,
  markUatGenerationRepoPromotedSync,
  type UatGeneration,
  type UatGenerationRepo,
} from '../../../lib/overdeck/merge-sync.js';
import { listEligibleCandidatesByProject } from '../../../lib/flywheel-merge-order.js';
import { extractACFromDocument } from '../../../lib/xbrief/acceptance-criteria.js';
import { findXBriefByIssue, readXBriefDocument } from '../../../lib/xbrief/xbrief-index.js';
import { findProjectByPathSync, listProjectsSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import type { PanIssueShipRecord } from '../../../lib/pan-dir/record.js';
import {
  executeVersionShipForGeneration,
  persistPendingShipRecords,
  persistShipRecords,
  withGenerationShipLock,
} from '../../../lib/cloister/ship-record.js';
import {
  aggregateGenerationShipStatus,
  loadShipRecords,
  publicShipStatus,
} from '../../../lib/cloister/ship-status.js';
import {
  resolveConfiguredReposSync,
  resolveProjectReposFromResolvedIssueSync,
  type ResolvedProjectRepo,
} from '../../../lib/project-repos.js';
import { getDashboardIdentity } from '../identity.js';

const RECONCILE_INTERVAL_MS = 60_000;
const CHAIN_PAYLOAD_LIMIT = 10;
const ACCEPTANCE_CRITERIA_READ_CONCURRENCY = 4;

type AcceptanceCriteriaSummary = Array<{ title: string; status: string }>;

/**
 * PAN-3165: an unresolvable plan is not a plan with no criteria. Collapsing the
 * two let a resolver bug render as the confident claim "No UAT steps in plan",
 * silently deleting the operator's checklist, so the lookup outcome travels
 * alongside the criteria all the way to the UI.
 */
interface AcceptanceCriteriaLookup {
  planResolved: boolean;
  criteria: AcceptanceCriteriaSummary;
}

interface AcceptanceCriteriaCacheEntry {
  path: string;
  mtimeMs: number;
  criteria: AcceptanceCriteriaSummary;
}

const acceptanceCriteriaByIssue = new Map<string, AcceptanceCriteriaCacheEntry>();

export function resolveUatProjectRoot(cwdPath = process.cwd()): string {
  const registeredProject = findProjectByPathSync(cwdPath);
  if (registeredProject) return resolve(registeredProject.path);

  const normalized = resolve(cwdPath);
  const workspaceMatch = normalized.match(/^(.*)\/workspaces\/feature-[^/]+(?:\/.*)?$/i);
  return workspaceMatch?.[1] ? resolve(workspaceMatch[1]) : normalized;
}

function projectRoot(): string {
  return resolveUatProjectRoot();
}

export function canStartUatTrainReconciler(): boolean {
  const identity = getDashboardIdentity();
  return identity.mode === 'primary' && resolve(identity.repoRoot) === projectRoot();
}

function codenameLabel(features: readonly ReadyFeature[]): string {
  const prefix = features[0]?.issueId.split('-')[0];
  return (prefix ?? 'uat').toLowerCase();
}

/**
 * PAN-1696 reconciler-decouple: Per-project cleanup function factory.
 */
function makeCleanupForProject(projectPath: string): () => Promise<void> {
  return async () => {
    // A polyrepo generation's artifacts live in N repos plus a wrapper folder,
    // none of them reachable from the wrapper path the monorepo cleanup uses.
    const projectConfig = findProjectByPathSync(projectPath);
    const cleanupGit = projectConfig?.workspace?.type === 'polyrepo'
      ? buildPolyrepoCleanupGit(await resolveProjectRepos(projectPath), projectPath)
      : buildUatGenerationCleanupGit(projectPath);

    await cleanupUatGenerations(projectPath, {
      store: buildUatGenerationStore(),
      ...cleanupGit,
      teardownStack: (gen) => teardownUatStack(gen),
      log: (msg) => console.log(msg),
    });
  };
}

/** One reconciler pass. `force` rebuilds even when a live generation matches. */
/**
 * PAN-1696 reconciler-decouple: Internal per-project reconciler.
 * Runs the UAT train reconciliation for a specific project.
 */
async function runUatTrainReconcileForProject(
  projectPath: string,
  options: { force?: boolean } = {},
): Promise<ReconcileResult> {
  const { isMergeTrainEnabledForProject } = await import('../../../lib/overdeck/merge-sync.js');
  const projectConfig = findProjectByPathSync(projectPath);

  // Fail closed: if project cannot be resolved, don't proceed
  if (!projectConfig) {
    console.log(`[uat-train] project at ${projectPath} not found in config — skipping`);
    return { action: 'no-queue', invalidated: [] };
  }

  // Check if enabled before building git deps (fail closed on null config)
  if (!isMergeTrainEnabledForProject(projectConfig)) {
    return { action: 'disabled', invalidated: [] };
  }

  // Early exit if no candidates and no live generations — skip git operations
  const candidates = await listEligibleCandidatesByProject(projectPath);
  const liveGenerations = listUatGenerationsSync({
    projectRoot: projectPath,
    statuses: ['assembling', 'ready', 'superseded'],
    limit: 1,
  });
  if (candidates.length === 0 && liveGenerations.length === 0) {
    // Terminal generations still own branches, worktrees, and a wrapper folder.
    // Promoting the LAST ready batch lands exactly here — no candidates, no
    // live rows — so returning early without cleanup leaks every artifact the
    // batch created, permanently. Cleanup is idempotent and skips rows already
    // marked cleaned, so running it on an otherwise idle tick is cheap.
    // An existence check, not a load: generation rows are retained as an audit
    // trail, so hydrating every terminal row and its four child tables to answer
    // a yes/no question would make the idle minute cost grow with history.
    if (hasUncleanedTerminalUatGenerationSync(projectPath)) {
      await makeCleanupForProject(projectPath)().catch((err) => {
        console.log(`[uat-train] terminal cleanup failed for ${projectPath}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    return { action: 'idle', invalidated: [] };
  }

  // A polyrepo project has no git repo at its own path, so every git dep must
  // be per member repo and staleness must compare composite anchors.
  if (projectConfig.workspace?.type === 'polyrepo') {
    // The base anchor must cover exactly the ready set's contributing repos, so
    // both callbacks read one memoized ready set — recomputing it would also
    // re-run every git probe.
    let readySetOnce: Promise<ReadyFeature[] | null> | undefined;
    const readySet = () => (readySetOnce ??= getPolyrepoReadySetForProject(projectPath));

    return reconcileUatGenerations(projectPath, {
      isEnabled: () => true,  // Already checked above
      getReadySet: readySet,
      // Unused on this path — getBaseAnchor/getFeatureAnchor take over — but
      // the deps contract still requires them.
      getMainHeadSha: async () => '',
      getBranchHeadSha: async () => '',
      getBaseAnchor: async () => getPolyrepoBaseAnchor(projectPath, await readySet()),
      getFeatureAnchor: (feature) => getPolyrepoFeatureAnchor(feature),
      isGenerationContainedInMain: async (generation) => {
        const repoGit = buildPolyrepoGitDeps(await resolveProjectRepos(projectPath), { includeReadOnly: true });
        const repos = generation.repos ?? [];
        return repos.length > 0 && Promise.all(repos.map((repo) =>
          repoGit.get(repo.repoKey)?.isBranchContainedInMain?.(repo.branch) ?? Promise.resolve(false)))
          .then((contained) => contained.every(Boolean));
      },
      store: buildUatGenerationStore(),
      assemble: (features) => assemblePolyrepoFromReadySetForProject(projectPath, features),
      teardownStack: (gen) => teardownUatStack(gen),
      cleanup: makeCleanupForProject(projectPath),
      log: (msg) => console.log(msg),
    }, options);
  }

  const gitDeps = buildUatGenerationGitDeps(projectPath);

  return reconcileUatGenerations(projectPath, {
    isEnabled: () => true,  // Already checked above
    getReadySet: () => getReadySetForProject(projectPath),
    getMainHeadSha: () => gitDeps.fetchMain(),
    getBranchHeadSha: (branch) => gitDeps.branchHeadSha(branch),
    isGenerationContainedInMain: (generation) => gitDeps.isBranchContainedInMain?.(generation.name) ?? Promise.resolve(false),
    store: buildUatGenerationStore(),
    assemble: (features) => assembleFromReadySetForProject(projectPath, features),
    teardownStack: (gen) => teardownUatStack(gen),
    cleanup: makeCleanupForProject(projectPath),
    log: (msg) => console.log(msg),
  }, options);
}

/**
 * Get ready set for a specific project path.
 */
async function getReadySetForProject(projectPath: string): Promise<ReadyFeature[] | null> {
  const { computeMergeQueueFromCandidates, listEligibleCandidatesByProject, resolveMergeQueuePrUrl } = await import('../../../lib/flywheel-merge-order.js');

  const candidates = await listEligibleCandidatesByProject(projectPath);
  if (candidates.length === 0) return [];

  const queue = await Effect.runPromise(
    computeMergeQueueFromCandidates(candidates, projectPath, {
      getPrUrl: resolveMergeQueuePrUrl,
    }).pipe(
      Effect.provide(nodeServicesLayer),
    ),
  );

  return queue.map((item) => ({
    issueId: item.issueId,
    title: item.title,
    branch: item.branchName,
    ...(item.pr !== undefined ? { pr: item.pr } : {}),
    ...(item.prUrl !== undefined ? { prUrl: item.prUrl } : {}),
    conflictsWith: item.conflictsWith,
  }));
}

/**
 * Member repos configured for an issue in a polyrepo project. Resolution goes
 * through the canonical repo resolver, which collapses monorepo to one
 * synthetic entry — so this is the same door the rest of the pipeline uses.
 */
function resolveReposForIssue(issueId: string): ResolvedProjectRepo[] {
  const resolvedProject = resolveProjectFromIssueSync(issueId);
  if (!resolvedProject) return [];
  return resolveProjectReposFromResolvedIssueSync(issueId, resolvedProject) ?? [];
}

/**
 * The project's configured member repos, resolved through the issue door using
 * any eligible candidate. Every issue in a project resolves the same repo set;
 * only the per-issue branch names differ, and callers here use the branches
 * from each feature's own contributions rather than these.
 */
async function resolveProjectRepos(projectPath: string, preferredIssueId?: string): Promise<ResolvedProjectRepo[]> {
  const issueId = preferredIssueId ?? (await listEligibleCandidatesByProject(projectPath))[0]?.issueId;
  if (issueId) return resolveReposForIssue(issueId);

  // No candidate to resolve through — the exact state cleanup runs in after the
  // last batch is promoted. Resolve the configured repo set straight from
  // project config instead; the per-issue branch names it derives are unused
  // here, only the repo paths and targets matter.
  const resolved = findProjectByPathSync(projectPath);
  if (!resolved) return [];
  const entry = listProjectsSync().find(({ config }) => resolve(config.path) === resolve(projectPath));
  if (!entry) return [];
  return resolveConfiguredReposSync(entry.key, projectPath, entry.config, `${entry.key}-cleanup`);
}

/** Polyrepo ready set: per-candidate contributions across member repos. */
async function getPolyrepoReadySetForProject(projectPath: string): Promise<ReadyFeature[] | null> {
  const { computePolyrepoMergeQueueFromCandidates, listEligibleCandidatesByProject, resolveMergeQueuePrUrl } =
    await import('../../../lib/flywheel-merge-order.js');

  const candidates = await listEligibleCandidatesByProject(projectPath);
  if (candidates.length === 0) return [];

  const reposByIssue = new Map(candidates.map((c) => [c.issueId, resolveReposForIssue(c.issueId)]));

  // An outage is "unavailable", never "empty". The reconciler treats an empty
  // ready set as authoritative and will invalidate the live generation and tear
  // down its stack; null means "do nothing this tick".
  let unavailableRepos: readonly string[] = [];

  const queue = await Effect.runPromise(
    computePolyrepoMergeQueueFromCandidates(candidates, reposByIssue, projectPath, {
      getPrUrl: resolveMergeQueuePrUrl,
      onExcluded: (issueId, reason) =>
        console.log(`[uat-train] ${issueId} excluded from the polyrepo ready set: ${reason}`),
      onRefreshUnavailable: (repoPaths) => { unavailableRepos = repoPaths; },
    }).pipe(Effect.provide(nodeServicesLayer)),
  );

  if (unavailableRepos.length > 0) {
    console.log(
      `[uat-train] polyrepo ready set unavailable for ${projectPath}: could not refresh refs in ` +
      `${unavailableRepos.join(', ')} — skipping this tick rather than invalidating the live batch`,
    );
    return null;
  }

  return queue.map((item) => ({
    issueId: item.issueId,
    title: item.title,
    branch: item.branchName,
    ...(item.pr !== undefined ? { pr: item.pr } : {}),
    ...(item.prUrl !== undefined ? { prUrl: item.prUrl } : {}),
    conflictsWith: item.conflictsWith,
    repoContributions: item.repoContributions,
  }));
}

/**
 * Composite base anchor over exactly the repos the ready set contributes to.
 *
 * NOT every configured repo: assembly anchors on the contributing set, and
 * staleness is string equality, so including an untouched repo would make the
 * two anchors differ forever and rebuild the same generation every tick.
 */
async function getPolyrepoBaseAnchor(
  projectPath: string,
  readySet: readonly ReadyFeature[] | null,
): Promise<string> {
  const contributingKeys = new Set(
    (readySet ?? []).flatMap((f) => (f.repoContributions ?? []).map((c) => c.repoKey)),
  );
  const repos = (await resolveProjectRepos(projectPath)).filter((r) => contributingKeys.has(r.repoKey));
  if (repos.length === 0) return '';
  const gitByRepo = buildPolyrepoGitDeps(repos);

  const entries = await Promise.all(
    repos.map(async (repo) => ({
      repoKey: repo.repoKey,
      sha: await gitByRepo.get(repo.repoKey)!.fetchMain().catch(() => 'unknown'),
      mergeOrder: repo.mergeOrder,
    })),
  );
  return compositeAnchor(entries);
}

/** Composite anchor over the repos one feature currently contributes to. */
async function getPolyrepoFeatureAnchor(feature: ReadyFeature): Promise<string> {
  const contributions = feature.repoContributions ?? [];
  if (contributions.length === 0) return 'unknown';

  const entries = await Promise.all(
    contributions.map(async (c) => {
      const git = buildUatGenerationGitDeps(c.repoPath, {
        targetBranch: c.targetBranch,
        // The SAME configured namespace assembly uses. Defaulting to `feature/`
        // here would reject a valid `feat/…` branch, yield an `unknown` anchor,
        // and invalidate the generation assembly had just built.
        featureBranchPrefix: featureNamespaceOf(c.branch),
      });
      return { repoKey: c.repoKey, headSha: await git.branchHeadSha(c.branch).catch(() => 'unknown') };
    }),
  );
  return compositeMemberAnchor(entries);
}

/** Assemble a polyrepo UAT generation for a project's ready set. */
async function assemblePolyrepoFromReadySetForProject(
  projectPath: string,
  features: readonly ReadyFeature[],
): Promise<UatGeneration> {
  const repos = await resolveProjectRepos(projectPath, features[0]?.issueId);
  if (repos.length === 0) {
    throw new Error(`[uat-train] no member repos resolved for the polyrepo project at ${projectPath}`);
  }

  return assemblePolyrepoUatGeneration(
    {
      projectRoot: projectPath,
      label: codenameLabel(features),
      dateIso: new Date().toISOString(),
      features,
      repos,
      takenBranchNames: await listRemoteUatBranchesMulti(repos),
    },
    {
      repoGit: buildPolyrepoGitDeps(repos),
      store: buildUatGenerationStore(),
      resolveConflict: buildConflictAgentHook(),
      log: (msg) => console.log(msg),
    },
  );
}

/**
 * Assemble UAT generation for a specific project's ready set.
 */
async function assembleFromReadySetForProject(
  projectPath: string,
  features: readonly ReadyFeature[],
): Promise<UatGeneration> {
  const store = buildUatGenerationStore();
  return assembleUatGeneration(
    {
      projectRoot: projectPath,
      label: codenameLabel(features),
      dateIso: new Date().toISOString(),
      features,
      takenBranchNames: await listRemoteUatBranches(projectPath),
    },
    {
      git: buildUatGenerationGitDeps(projectPath),
      store,
      resolveConflict: buildConflictAgentHook(),
      log: (msg) => console.log(msg),
    },
  );
}

/**
 * PAN-1696 reconciler-decouple: Single-project reconciliation (used by forced-rebuild endpoint).
 * When called from /api/merge-train/assemble with force:true and no project, reconciles every enabled project; with { project } or an explicit projectRoot, just that one.
 */
export async function runUatTrainReconcile(
  options: { force?: boolean; projectRoot?: string } = {},
): Promise<ReconcileResult> {
  const projectPath = options.projectRoot ? resolve(options.projectRoot) : projectRoot();
  return runUatTrainReconcileForProject(projectPath, { ...(options.force !== undefined ? { force: options.force } : {}) });
}

/**
 * PAN-1696 merge-train-routes: reconcile every tracked project whose effective
 * merge-train flag is on, isolating failures so one project's git error cannot
 * abort the others. Returns one result per attempted project so the caller can
 * report which projects moved and which errored.
 */
export async function runUatTrainReconcileAllProjects(
  options: { force?: boolean } = {},
): Promise<Array<{ projectKey: string; result?: ReconcileResult; error?: string }>> {
  const { listProjectsSync } = await import('../../../lib/projects.js');
  const { isMergeTrainEnabledForProject } = await import('../../../lib/overdeck/merge-sync.js');

  const enabled = listProjectsSync().filter(({ config }) => isMergeTrainEnabledForProject(config));
  return Promise.all(
    enabled.map(async ({ key, config }) => {
      const projectPath = resolve(config.path);
      try {
        const result = await runUatTrainReconcileForProject(projectPath, options);
        return { projectKey: key, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[uat-train] project ${projectPath} failed to reconcile:`, msg);
        return { projectKey: key, error: msg };
      }
    }),
  );
}

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

export function startUatTrainReconciler(): boolean {
  if (!canStartUatTrainReconciler()) return false;
  if (reconcilerTimer) return true;
  reconcilerTimer = setInterval(() => {
    void runUatTrainReconcileAllProjects().catch((err) => {
      console.warn('[uat-train] reconcile tick failed:', err instanceof Error ? err.message : err);
    });
  }, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref?.();
  void runUatTrainReconcileAllProjects().catch((err) => {
    console.warn('[uat-train] initial reconcile failed:', err instanceof Error ? err.message : err);
  });
  return true;
}

export function stopUatTrainReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}

// ─── Route payloads ───────────────────────────────────────────────────────────

export interface UatGenerationMemberPayload {
  issueId: string;
  title: string;
  branch: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  /** What-to-UAT checklist from the issue's xBRIEF spec (shared extractor). */
  acceptanceCriteria: Array<{ title: string; status: string }>;
  /**
   * False when the issue's spec could not be resolved or read at all (PAN-3165).
   * An empty `acceptanceCriteria` then means "we don't know", not "the plan
   * specified nothing" — the UI must say so rather than assert the latter.
   */
  planResolved: boolean;
}

/** Per-repo detail safe to return over HTTP — no host filesystem paths. */
export interface UatGenerationRepoPayload {
  repoKey: string;
  branch: string;
  baseSha: string;
  targetBranch: string;
  mergeOrder: number;
  promotedAt?: string | null;
  mergeSha?: string | null;
}

export interface UatGenerationPayload {
  name: string;
  status: UatGeneration['status'];
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  members: UatGenerationMemberPayload[];
  heldOut: UatGeneration['heldOut'];
  resolutions: UatGeneration['resolutions'];
  versionSyncConfigured: boolean;
  /** Public aggregate omits operational error/reason detail. */
  shipStatus: Omit<PanIssueShipRecord, 'error' | 'reason'> | null;
  /**
   * Per-repo generation detail, additive (PAN-3093). Always present and
   * non-empty: a monorepo generation projects the single synthesized entry, so
   * consumers read one shape. Rendering it is deliberately a follow-up; the
   * data ships now so that follow-up has something to render.
   *
   * A deliberate public DTO, not the internal model: `repoPath` and
   * `worktreePath` are absolute server paths, and a response has no reason to
   * disclose host filesystem topology.
   */
  repos: UatGenerationRepoPayload[];
  /**
   * Live stack state (PAN-3166). `degraded` means containers are up but a
   * service the compose file declares is not serving — `downServices` names
   * them and `serviceErrors` carries each one's last error line, so the panel
   * can say why instead of offering a link into a gateway timeout. `unknown`
   * means the probe itself failed, which is not proof the stack is gone.
   */
  stack: {
    status: 'running' | 'degraded' | 'unknown' | 'absent';
    frontendUrl: string;
    downServices?: string[];
    serviceErrors?: Record<string, string>;
    probeError?: string;
  };
}

async function mapBounded<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/**
 * PAN-1696: `root` is the project the issues belong to, NOT the dashboard's own
 * repo. Once the generations payload started serving every tracked project, a
 * dashboard-rooted xBRIEF lookup silently returned no acceptance criteria for
 * every non-PAN generation, so those batches showed an empty "What to UAT" list.
 * Issue ids are prefix-distinct across projects, so the module-level mtime cache
 * stays safe to key by issue id alone.
 */
async function loadAcceptanceCriteriaCache(
  issueIds: ReadonlySet<string>,
  root: string,
): Promise<Map<string, AcceptanceCriteriaLookup>> {
  const cache = new Map<string, AcceptanceCriteriaLookup>();
  if (issueIds.size === 0) return cache;

  await mapBounded([...issueIds], ACCEPTANCE_CRITERIA_READ_CONCURRENCY, async (issueId) => {
    const upperIssueId = issueId.toUpperCase();
    const existing = acceptanceCriteriaByIssue.get(upperIssueId);
    if (existing) {
      try {
        const { mtimeMs } = await stat(existing.path);
        if (existing.mtimeMs === mtimeMs) {
          cache.set(upperIssueId, { planResolved: true, criteria: existing.criteria });
          return;
        }
      } catch {
        acceptanceCriteriaByIssue.delete(upperIssueId);
      }
    }

    try {
      const found = await Effect.runPromise(findXBriefByIssue(root, upperIssueId));
      if (!found) {
        acceptanceCriteriaByIssue.delete(upperIssueId);
        console.warn(`[uat-train] no xBRIEF spec resolved for ${upperIssueId} under ${root} — UAT checklist unavailable`);
        cache.set(upperIssueId, { planResolved: false, criteria: [] });
        return;
      }
      const { mtimeMs } = await stat(found.path);
      const document = await Effect.runPromise(readXBriefDocument(found.path));
      const criteria = extractACFromDocument(document).map((ac) => ({ title: ac.title, status: ac.status }));
      acceptanceCriteriaByIssue.set(upperIssueId, { path: found.path, mtimeMs, criteria });
      cache.set(upperIssueId, { planResolved: true, criteria });
    } catch (err) {
      console.warn(
        `[uat-train] failed to read xBRIEF spec for ${upperIssueId}:`,
        err instanceof Error ? err.message : err,
      );
      cache.set(upperIssueId, { planResolved: false, criteria: [] });
    }
  });
  return cache;
}

/** The generation chain, newest first, enriched for the UAT batches card. */
export async function getUatGenerationsPayload(projectRootOverride?: string): Promise<UatGenerationPayload[]> {
  // PAN-1696: no flywheel-run requirement — list generations directly from store.
  // projectRootOverride lets the aggregate /api/merge-train/generations route read
  // each tracked project's chain instead of only the dashboard's own repo.
  const root = projectRootOverride ? resolve(projectRootOverride) : projectRoot();
  const project = findProjectByPathSync(root);
  const versionSyncConfigured = Boolean(project?.version_sync);
  const chain = listUatGenerationsSync({ projectRoot: root, limit: CHAIN_PAYLOAD_LIMIT });
  if (chain.length === 0) return [];
  const memberIssueIds = new Set(chain.flatMap((gen) => gen.members.map((member) => member.issueId.toUpperCase())));
  // Resolve each member's xBRIEF in ITS OWN project, not the dashboard's repo.
  const [acCache, shipRecords] = await Promise.all([
    loadAcceptanceCriteriaCache(memberIssueIds, root),
    project && versionSyncConfigured ? loadShipRecords(project, chain) : Promise.resolve(new Map()),
  ]);
  const payload: UatGenerationPayload[] = [];
  for (const gen of chain) {
    const probe = await probeUatStack(gen);
    const members: UatGenerationMemberPayload[] = [];
    for (const member of gen.members) {
      const lookup = acCache.get(member.issueId.toUpperCase());
      members.push({
        issueId: member.issueId,
        title: member.title,
        branch: member.branch,
        ...(member.pr !== undefined ? { pr: member.pr } : {}),
        ...(member.prUrl !== undefined ? { prUrl: member.prUrl } : {}),
        mergeOrder: member.mergeOrder,
        acceptanceCriteria: lookup?.criteria ?? [],
        planResolved: lookup?.planResolved ?? false,
      });
    }
    payload.push({
      name: gen.name,
      status: gen.status,
      baseSha: gen.baseSha,
      createdAt: gen.createdAt,
      updatedAt: gen.updatedAt,
      members,
      heldOut: gen.heldOut,
      resolutions: gen.resolutions,
      versionSyncConfigured,
      shipStatus: publicShipStatus(
        versionSyncConfigured ? aggregateGenerationShipStatus(gen, shipRecords) : null,
      ),
      repos: (gen.repos ?? []).map((r) => ({
        repoKey: r.repoKey,
        branch: r.branch,
        baseSha: r.baseSha,
        targetBranch: r.targetBranch,
        mergeOrder: r.mergeOrder,
        promotedAt: r.promotedAt ?? null,
        mergeSha: r.mergeSha ?? null,
      })),
      stack: {
        status: probe.status,
        frontendUrl: probe.frontendUrl,
        ...(probe.downServices ? { downServices: probe.downServices } : {}),
        ...(probe.serviceErrors ? { serviceErrors: probe.serviceErrors } : {}),
        ...(probe.probeError ? { probeError: probe.probeError } : {}),
      },
    });
  }
  return payload;
}

export interface UatCandidatePayload {
  branchName: string;
  bundled: string[];
  status: 'ready';
}

/** The authoritative active UAT candidate, if one is ready to test/ship. */
export async function getUatCandidatePayload(): Promise<UatCandidatePayload | null> {
  const [candidate] = listUatGenerationsSync({
    projectRoot: projectRoot(),
    statuses: ['ready'],
    limit: 1,
  });
  if (!candidate) return null;
  return {
    branchName: candidate.name,
    bundled: candidate.members.map((member) => member.issueId),
    status: 'ready',
  };
}

export async function postUatGenerationStackPayload(name: string): Promise<
  { ok: true; frontendUrl: string; evicted: string[] } | { ok: false; error: string; status: number }
> {
  const gen = getUatGenerationSync(name);
  if (!gen) return { ok: false, error: `No UAT generation named ${name}`, status: 404 };
  if (gen.status !== 'ready' && gen.status !== 'superseded') {
    return { ok: false, error: `${name} is ${gen.status} — only live batches can serve a stack`, status: 409 };
  }
  const result = await ensureUatStack(gen);
  if (!result.success) return { ok: false, error: result.error ?? 'stack start failed', status: 500 };
  return { ok: true, frontendUrl: result.frontendUrl!, evicted: result.evicted };
}

export async function postUatGenerationPromotePayload(
  name: string,
  // Typed as the full promote contract, not `(issueId) => boolean`: the narrow
  // signature is what let the per-repo evidence be dropped by the forwarding
  // layer without a type error.
  firePostMerge: UatPromoteDeps['firePostMerge'],
  shipVersion?: string,
): Promise<PromoteResult> {
  // PAN-1696: promote into the generation's OWN project repo. Generation rows carry
  // project_root, so a MIN generation must not be merged against the Overdeck repo.
  // For a generation belonging to this repo this resolves to the same path as before.
  const root = resolve(getUatGenerationSync(name)?.projectRoot ?? projectRoot());
  const [
    { reviewRecordEligibility },
    { recordUatPromotionVerdicts },
  ] = await Promise.all([
    import('../../../lib/flywheel-merge-order.js'),
    import('../../../lib/cloister/uat-promote-verification.js'),
  ]);
  // A polyrepo generation merges into each member repo's own target branch, so
  // it needs per-repo promote git. Supplying it is what selects the two-phase
  // (trial-merge everything, then publish) path.
  const projectConfig = findProjectByPathSync(root);
  const polyrepo = projectConfig?.workspace?.type === 'polyrepo';
  const storedRepos = polyrepo ? (getUatGenerationSync(name)?.repos ?? []) : [];

  // Re-check writability against CURRENT config, not the config that was live
  // at assembly: a repo can be flipped to readonly between assembly and merge,
  // and promote pushes to it. Fail closed rather than silently skipping a repo,
  // which would publish a partial batch.
  const writableKeys = polyrepo
    ? new Set((await resolveProjectRepos(root)).filter((r) => r.required).map((r) => r.repoKey))
    : new Set<string>();
  const nowReadOnly = polyrepo ? storedRepos.filter((r) => !writableKeys.has(r.repoKey)) : [];
  if (nowReadOnly.length > 0) {
    const detail = nowReadOnly.map((r) => r.repoKey).join(', ');
    const result: PromoteResult = {
      success: false,
      reason: 'merge-failed',
      message:
        `${name} includes repo(s) that are no longer writable in project config: ${detail}. ` +
        `Nothing was published. Restore write access or let the reconciler rebuild the batch without them.`,
    };
    await notifyFlywheelOfUatPromote(result).catch(() => {});
    return result;
  }
  const generationRepos = storedRepos;

  const result = await promoteUatGeneration(name, root, {
    git: buildUatPromoteGitDeps(root),
    ...(polyrepo && generationRepos.length > 0
      ? {
          // generationRepos carry their own persisted targetBranch, so a repo
          // configured for `develop` is fetched, trial-merged, and published
          // there rather than silently defaulting to main.
          polyrepoGit: buildPolyrepoUatPromoteGitDeps(generationRepos),
          markRepoPromoted: (genName, repoKey, at, mergeSha) =>
            markUatGenerationRepoPromotedSync(genName, repoKey, at, mergeSha),
        }
      : {}),
    store: { ...buildUatGenerationStore(), get: (n) => getUatGenerationSync(n) },
    teardownStack: (gen) => teardownUatStack(gen),
    firePostMerge,
    memberEligibility: reviewRecordEligibility,
    recordVerification: (generation, mergeSha) => recordUatPromotionVerdicts(generation, mergeSha),
    ...(projectConfig?.version_sync
      ? {
          runShip: (generation: UatGeneration, requestedVersion: string | undefined) => withGenerationShipLock(
            generation.name,
            async () => {
              // Establish durable batch membership before any command, worktree, or
              // Git operation can fail. Deferred recovery and the DoD gate then
              // remain blocking even when propagation never starts.
              await persistPendingShipRecords(
                generation,
                requestedVersion ? 'version ship in progress' : 'no version supplied at promote time',
              );
              if (!requestedVersion) return;

              const report = await executeVersionShipForGeneration({
                generation,
                project: projectConfig,
                version: requestedVersion,
              });
              await persistShipRecords(generation, report);
            },
          ),
        }
      : {}),
    log: (msg) => console.log(msg),
  }, { shipVersion });
  await notifyFlywheelOfUatPromote(result).catch(() => {});
  return result;
}
