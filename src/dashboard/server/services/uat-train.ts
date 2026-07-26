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
  buildPolyrepoGitDeps,
  buildUatGenerationGitDeps,
  buildUatGenerationStore,
  buildUatGenerationCleanupGit,
  listRemoteUatBranches,
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
  buildUatPromoteGitDeps,
  type PromoteResult,
} from '../../../lib/cloister/uat-promote.js';
import { notifyFlywheelOfUatPromote } from '../../../lib/cloister/uat-promote-notify.js';
import {
  getUatGenerationSync,
  isMergeTrainEnabled,
  listUatGenerationsSync,
  type UatGeneration,
} from '../../../lib/overdeck/merge-sync.js';
import { listEligibleCandidatesByProject } from '../../../lib/flywheel-merge-order.js';
import { extractACFromDocument } from '../../../lib/xbrief/acceptance-criteria.js';
import { findXBriefByIssue, readXBriefDocument } from '../../../lib/xbrief/xbrief-index.js';
import { findProjectByPathSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import {
  resolveProjectReposFromResolvedIssueSync,
  type ResolvedProjectRepo,
} from '../../../lib/project-repos.js';
import { getDashboardIdentity } from '../identity.js';

const RECONCILE_INTERVAL_MS = 60_000;
const CHAIN_PAYLOAD_LIMIT = 10;
const ACCEPTANCE_CRITERIA_READ_CONCURRENCY = 4;

type AcceptanceCriteriaSummary = Array<{ title: string; status: string }>;

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
    await cleanupUatGenerations(projectPath, {
      store: buildUatGenerationStore(),
      ...buildUatGenerationCleanupGit(projectPath),
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
  const candidates = listEligibleCandidatesByProject(projectPath);
  const liveGenerations = listUatGenerationsSync({
    projectRoot: projectPath,
    statuses: ['assembling', 'ready', 'superseded'],
    limit: 1,
  });
  if (candidates.length === 0 && liveGenerations.length === 0) {
    return { action: 'idle', invalidated: [] };
  }

  // A polyrepo project has no git repo at its own path, so every git dep must
  // be per member repo and staleness must compare composite anchors.
  if (projectConfig.workspace?.type === 'polyrepo') {
    return reconcileUatGenerations(projectPath, {
      isEnabled: () => true,  // Already checked above
      getReadySet: () => getPolyrepoReadySetForProject(projectPath),
      // Unused on this path — getBaseAnchor/getFeatureAnchor take over — but
      // the deps contract still requires them.
      getMainHeadSha: async () => '',
      getBranchHeadSha: async () => '',
      getBaseAnchor: () => getPolyrepoBaseAnchor(projectPath),
      getFeatureAnchor: (feature) => getPolyrepoFeatureAnchor(feature),
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

  const candidates = listEligibleCandidatesByProject(projectPath);
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
function resolveProjectRepos(projectPath: string, preferredIssueId?: string): ResolvedProjectRepo[] {
  const issueId = preferredIssueId ?? listEligibleCandidatesByProject(projectPath)[0]?.issueId;
  return issueId ? resolveReposForIssue(issueId) : [];
}

/** Polyrepo ready set: per-candidate contributions across member repos. */
async function getPolyrepoReadySetForProject(projectPath: string): Promise<ReadyFeature[] | null> {
  const { computePolyrepoMergeQueueFromCandidates, listEligibleCandidatesByProject, resolveMergeQueuePrUrl } =
    await import('../../../lib/flywheel-merge-order.js');

  const candidates = listEligibleCandidatesByProject(projectPath);
  if (candidates.length === 0) return [];

  const reposByIssue = new Map(candidates.map((c) => [c.issueId, resolveReposForIssue(c.issueId)]));

  const queue = await Effect.runPromise(
    computePolyrepoMergeQueueFromCandidates(candidates, reposByIssue, projectPath, {
      getPrUrl: resolveMergeQueuePrUrl,
      onExcluded: (issueId, reason) =>
        console.log(`[uat-train] ${issueId} excluded from the polyrepo ready set: ${reason}`),
    }).pipe(Effect.provide(nodeServicesLayer)),
  );

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
 * Composite base anchor across every configured member repo. Must be built by
 * the same helper assembly uses, since staleness is string equality.
 */
async function getPolyrepoBaseAnchor(projectPath: string): Promise<string> {
  const repos = resolveProjectRepos(projectPath);
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
      const git = buildUatGenerationGitDeps(c.repoPath, { targetBranch: c.targetBranch });
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
  const repos = resolveProjectRepos(projectPath, features[0]?.issueId);
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
  stack: { status: 'running' | 'absent'; frontendUrl: string };
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
): Promise<Map<string, AcceptanceCriteriaSummary>> {
  const cache = new Map<string, AcceptanceCriteriaSummary>();
  if (issueIds.size === 0) return cache;

  await mapBounded([...issueIds], ACCEPTANCE_CRITERIA_READ_CONCURRENCY, async (issueId) => {
    const upperIssueId = issueId.toUpperCase();
    const existing = acceptanceCriteriaByIssue.get(upperIssueId);
    if (existing) {
      try {
        const { mtimeMs } = await stat(existing.path);
        if (existing.mtimeMs === mtimeMs) {
          cache.set(upperIssueId, existing.criteria);
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
        cache.set(upperIssueId, []);
        return;
      }
      const { mtimeMs } = await stat(found.path);
      const document = await Effect.runPromise(readXBriefDocument(found.path));
      const criteria = extractACFromDocument(document).map((ac) => ({ title: ac.title, status: ac.status }));
      acceptanceCriteriaByIssue.set(upperIssueId, { path: found.path, mtimeMs, criteria });
      cache.set(upperIssueId, criteria);
    } catch {
      cache.set(upperIssueId, []);
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
  const chain = listUatGenerationsSync({ projectRoot: root, limit: CHAIN_PAYLOAD_LIMIT });
  if (chain.length === 0) return [];
  const memberIssueIds = new Set(chain.flatMap((gen) => gen.members.map((member) => member.issueId.toUpperCase())));
  // Resolve each member's xBRIEF in ITS OWN project, not the dashboard's repo.
  const acCache = await loadAcceptanceCriteriaCache(memberIssueIds, root);
  const payload: UatGenerationPayload[] = [];
  for (const gen of chain) {
    const probe = await probeUatStack(gen);
    const members: UatGenerationMemberPayload[] = [];
    for (const member of gen.members) {
      members.push({
        issueId: member.issueId,
        title: member.title,
        branch: member.branch,
        ...(member.pr !== undefined ? { pr: member.pr } : {}),
        ...(member.prUrl !== undefined ? { prUrl: member.prUrl } : {}),
        mergeOrder: member.mergeOrder,
        acceptanceCriteria: acCache.get(member.issueId.toUpperCase()) ?? [],
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
      stack: { status: probe.status, frontendUrl: probe.frontendUrl },
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
  firePostMerge: (issueId: string) => boolean,
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
  const result = await promoteUatGeneration(name, root, {
    git: buildUatPromoteGitDeps(root),
    store: { ...buildUatGenerationStore(), get: (n) => getUatGenerationSync(n) },
    teardownStack: (gen) => teardownUatStack(gen),
    firePostMerge,
    memberEligibility: reviewRecordEligibility,
    recordVerification: (generation, mergeSha) => recordUatPromotionVerdicts(generation, mergeSha),
    log: (msg) => console.log(msg),
  });
  await notifyFlywheelOfUatPromote(result).catch(() => {});
  return result;
}
