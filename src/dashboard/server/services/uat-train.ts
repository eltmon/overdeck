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
import { extractACFromDocument } from '../../../lib/vbrief/acceptance-criteria.js';
import { findVBriefByIssue, readVBriefDocument } from '../../../lib/vbrief/vbrief-index.js';
import { findProjectByPathSync } from '../../../lib/projects.js';
import { getDashboardIdentity } from '../identity.js';
import { readCurrentFlywheelStatusForDashboard } from './flywheel-actions.js';

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

/** Ready set in merge order, or null when no flywheel run is active. */
async function getReadySet(): Promise<ReadyFeature[] | null> {
  const status = await readCurrentFlywheelStatusForDashboard();
  if (!status) return null;
  const { computeMergeQueue, resolveMergeQueuePrUrl } = await import('../../../lib/flywheel-merge-order.js');
  const queue = await Effect.runPromise(
    computeMergeQueue(status.activePipeline, projectRoot(), {
      getPrUrl: resolveMergeQueuePrUrl,
      onIneligible: (issueId, reason) =>
        console.log(`[uat-train] ${issueId} has a merge verb but is not merge-eligible (${reason}) — excluded from the ready set`),
    }).pipe(
      Effect.provide(nodeServicesLayer),
    ),
  );
  const fromVerbs: ReadyFeature[] = queue.map((item) => ({
    issueId: item.issueId,
    title: item.title,
    branch: item.branchName,
    ...(item.pr !== undefined ? { pr: item.pr } : {}),
    ...(item.prUrl !== undefined ? { prUrl: item.prUrl } : {}),
    conflictsWith: item.conflictsWith,
  }));
  const swept = await sweepEligibleFeatures(new Set(fromVerbs.map((f) => f.issueId)));
  return [...fromVerbs, ...swept];
}

/**
 * PAN-2484: the verb-based ready set misses merge-eligible issues that entered
 * the pipeline outside the active flywheel run (operator revivals, strikes,
 * externally-requested reviews) — those sat at readyForMerge with no train ever
 * assembling around them. Sweep review status for THIS project's merge-eligible
 * issues whose feature branch exists and append any the verb set missed. The
 * flywheel's ordering still leads; swept extras ride at the tail (the assembly
 * engine's conflict hook owns any cross-feature conflicts).
 */
async function sweepEligibleFeatures(alreadyIncluded: ReadySet): Promise<ReadyFeature[]> {
  try {
    const { loadReviewStatuses, mergeGateEligibility } = await import('../../../lib/review-status.js');
    const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const root = projectRoot();
    const extras: ReadyFeature[] = [];
    for (const [issueId, rs] of Object.entries(loadReviewStatuses())) {
      if (alreadyIncluded.has(issueId)) continue;
      if (rs.readyForMerge !== true) continue;
      if (!mergeGateEligibility(rs).eligible) continue;
      const project = resolveProjectFromIssueSync(issueId);
      if (!project || resolve(project.projectPath) !== root) continue;
      const branch = `feature/${issueId.toLowerCase()}`;
      try {
        await execFileAsync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, timeout: 10_000 });
      } catch {
        continue; // no local branch — nothing to assemble
      }
      console.log(`[uat-train] ${issueId} is merge-eligible without a flywheel merge verb — swept into the ready set (PAN-2484)`);
      extras.push({ issueId, title: issueId, branch, conflictsWith: [] });
    }
    return extras;
  } catch (err) {
    console.warn(`[uat-train] eligibility sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

type ReadySet = Set<string>;

function codenameLabel(features: readonly ReadyFeature[]): string {
  const prefix = features[0]?.issueId.split('-')[0];
  return (prefix ?? 'uat').toLowerCase();
}

async function assembleFromReadySet(features: readonly ReadyFeature[]): Promise<UatGeneration> {
  const root = projectRoot();
  const store = buildUatGenerationStore();
  return assembleUatGeneration(
    {
      projectRoot: root,
      label: codenameLabel(features),
      dateIso: new Date().toISOString(),
      features,
      takenBranchNames: await listRemoteUatBranches(root),
    },
    {
      git: buildUatGenerationGitDeps(root),
      store,
      resolveConflict: buildConflictAgentHook(),
      log: (msg) => console.log(msg),
    },
  );
}

async function runCleanup(): Promise<void> {
  const root = projectRoot();
  await cleanupUatGenerations(root, {
    store: buildUatGenerationStore(),
    ...buildUatGenerationCleanupGit(root),
    teardownStack: (gen) => teardownUatStack(gen),
    log: (msg) => console.log(msg),
  });
}

/** One reconciler pass. `force` rebuilds even when a live generation matches. */
export async function runUatTrainReconcile(options: { force?: boolean } = {}): Promise<ReconcileResult> {
  const root = projectRoot();
  const gitDeps = buildUatGenerationGitDeps(root);
  return reconcileUatGenerations(root, {
    isEnabled: () => isMergeTrainEnabled(),
    getReadySet,
    getMainHeadSha: () => gitDeps.fetchMain(),
    getBranchHeadSha: (branch) => gitDeps.branchHeadSha(branch),
    store: buildUatGenerationStore(),
    assemble: assembleFromReadySet,
    teardownStack: (gen) => teardownUatStack(gen),
    cleanup: runCleanup,
    log: (msg) => console.log(msg),
  }, options);
}

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

export function startUatTrainReconciler(): boolean {
  if (!canStartUatTrainReconciler()) return false;
  if (reconcilerTimer) return true;
  reconcilerTimer = setInterval(() => {
    void runUatTrainReconcile().catch((err) => {
      console.warn('[uat-train] reconcile tick failed:', err instanceof Error ? err.message : err);
    });
  }, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref?.();
  void runUatTrainReconcile().catch((err) => {
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
  /** What-to-UAT checklist from the issue's vBRIEF spec (shared extractor). */
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
      const found = await Effect.runPromise(findVBriefByIssue(root, upperIssueId));
      if (!found) {
        acceptanceCriteriaByIssue.delete(upperIssueId);
        cache.set(upperIssueId, []);
        return;
      }
      const { mtimeMs } = await stat(found.path);
      const document = await Effect.runPromise(readVBriefDocument(found.path));
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
  const status = await readCurrentFlywheelStatusForDashboard();
  if (!status) return [];

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
