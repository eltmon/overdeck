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
import {
  getUatGenerationSync,
  listUatGenerationsSync,
  type UatGeneration,
} from '../../../lib/database/uat-generations-db.js';
import { isMergeTrainEnabled } from '../../../lib/database/app-settings.js';
import { extractACFromDocument } from '../../../lib/vbrief/acceptance-criteria.js';
import { findVBriefByIssue, readVBriefDocument } from '../../../lib/vbrief/vbrief-index.js';
import { readCurrentFlywheelStatusForDashboard } from './flywheel-actions.js';

const RECONCILE_INTERVAL_MS = 60_000;
const CHAIN_PAYLOAD_LIMIT = 10;

function projectRoot(): string {
  return process.cwd();
}

/** Ready set in merge order, or null when no flywheel run is active. */
async function getReadySet(): Promise<ReadyFeature[] | null> {
  const status = await readCurrentFlywheelStatusForDashboard();
  if (!status) return null;
  const { computeMergeQueue, resolveMergeQueuePrUrl } = await import('../../../lib/flywheel-merge-order.js');
  const queue = await Effect.runPromise(
    computeMergeQueue(status.activePipeline, projectRoot(), { getPrUrl: resolveMergeQueuePrUrl }).pipe(
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

export function startUatTrainReconciler(): void {
  if (reconcilerTimer) return;
  reconcilerTimer = setInterval(() => {
    void runUatTrainReconcile().catch((err) => {
      console.warn('[uat-train] reconcile tick failed:', err instanceof Error ? err.message : err);
    });
  }, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref?.();
  void runUatTrainReconcile().catch((err) => {
    console.warn('[uat-train] initial reconcile failed:', err instanceof Error ? err.message : err);
  });
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

async function loadAcceptanceCriteriaCache(issueIds: ReadonlySet<string>): Promise<Map<string, Array<{ title: string; status: string }>>> {
  const cache = new Map<string, Array<{ title: string; status: string }>>();
  if (issueIds.size === 0) return cache;

  await Promise.all([...issueIds].map(async (issueId) => {
    try {
      const found = await Effect.runPromise(findVBriefByIssue(projectRoot(), issueId));
      if (!found) return;
      const document = await Effect.runPromise(readVBriefDocument(found.path));
      cache.set(issueId.toUpperCase(), extractACFromDocument(document).map((ac) => ({ title: ac.title, status: ac.status })));
    } catch {
      cache.set(issueId.toUpperCase(), []);
    }
  }));
  return cache;
}

/** The generation chain, newest first, enriched for the UAT batches card. */
export async function getUatGenerationsPayload(): Promise<UatGenerationPayload[]> {
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
  return promoteUatGeneration(name, root, {
    git: buildUatPromoteGitDeps(root),
    store: { ...buildUatGenerationStore(), get: (n) => getUatGenerationSync(n) },
    teardownStack: (gen) => teardownUatStack(gen),
    firePostMerge,
    log: (msg) => console.log(msg),
  });
}
