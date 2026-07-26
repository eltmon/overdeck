/**
 * UAT batch train service (PAN-1737) — real wiring for the reconciler,
 * assembly engine, stacks, and promote path, plus the payload builders the
 * flywheel routes expose.
 *
 * The reconciler interval is the heartbeat of "always one batch ready":
 * every 60s (gated per-tick on flywheel.merge_train_enabled, no-op without an
 * active flywheel run) it compares the ready set against the generation chain
 * and assembles/invalidates as needed. Assemblies run minutes — the reconciler
 * is single-flight per project, so ticks never pile up.
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
  buildUatGenerationGitDeps,
  buildUatGenerationStore,
  buildUatGenerationCleanupGit,
  listRemoteUatBranches,
} from '../../../lib/cloister/uat-generation-deps.js';
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
import { findProjectByPathSync } from '../../../lib/projects.js';
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

class PolyrepoAssemblyUnsupported extends Error {
  constructor() {
    super('polyrepo UAT assembly not yet supported');
    this.name = 'PolyrepoAssemblyUnsupported';
  }
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

  // PAN-1696: polyrepo assembly not yet supported — skip before git operations
  if (projectConfig.workspace?.type === 'polyrepo') {
    console.log(`[uat-train] polyrepo project type not supported for UAT assembly — skipping`);
    return { action: 'no-queue', invalidated: [] };
  }

  // Check if enabled before building git deps (fail closed on null config)
  if (!isMergeTrainEnabledForProject(projectConfig)) {
    return { action: 'disabled', invalidated: [] };
  }

  // Early exit if no candidates and no live generations — skip git operations
  const candidates = listEligibleCandidatesByProject(projectPath);
  const allGenerations = listUatGenerationsSync({ projectRoot: projectPath, limit: 100 });
  const liveGenerations = allGenerations.filter((g) => g.status === 'ready' || g.status === 'superseded');
  if (candidates.length === 0 && liveGenerations.length === 0) {
    return { action: 'idle', invalidated: [] };
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

// Removed PolyrepoAssemblyUnsupported class — polyrepo guard moved to runUatTrainReconcileForProject

/**
 * PAN-1696 reconciler-decouple: Single-project reconciliation (used by forced-rebuild endpoint).
 * When called from /api/flywheel/assemble-uat with force:true, reconciles only projectRoot().
 */
export async function runUatTrainReconcile(options: { force?: boolean } = {}): Promise<ReconcileResult> {
  const projectPath = projectRoot();
  return runUatTrainReconcileForProject(projectPath, options);
}

/**
 * Internal: Periodic all-project reconciliation for the 60-second tick.
 * Reconciles each enabled project independently with error isolation.
 * Not exported — only used by startUatTrainReconciler.
 */
async function _reconcileAllProjectsForTick(): Promise<void> {
  const { listProjectsSync } = await import('../../../lib/projects.js');
  const { isMergeTrainEnabledForProject } = await import('../../../lib/overdeck/merge-sync.js');

  const projects = listProjectsSync();
  const results = await Promise.allSettled(
    projects.map(async ({ config }) => {
      // PAN-1696: skip projects with merge-train disabled
      if (!isMergeTrainEnabledForProject(config)) {
        return;
      }

      const projectPath = resolve(config.path);
      try {
        await runUatTrainReconcileForProject(projectPath, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[uat-train] project ${projectPath} failed during periodic tick:`, msg);
      }
    }),
  );
}

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

export function startUatTrainReconciler(): boolean {
  if (!canStartUatTrainReconciler()) return false;
  if (reconcilerTimer) return true;
  reconcilerTimer = setInterval(() => {
    void _reconcileAllProjectsForTick().catch((err) => {
      console.warn('[uat-train] reconcile tick failed:', err instanceof Error ? err.message : err);
    });
  }, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref?.();
  void _reconcileAllProjectsForTick().catch((err) => {
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

async function loadAcceptanceCriteriaCache(issueIds: ReadonlySet<string>): Promise<Map<string, AcceptanceCriteriaSummary>> {
  const cache = new Map<string, AcceptanceCriteriaSummary>();
  if (issueIds.size === 0) return cache;

  const root = projectRoot();
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
export async function getUatGenerationsPayload(): Promise<UatGenerationPayload[]> {
  // PAN-1696: no flywheel-run requirement — list generations directly from store
  const chain = listUatGenerationsSync({ projectRoot: projectRoot(), limit: CHAIN_PAYLOAD_LIMIT });
  if (chain.length === 0) return [];
  const memberIssueIds = new Set(chain.flatMap((gen) => gen.members.map((member) => member.issueId.toUpperCase())));
  const acCache = await loadAcceptanceCriteriaCache(memberIssueIds);
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
  const root = projectRoot();
  const { reviewRecordEligibility } = await import('../../../lib/flywheel-merge-order.js');
  const result = await promoteUatGeneration(name, root, {
    git: buildUatPromoteGitDeps(root),
    store: { ...buildUatGenerationStore(), get: (n) => getUatGenerationSync(n) },
    teardownStack: (gen) => teardownUatStack(gen),
    firePostMerge,
    memberEligibility: reviewRecordEligibility,
    log: (msg) => console.log(msg),
  });
  await notifyFlywheelOfUatPromote(result).catch(() => {});
  return result;
}
