/**
 * UAT batch train service (PAN-1737) — real wiring for the reconciler,
 * assembly engine, stacks, and promote path, plus the payload builders the
 * flywheel routes expose.
 *
 * The reconciler interval is the heartbeat of "always one batch ready":
 * every 60s it compares each enabled project's pipeline-ready set against that
 * project's generation chain and assembles/invalidates as needed. Assemblies
 * run minutes — the reconciler is single-flight per project, so ticks never
 * pile up.
 */
import { stat } from 'node:fs/promises';
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
import { isMergeTrainEnabledForProject } from '../../../lib/cloister/auto-merge-policy.js';
import { listProjectsSync } from '../../../lib/projects.js';
import type { MergeCandidate } from '../../../lib/flywheel-merge-order.js';
import { extractACFromDocument } from '../../../lib/vbrief/acceptance-criteria.js';
import { findVBriefByIssue, readVBriefDocument } from '../../../lib/vbrief/vbrief-index.js';
import { buildIssueTitleMap } from './issue-title-map.js';

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

async function readySetFromCandidates(candidates: readonly MergeCandidate[], root: string): Promise<ReadyFeature[]> {
  const { computeMergeQueueFromCandidates, resolveMergeQueuePrUrl } = await import('../../../lib/flywheel-merge-order.js');
  const queue = await Effect.runPromise(
    computeMergeQueueFromCandidates(candidates, root, {
      eligibility: () => ({ eligible: true }),
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

function codenameLabel(features: readonly ReadyFeature[]): string {
  // D7 invariant: uat_generations.name is a global primary key. The label stays
  // the issue prefix so generation names remain prefix-distinct across projects.
  const prefix = features[0]?.issueId.split('-')[0];
  return (prefix ?? 'uat').toLowerCase();
}

async function assembleFromReadySet(root: string, features: readonly ReadyFeature[]): Promise<UatGeneration> {
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

async function runCleanup(root: string): Promise<void> {
  await cleanupUatGenerations(root, {
    store: buildUatGenerationStore(),
    ...buildUatGenerationCleanupGit(root),
    teardownStack: (gen) => teardownUatStack(gen),
    log: (msg) => console.log(msg),
  });
}

export type UatTrainReconcileResults = Record<string, ReconcileResult>;

/** One reconciler pass. `force` rebuilds even when a live generation matches. */
export async function runUatTrainReconcile(options: { force?: boolean; projectKey?: string } = {}): Promise<UatTrainReconcileResults> {
  const { listEligibleCandidatesByProject } = await import('../../../lib/flywheel-merge-order.js');
  const issueTitles = await buildIssueTitleMap();
  const candidatesByProject = listEligibleCandidatesByProject({
    titleFor: (issueId) => issueTitles.get(issueId) ?? issueTitles.get(issueId.toLowerCase()),
  });
  const results: UatTrainReconcileResults = {};

  for (const { key, config } of listProjectsSync()) {
    if (options.projectKey && key !== options.projectKey) continue;
    const root = config.path;
    if (!isMergeTrainEnabledForProject(key)) {
      results[key] = { action: 'disabled', invalidated: [] };
      continue;
    }

    const candidates = candidatesByProject.get(key)?.candidates ?? [];
    const liveGenerations = listUatGenerationsSync({ projectRoot: root, statuses: ['ready', 'superseded', 'assembling'] });
    if (candidates.length === 0 && liveGenerations.length === 0) {
      results[key] = { action: 'idle', invalidated: [] };
      continue;
    }

    const readySet = await readySetFromCandidates(candidates, root);
    const gitDeps = buildUatGenerationGitDeps(root);
    results[key] = await reconcileUatGenerations(root, {
      isEnabled: () => true,
      getReadySet: async () => readySet,
      getMainHeadSha: () => gitDeps.fetchMain(),
      getBranchHeadSha: (branch) => gitDeps.branchHeadSha(branch),
      store: buildUatGenerationStore(),
      assemble: (features) => assembleFromReadySet(root, features),
      teardownStack: (gen) => teardownUatStack(gen),
      cleanup: () => runCleanup(root),
      log: (msg) => console.log(msg),
    }, { force: options.force });
  }

  return results;
}

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;
let reconcilerInFlight: Promise<UatTrainReconcileResults> | null = null;

function runScheduledUatTrainReconcile(label: string): void {
  if (reconcilerInFlight) return;
  reconcilerInFlight = runUatTrainReconcile()
    .catch((err) => {
      console.warn(`[uat-train] ${label} reconcile failed:`, err instanceof Error ? err.message : err);
      return {};
    })
    .finally(() => {
      reconcilerInFlight = null;
    });
}

export function startUatTrainReconciler(): void {
  if (reconcilerTimer) return;
  reconcilerTimer = setInterval(() => {
    runScheduledUatTrainReconcile('tick');
  }, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref?.();
  runScheduledUatTrainReconcile('initial');
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

export interface ProjectUatGenerationsPayload {
  projectKey: string;
  projectName: string;
  generations: UatGenerationPayload[];
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

async function loadAcceptanceCriteriaCache(projectRootPath: string, issueIds: ReadonlySet<string>): Promise<Map<string, AcceptanceCriteriaSummary>> {
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
      const found = await Effect.runPromise(findVBriefByIssue(projectRootPath, upperIssueId));
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
export async function getUatGenerationsPayload(): Promise<ProjectUatGenerationsPayload[]> {
  const payload: ProjectUatGenerationsPayload[] = [];
  for (const { key, config } of listProjectsSync()) {
    const chain = listUatGenerationsSync({ projectRoot: config.path, limit: CHAIN_PAYLOAD_LIMIT });
    if (chain.length === 0) {
      payload.push({ projectKey: key, projectName: config.name, generations: [] });
      continue;
    }

    const memberIssueIds = new Set(chain.flatMap((gen) => gen.members.map((member) => member.issueId.toUpperCase())));
    const acCache = await loadAcceptanceCriteriaCache(config.path, memberIssueIds);
    const generations: UatGenerationPayload[] = [];
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
      generations.push({
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
    payload.push({ projectKey: key, projectName: config.name, generations });
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
  const gen = getUatGenerationSync(name);
  const root = gen?.projectRoot ?? process.cwd();
  const { reviewRecordEligibility } = await import('../../../lib/flywheel-merge-order.js');
  return promoteUatGeneration(name, root, {
    git: buildUatPromoteGitDeps(root),
    store: { ...buildUatGenerationStore(), get: (n) => getUatGenerationSync(n) },
    teardownStack: (gen) => teardownUatStack(gen),
    firePostMerge,
    memberEligibility: reviewRecordEligibility,
    log: (msg) => console.log(msg),
  });
}
