/**
 * Swarm route module — Effect HttpRouter.Layer (PAN-970)
 *
 * Implements:
 *   POST /api/swarm          — dispatch wave-parallel agents for a vBRIEF plan
 *   POST /api/swarm/refresh  — refresh swarm slot status and mergeability
 *   GET  /api/swarm/:issueId — get swarm state for an issue
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getSystemHealthSnapshot, getResourceConfig } from '../services/system-health-service.js';
import { evaluateSpawnGuardrails } from './agents.js';
import { validateOrigin } from './origin-validation.js';
import { resolveProjectFromIssue, listProjects } from '../../../lib/projects.js';
import { resolveGitHubIssue } from '../../../lib/tracker-utils.js';
import { findPlanEffect, applyStatusOverrides, VBriefMergeConflictError } from '../../../lib/vbrief/io.js';
import { readWorkspaceContinue } from '../../../lib/pan-dir/continue.js';
import { readContinueStateEffect, writeContinueStateEffect, type ContinueState, type SwarmRuntime } from '../../../lib/vbrief/continue-state.js';
import { getDispatchableItems, groupItemsByWave, hasFileOverlap, blockingParentCount, deriveSynthesisMetadata, applyTaskOperationToPlanFileEffect, compileGlob, type Wave, type WaveItem } from '../../../lib/vbrief/dag.js';
import type { VBriefDocument, VBriefItem } from '../../../lib/vbrief/types.js';
import { spawnAgent, type SpawnOptions } from '../../../lib/agents.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { normalizeModelOverride } from '../../../lib/model-validation.js';
import { listSessionNamesAsyncEffect, isPaneDeadAsyncEffect, killSessionAsyncEffect, listPaneValuesAsyncEffect } from '../../../lib/tmux.js';

const execFileAsync = promisify(execFile);

function uniqueTmpPath(path: string): string {
  return `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;
}

// ─── Swarm state persistence ────────────────────────────────────────────────

type SwarmRecoveryAction = 'retry' | 'drop' | 'handoff';

interface SlotAssignment {
  slot: number;
  itemId: string;
  itemTitle: string;
  sessionName: string;
  workspace: string;
  branch?: string;
  status: 'pending' | 'running' | 'completed' | 'merged' | 'failed' | 'failed-merge';
  /**
   * Distinguishes a synthesis dispatch (the slot only produces a synthesis context
   * for downstream consumers) from a normal implementation dispatch. Recorded so
   * onSlotMergeComplete can keep convergence items dispatchable for the real
   * implementation slot instead of marking them done after the synthesis pass.
   */
  phase?: 'synthesis' | 'implementation';
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  consecutiveConflictCount?: number;
  prUrl?: string;
  recoveryAction?: SwarmRecoveryAction;
  recoveredAt?: string;
}

// Cap synthesis output that we persist into the continue vBRIEF and forward into
// downstream agent prompts. Anything past this is rejected by the API to keep
// prompt-context blast radius bounded if the route is reached by an attacker.
const MAX_SYNTHESIS_OUTPUT_BYTES = 64 * 1024;

interface DeferredSwarmItem {
  itemId: string;
  itemTitle: string;
}

interface SwarmState {
  issueId: string;
  currentWave: number;
  totalWaves: number;
  model: string;
  autoAdvance?: boolean;
  hostOverride?: boolean;
  autoAdvanceFailureCount?: number;
  autoAdvanceRetryAfter?: string;
  lastAutoAdvanceError?: string;
  slots: SlotAssignment[];
  deferred?: DeferredSwarmItem[];
  createdAt: string;
  updatedAt: string;
}

interface SwarmDispatchRequest {
  issueId: string;
  wave?: number;
  model?: string;
  maxSlots?: number;
  autoAdvance?: boolean;
  host?: boolean;
  allowHost?: boolean;
  hostOverrideConfirmation?: string;
}

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

function canonicalIssueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const canonical = value.trim().toUpperCase();
  return ISSUE_KEY_PATTERN.test(canonical) ? canonical : null;
}

function buildHostOverrideConfirmation(issueId: string): string {
  return `I understand this bypasses workspace isolation for ${issueId.toUpperCase()}`;
}

function validateModelId(value: unknown): { ok: true; value: string | undefined } | { ok: false; error: string } {
  try {
    return { ok: true, value: normalizeModelOverride(value) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function assertPathInside(parent: string, child: string): void {
  const rel = relative(parent, child);
  if (rel.startsWith('..') || rel === '' || rel.includes(`..${'/'}`)) {
    throw new Error(`Refusing path outside ${parent}: ${child}`);
  }
}

async function readWorkspacePlanAsync(workspacePath: string, resolvedPlanPath?: string): Promise<VBriefDocument | null> {
  const planPath = resolvedPlanPath ?? (await Effect.runPromise(findPlanEffect(workspacePath)));
  if (!planPath) return null;
  try {
    const raw = await readFile(planPath, 'utf-8');
    if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
      throw new VBriefMergeConflictError(planPath);
    }
    const parsed = JSON.parse(raw);
    if (parsed.vBRIEFInfo && parsed.plan) {
      const continueState = await Effect.runPromise(readWorkspaceContinue(workspacePath));
      if (continueState?.statusOverrides && Object.keys(continueState.statusOverrides).length > 0) {
        return applyStatusOverrides(parsed as VBriefDocument, continueState.statusOverrides);
      }
      return parsed as VBriefDocument;
    }
    throw new Error(`Invalid vBRIEF format in ${planPath}`);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

interface SwarmDispatchResponseBody {
  success?: boolean;
  issueId?: string;
  wave?: number;
  totalWaves?: number;
  model?: string;
  autoAdvance?: boolean;
  dispatched?: number;
  capacity?: { current: number; limit: number; available: number };
  slots?: Array<{ slot: number; itemId: string; itemTitle: string; sessionName: string; status: SlotAssignment['status'] }>;
  deferred?: DeferredSwarmItem[];
  errors?: string[];
  wavePlan?: Wave[];
  error?: string;
  hint?: string;
  guardrails?: ReturnType<typeof evaluateSpawnGuardrails>;
}

const SWARM_AUTO_ADVANCE_POLL_MS = 5000;
const SWARM_AUTO_ADVANCE_BACKOFF_MS = 60_000;
const SWARM_AUTO_ADVANCE_BACKOFF_THRESHOLD = 3;
const SWARM_PANE_CHECK_CONCURRENCY = 10;
const SWARM_SLOT_SPAWN_CONCURRENCY = 3;
const SWARM_PR_CHECK_TIMEOUT_MS = 5000;
const KNOWN_NON_BLOCKING_MERGE_STATES = new Set(['CLEAN', 'UNSTABLE', 'BEHIND', 'HAS_HOOKS']);
const autoAdvanceInFlight = new Set<string>();
// PAN-977 blocker #2: bounded active-swarm registry. Only swarms in this set
// are polled by the auto-advance loop; the loop self-suspends when the set is
// empty so the dashboard does not scan every workspace every 5 s indefinitely.
const activeSwarmIssueIds = new Set<string>();
let autoAdvanceLoopStarted = false;
let autoAdvancePolling = false;
let autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

function getSwarmDir(): string {
  return join(homedir(), '.panopticon', 'swarms');
}

function getSwarmStatePath(issueId: string): string {
  return join(getSwarmDir(), `${issueId.toLowerCase()}.json`);
}

// PAN-977 review-round-18 blocker: continue-state readers and writers
// internally call `getContinuesDir(projectRoot)` which appends `.pan/continues/`, so
// callers must pass the **workspace root** (or project root), NOT the workspace's
// `.pan/` directory. Returning `join(workspacePath, '.pan')` made every swarm-side
// write land at `${workspace}/.pan/.pan/continues/...` while
// `work-agent-prompt.ts:99` reads from the canonical `${workspace}/.pan/continues/...`
// path — silently dropping `synthesisOutputs` delivery for every convergence-item
// work agent after the initial spawn.
function continueDirForWorkspace(workspacePath: string): string {
  return workspacePath;
}

function emptyContinueState(issueId: string, now: string): ContinueState {
  return {
    version: '1',
    issueId: issueId.toUpperCase(),
    created: now,
    updated: now,
    gitState: { branch: `feature/${issueId.toLowerCase()}`, dirty: false },
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };
}

async function loadWorkspaceContinue(workspacePath: string, issueId: string): Promise<ContinueState> {
  const now = new Date().toISOString();
  return (await Effect.runPromise(readContinueStateEffect(continueDirForWorkspace(workspacePath), issueId))) ?? emptyContinueState(issueId, now);
}

async function saveRuntimeToContinue(workspacePath: string, issueId: string, runtime: SwarmRuntime): Promise<void> {
  const continueDir = continueDirForWorkspace(workspacePath);
  await mkdir(continueDir, { recursive: true });
  const now = new Date().toISOString();
  await Effect.runPromise(writeContinueStateEffect(continueDir, issueId, (cont) => ({ ...(cont ?? emptyContinueState(issueId, now)), swarmRuntime: runtime })));
}

function stateFromRuntime(issueId: string, runtime: SwarmRuntime): SwarmState {
  const slots: SlotAssignment[] = runtime.slots.map(slot => {
    // Preserve passthrough fields (phase, failureReason, completed status)
    // that the runtime persists alongside the canonical SwarmSlotRuntime shape.
    const extra = slot as unknown as { branch?: string; phase?: 'synthesis' | 'implementation'; failureReason?: string; completedStatus?: 'completed' | 'merged'; recoveryAction?: SwarmRecoveryAction; recoveredAt?: string };
    const status = slot.status === 'failed'
      ? 'failed'
      : slot.status === 'failed-merge'
        ? 'failed-merge'
        : (slot.status as string) === 'pending'
          ? 'pending'
          : extra.completedStatus === 'completed'
            ? 'completed'
            : slot.status === 'merged'
              ? 'merged'
              : 'running';
    return {
      slot: slot.slotId,
      itemId: slot.itemId,
      itemTitle: slot.itemTitle,
      sessionName: slot.sessionName,
      workspace: slot.workspace,
      branch: extra.branch,
      status,
      phase: extra.phase,
      failureReason: extra.failureReason,
      ...(slot.consecutiveConflictCount === undefined ? {} : { consecutiveConflictCount: slot.consecutiveConflictCount }),
      ...(slot.prUrl === undefined ? {} : { prUrl: slot.prUrl }),
      ...(extra.recoveryAction === undefined ? {} : { recoveryAction: extra.recoveryAction }),
      ...(extra.recoveredAt === undefined ? {} : { recoveredAt: extra.recoveredAt }),
      startedAt: slot.dispatchedAt,
      completedAt: slot.mergedAt,
    };
  });
  return {
    issueId: issueId.toUpperCase(),
    currentWave: runtime.currentWave ?? 0,
    totalWaves: runtime.totalWaves ?? 0,
    model: runtime.model,
    autoAdvance: runtime.autoAdvance,
    hostOverride: runtime.hostOverride,
    autoAdvanceFailureCount: runtime.autoAdvanceFailureCount,
    autoAdvanceRetryAfter: runtime.autoAdvanceRetryAfter,
    lastAutoAdvanceError: runtime.lastAutoAdvanceError,
    slots,
    deferred: runtime.deferred,
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
  };
}

function runtimeFromState(state: SwarmState, existing?: SwarmRuntime): SwarmRuntime {
  const now = new Date().toISOString();
  return {
    model: state.model,
    slots: state.slots.map(slot => ({
      slotId: slot.slot,
      itemId: slot.itemId,
      itemTitle: slot.itemTitle,
      sessionName: slot.sessionName,
      workspace: slot.workspace,
      branch: slot.branch,
      // `completed` round-trips through completedStatus because SwarmSlotRuntime
      // records active terminal states separately from completed-but-unmerged work.
      status: slot.status === 'merged'
        ? 'merged'
        : slot.status === 'failed'
          ? 'failed'
          : slot.status === 'failed-merge'
            ? 'failed-merge'
            : slot.status === 'pending'
              ? ('pending' as any)
              : 'running',
      completedStatus: slot.status === 'completed' ? 'completed' : undefined,
      phase: slot.phase,
      failureReason: slot.failureReason,
      ...(slot.consecutiveConflictCount === undefined ? {} : { consecutiveConflictCount: slot.consecutiveConflictCount }),
      ...(slot.prUrl === undefined ? {} : { prUrl: slot.prUrl }),
      ...(slot.recoveryAction === undefined ? {} : { recoveryAction: slot.recoveryAction }),
      ...(slot.recoveredAt === undefined ? {} : { recoveredAt: slot.recoveredAt }),
      dispatchedAt: slot.startedAt,
      mergedAt: slot.completedAt,
    } as unknown as SwarmRuntime['slots'][number])),
    currentWave: state.currentWave,
    totalWaves: state.totalWaves,
    autoAdvance: state.autoAdvance,
    hostOverride: state.hostOverride,
    autoAdvanceFailureCount: state.autoAdvanceFailureCount,
    autoAdvanceRetryAfter: state.autoAdvanceRetryAfter,
    lastAutoAdvanceError: state.lastAutoAdvanceError,
    deferred: state.deferred,
    synthesisOutputs: existing?.synthesisOutputs ?? {},
    createdAt: existing?.createdAt ?? state.createdAt ?? now,
    updatedAt: now,
  };
}

async function persistSwarmRuntime(workspacePath: string, state: SwarmState): Promise<void> {
  const existing = (await loadWorkspaceContinue(workspacePath, state.issueId)).swarmRuntime;
  await saveRuntimeToContinue(workspacePath, state.issueId, runtimeFromState(state, existing));
}

async function persistSynthesisOutput(
  workspacePath: string,
  issueId: string,
  doc: VBriefDocument,
  item: VBriefItem,
): Promise<void> {
  const now = new Date().toISOString();
  const parentIds = doc.plan.edges.filter(edge => edge.type === 'blocks' && edge.to === item.id).map(edge => edge.from);
  const parents = parentIds
    .map(parentId => doc.plan.items.find(planItem => planItem.id === parentId))
    .filter((parent): parent is VBriefItem => Boolean(parent));
  const contextUpdate = [
    `Synthesis for convergence item ${item.id}: ${item.title}`,
    '',
    'Resolved upstream context:',
    ...parents.map(parent => `- ${parent.id}: ${parent.title} [${parent.status}]${parent.narrative?.Action ? ` — ${parent.narrative.Action}` : ''}`),
  ].join('\n');
  await Effect.runPromise(writeContinueStateEffect(continueDirForWorkspace(workspacePath), issueId, (cont) => {
    const existingRuntime = cont?.swarmRuntime ?? {
      model: DEFAULT_SWARM_MODEL,
      slots: [],
      synthesisOutputs: {},
      createdAt: now,
      updatedAt: now,
    };
    if (existingRuntime.synthesisOutputs[item.id]) return cont ?? emptyContinueState(issueId, now);
    return {
      ...(cont ?? emptyContinueState(issueId, now)),
      swarmRuntime: {
        ...existingRuntime,
        synthesisOutputs: {
          ...existingRuntime.synthesisOutputs,
          [item.id]: { targetItemId: item.id, writtenAt: now, contextUpdate },
        },
        updatedAt: now,
      },
      sessionHistory: [
        ...(cont?.sessionHistory ?? []),
        { timestamp: now, reason: 'manual', note: `swarm synthesis prepared for ${item.id}` },
      ],
    };
  }));
}

async function loadLegacySwarmState(issueId: string): Promise<SwarmState | null> {
  const path = getSwarmStatePath(issueId);
  if (!existsSync(path)) return null;
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function loadSwarmState(issueId: string): Promise<SwarmState | null> {
  const canonical = canonicalIssueId(issueId);
  if (!canonical) return null;
  const project = resolveProjectFromIssue(canonical);
  if (project) {
    const workspace = join(project.projectPath, 'workspaces', `feature-${canonical.toLowerCase()}`);
    const runtime = (await loadWorkspaceContinue(workspace, canonical)).swarmRuntime;
    // PAN-977 round-10 blocker #4: continue vBRIEF is the authority. Once a
    // runtime record exists for this issue, the legacy sidecar is no longer
    // consulted — only the canonical store. Falling back to legacy here on
    // mtime grounds let stale on-disk sidecars override fresh runtime writes
    // (notably under fake timers where Date.now()==0 yields a 1970 runtime
    // timestamp that "lost" the mtime arbitration to a 2026 sidecar mtime).
    if (runtime) {
      return stateFromRuntime(canonical, runtime);
    }
    const legacy = await loadLegacySwarmState(canonical);
    if (legacy) {
      // One-time import: convert legacy sidecar into the canonical runtime so
      // subsequent reads find the runtime branch above and never re-arbitrate.
      await persistSwarmRuntime(workspace, legacy).catch(() => undefined);
      return legacy;
    }
  }

  // Backward-compatible one-time import from the PAN-970 sidecar. All writes after
  // this point go through the continue vBRIEF runtime authority.
  const legacy = await loadLegacySwarmState(canonical);
  if (legacy && project) {
    const workspace = join(project.projectPath, 'workspaces', `feature-${canonical.toLowerCase()}`);
    await persistSwarmRuntime(workspace, legacy).catch(() => undefined);
  }
  return legacy;
}

/**
 * PAN-977 blocker #4 (round 10): the swarm sidecar
 * `~/.panopticon/swarms/<issue>.json` is no longer written. The canonical
 * runtime authority is the continue vBRIEF — `persistSwarmRuntime()` is the
 * only durable write path. `saveSwarmState` is retained as the unified mutation
 * entry point: it bumps `state.updatedAt` and routes the durable write
 * through `persistSwarmRuntime`, so call sites that previously double-wrote
 * to sidecar + continue stay correct.
 *
 * `loadSwarmState` still reads the legacy sidecar as a one-shot fallback to
 * cover the migration window for swarms that started before this version
 * shipped; that read converges them into the continue authority on first
 * touch and the on-disk file is then ignored.
 */
async function saveSwarmState(state: SwarmState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  const project = resolveProjectFromIssue(state.issueId);
  if (!project) {
    // No project resolution = no canonical workspace path = no durable runtime.
    // Surface this so callers don't report a successful state transition while
    // the authoritative continue-vBRIEF write was silently skipped.
    throw new Error(`[swarm] saveSwarmState: no project resolved for ${state.issueId}; refusing to drop runtime mutation on the floor.`);
  }
  const workspace = join(project.projectPath, 'workspaces', `feature-${state.issueId.toLowerCase()}`);
  // PAN-977 round-11 blocker #2: do NOT swallow persistence errors. The
  // continue-vBRIEF runtime is the authoritative state since the sidecar mirror
  // was removed; if this write fails the swarm has lost its durable record and
  // dispatch / slot-merge / auto-advance callers MUST observe the failure
  // (return non-2xx or record an auto-advance failure) instead of reporting
  // a phantom-successful transition.
  await persistSwarmRuntime(workspace, state);
}

async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const maxConcurrent = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: maxConcurrent }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

async function getPaneExitStatusAsync(sessionName: string): Promise<number | null> {
  try {
    const value = (await Effect.runPromise(listPaneValuesAsyncEffect(sessionName, '#{pane_dead_status}')))[0]?.trim();
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAutoAdvanceCoolingDown(state: SwarmState, now = Date.now()): boolean {
  if (!state.autoAdvanceRetryAfter) return false;
  const retryAt = Date.parse(state.autoAdvanceRetryAfter);
  return Number.isFinite(retryAt) && retryAt > now;
}

function recordAutoAdvanceFailure(state: SwarmState, error: string, now = Date.now()): SwarmState {
  const failureCount = (state.autoAdvanceFailureCount ?? 0) + 1;
  return {
    ...state,
    autoAdvanceFailureCount: failureCount,
    autoAdvanceRetryAfter:
      failureCount >= SWARM_AUTO_ADVANCE_BACKOFF_THRESHOLD
        ? new Date(now + SWARM_AUTO_ADVANCE_BACKOFF_MS).toISOString()
        : undefined,
    lastAutoAdvanceError: error,
    updatedAt: new Date(now).toISOString(),
  };
}

function fallbackSlotBranch(issueId: string, slotId: number): string {
  return `feature/${issueId.toLowerCase()}-slot-${slotId}`;
}

function slotPullRequestHead(state: SwarmState, slot: SlotAssignment): string {
  return slot.branch ?? fallbackSlotBranch(state.issueId, slot.slot);
}

function failedMergeMessage(state: SwarmState, slot: SlotAssignment): string {
  const pr = slot.prUrl ? ` PR ${slot.prUrl}` : '';
  const reason = slot.failureReason ?? 'slot PR is not mergeable';
  return `Swarm slot ${slot.slot}${pr} unmergeable: ${reason}. Recover with: pan swarm recover ${state.issueId} ${slot.slot} --action <retry|drop|handoff>`;
}

function isImplementationSlot(slot: SlotAssignment): boolean {
  return slot.phase !== 'synthesis';
}

function isRecoveredFailedMergeSlot(slot: SlotAssignment): boolean {
  return slot.status === 'failed-merge' && Boolean(slot.recoveryAction);
}

function isRetryRecoverySlot(slot: SlotAssignment): boolean {
  return slot.status === 'pending' && slot.recoveryAction === 'retry';
}

function hasNewerActiveSlotForItem(slots: SlotAssignment[], index: number): boolean {
  const slot = slots[index];
  if (!slot) return false;
  return slots.slice(index + 1).some(candidate =>
    candidate.itemId === slot.itemId
    && (candidate.status === 'running' || candidate.status === 'pending')
    && !isRetryRecoverySlot(candidate),
  );
}

function hasRetryRecoverySlotNeedingDispatch(slots: SlotAssignment[]): boolean {
  return slots.some((slot, index) => isRetryRecoverySlot(slot) && !hasNewerActiveSlotForItem(slots, index));
}

function slotKeepsSwarmPolling(slot: SlotAssignment): boolean {
  return slot.status === 'running'
    || slot.status === 'pending'
    || (slot.status === 'completed' && isImplementationSlot(slot));
}

function firstFailedSlot(state: SwarmState): SlotAssignment | undefined {
  return state.slots.find((slot) => slot.status === 'failed' || (slot.status === 'failed-merge' && !isRecoveredFailedMergeSlot(slot)));
}

function slotReadyToAdvance(slot: SlotAssignment): boolean {
  return slot.status === 'merged'
    || (slot.status === 'completed' && slot.phase === 'synthesis')
    || (slot.status === 'failed-merge' && slot.recoveryAction === 'drop');
}

function newlyFailedMergeSlots(before: SwarmState, after: SwarmState): SlotAssignment[] {
  return after.slots.filter((slot, index) => slot.status === 'failed-merge' && before.slots[index]?.status !== 'failed-merge');
}

function emitFailedMergeTransitionActivities(state: SwarmState, slots: SlotAssignment[]): void {
  for (const slot of slots) {
    emitActivityEntry({
      source: 'ship',
      level: 'error',
      issueId: state.issueId,
      message: failedMergeMessage(state, slot),
    });
  }
}

function emitFailedMergeTransitions(before: SwarmState, after: SwarmState): void {
  emitFailedMergeTransitionActivities(after, newlyFailedMergeSlots(before, after));
}

async function refreshSwarmRuntimeState(
  state: SwarmState,
  sessions?: readonly string[],
  projectPath?: string,
): Promise<{ state: SwarmState; changed: boolean; failedMergeTransitions: SlotAssignment[] }> {
  const statusRefresh = await refreshSwarmSlotStatuses(state, sessions);
  const mergeabilityRefresh = await refreshSwarmSlotMergeability(statusRefresh.state, projectPath);
  return {
    state: mergeabilityRefresh.state,
    changed: statusRefresh.changed || mergeabilityRefresh.changed,
    failedMergeTransitions: newlyFailedMergeSlots(state, mergeabilityRefresh.state),
  };
}

async function refreshSwarmIssue(issueId: string): Promise<{ status: number; body: { success?: boolean; issueId?: string; changed?: boolean; state?: SwarmState; error?: string } }> {
  const issueUpper = canonicalIssueId(issueId);
  if (!issueUpper) return { status: 400, body: { error: 'issueId must be a tracker key like PAN-977.' } };

  const state = await loadSwarmState(issueUpper);
  if (!state) return { status: 404, body: { error: `No swarm state for ${issueUpper}` } };

  const sessions = await Effect.runPromise(listSessionNamesAsyncEffect());
  const project = resolveProjectFromIssue(issueUpper);
  const refreshed = await refreshSwarmRuntimeState(state, sessions, project?.projectPath);
  if (refreshed.changed) await saveSwarmState(refreshed.state);
  emitFailedMergeTransitionActivities(refreshed.state, refreshed.failedMergeTransitions);
  return { status: 200, body: { success: true, issueId: issueUpper, changed: refreshed.changed, state: refreshed.state } };
}

async function refreshSwarmSlotStatuses(
  state: SwarmState,
  sessions?: readonly string[],
): Promise<{ state: SwarmState; changed: boolean }> {
  const liveSessions = sessions ?? await Effect.runPromise(listSessionNamesAsyncEffect());
  const runningSlots = state.slots.filter((slot) => slot.status === 'running');
  if (runningSlots.length === 0) {
    return { state, changed: false };
  }

  const slotStatuses = await runWithConcurrencyLimit(
    runningSlots,
    SWARM_PANE_CHECK_CONCURRENCY,
    async (slot) => {
      const sessionPresent = liveSessions.includes(slot.sessionName);
      const paneDead = sessionPresent ? await Effect.runPromise(isPaneDeadAsyncEffect(slot.sessionName).pipe(Effect.catch(() => Effect.succeed(false)))) : false;
      const exitStatus = sessionPresent && paneDead ? await getPaneExitStatusAsync(slot.sessionName) : null;
      return {
        sessionName: slot.sessionName,
        sessionPresent,
        paneDead,
        exitStatus,
      };
    },
  );

  const statusBySession = new Map(slotStatuses.map((slotStatus) => [slotStatus.sessionName, slotStatus]));
  let changed = false;
  const completedAt = new Date().toISOString();

  const slots = state.slots.map((slot) => {
    if (slot.status !== 'running') {
      return slot;
    }

    const slotStatus = statusBySession.get(slot.sessionName);
    if (!slotStatus) {
      changed = true;
      return {
        ...slot,
        status: 'failed' as const,
        completedAt: slot.completedAt ?? completedAt,
        failureReason: 'tmux session disappeared before completion could be confirmed',
      };
    }

    if (slotStatus.sessionPresent && !slotStatus.paneDead) {
      return slot;
    }

    changed = true;
    if (slotStatus.exitStatus === 0) {
      return {
        ...slot,
        status: 'completed' as const,
        completedAt: slot.completedAt ?? completedAt,
        failureReason: undefined,
      };
    }

    return {
      ...slot,
      status: 'failed' as const,
      completedAt: slot.completedAt ?? completedAt,
      failureReason:
        slotStatus.exitStatus == null
          ? 'tmux pane died before completion could be confirmed'
          : `tmux pane exited with status ${slotStatus.exitStatus}`,
    };
  });

  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      slots,
      updatedAt: completedAt,
    },
    changed: true,
  };
}

interface SwarmSlotPullRequest {
  number: number;
  mergeable?: boolean | null;
  mergeableState?: string | null;
  state?: string | null;
  closed?: boolean | null;
  url?: string | null;
  mergedAt?: string | null;
}

interface MergeabilityRefreshResult {
  index: number;
  slot: SlotAssignment;
}

function latestImplementationSlotsBySlotNumber(slots: SlotAssignment[]): MergeabilityRefreshResult[] {
  const targets = new Map<number, MergeabilityRefreshResult>();
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i]!;
    if (!isImplementationSlot(slot) || (slot.status !== 'running' && slot.status !== 'completed')) continue;
    const existing = targets.get(slot.slot);
    if (slot.status === 'running') {
      if (!existing || existing.slot.status !== 'running') {
        targets.set(slot.slot, { index: i, slot });
      }
      continue;
    }
    if (!existing) {
      targets.set(slot.slot, { index: i, slot });
    }
  }
  return [...targets.values()];
}

function isNonBlockingMergeState(mergeableState: string | null | undefined): boolean {
  return Boolean(mergeableState && KNOWN_NON_BLOCKING_MERGE_STATES.has(mergeableState.toUpperCase()));
}

function isConflictingMergeState(pr: SwarmSlotPullRequest): boolean {
  const state = pr.mergeableState?.toUpperCase();
  return state === 'CONFLICTING' || (pr.mergeable === false && !state);
}

function selectRelevantPullRequest(prs: SwarmSlotPullRequest[]): SwarmSlotPullRequest | undefined {
  return prs.find(pr => pr.state?.toUpperCase() !== 'CLOSED') ?? prs[0];
}

function updateSlotFromPullRequest(slot: SlotAssignment, branch: string, pr: SwarmSlotPullRequest | undefined): SlotAssignment {
  if (!pr) {
    if (slot.status !== 'completed') return slot;
    return {
      ...slot,
      status: 'failed-merge',
      failureReason: `No open PR found for ${branch}`,
      consecutiveConflictCount: undefined,
      prUrl: undefined,
    };
  }

  if (pr.state?.toUpperCase() === 'CLOSED' && !pr.mergedAt) {
    return {
      ...slot,
      status: 'failed-merge',
      failureReason: `PR #${pr.number} closed without merge`,
      consecutiveConflictCount: undefined,
      prUrl: pr.url ?? undefined,
    };
  }

  if (isConflictingMergeState(pr)) {
    const nextCount = (slot.consecutiveConflictCount ?? 0) + 1;
    if (nextCount >= 2) {
      const reason = pr.mergeableState ?? 'mergeable=false';
      return {
        ...slot,
        status: 'failed-merge',
        failureReason: `PR #${pr.number} not mergeable: ${reason}`,
        consecutiveConflictCount: nextCount,
        prUrl: pr.url ?? undefined,
      };
    }
    return {
      ...slot,
      consecutiveConflictCount: nextCount,
      prUrl: pr.url ?? slot.prUrl,
    };
  }

  if (pr.mergeable === true || isNonBlockingMergeState(pr.mergeableState)) {
    if ((slot.consecutiveConflictCount ?? 0) === 0) return slot;
    return {
      ...slot,
      consecutiveConflictCount: 0,
      prUrl: pr.url ?? slot.prUrl,
    };
  }

  return slot;
}

async function refreshSwarmSlotMergeability(
  state: SwarmState,
  projectPath?: string,
): Promise<{ state: SwarmState; changed: boolean }> {
  const resolution = resolveGitHubIssue(state.issueId);
  if (!resolution.isGitHub) return { state, changed: false };

  const targets = latestImplementationSlotsBySlotNumber(state.slots);
  if (targets.length === 0) return { state, changed: false };

  const repo = `${resolution.owner}/${resolution.repo}`;
  const updates = await runWithConcurrencyLimit(
    targets,
    SWARM_PANE_CHECK_CONCURRENCY,
    async ({ index, slot }) => {
      const branch = slotPullRequestHead(state, slot);
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'number,mergeable,mergeableState,state,closed,url,mergedAt', '--limit', '5'],
          { encoding: 'utf-8', signal: AbortSignal.timeout(SWARM_PR_CHECK_TIMEOUT_MS), cwd: projectPath },
        );
        const prs = JSON.parse(stdout) as SwarmSlotPullRequest[];
        return { index, slot: updateSlotFromPullRequest(slot, branch, selectRelevantPullRequest(prs)) };
      } catch {
        return { index, slot };
      }
    },
  );

  const slots = [...state.slots];
  let changed = false;
  for (const update of updates) {
    if (update.slot !== state.slots[update.index]) {
      changed = true;
      slots[update.index] = update.slot;
    }
  }

  if (!changed) return { state, changed: false };
  return {
    state: {
      ...state,
      slots,
      updatedAt: new Date().toISOString(),
    },
    changed: true,
  };
}

async function dispatchSwarmWave(
  request: SwarmDispatchRequest,
): Promise<{ status: number; body: SwarmDispatchResponseBody }> {
  const { wave: requestedWave, model: requestedModel, maxSlots, autoAdvance, allowHost } = request;
  const issueUpper = canonicalIssueId(request.issueId);
  if (!issueUpper) {
    return { status: 400, body: { error: 'issueId must be a tracker key like PAN-977.' } };
  }
  // Defense-in-depth: dispatchSwarmWave is called from the API route AND from auto-advance
  // and onSlotMergeComplete (which read model from persisted state). Re-validate here so a
  // tampered state file cannot inject shell metacharacters into runtime launcher commands.
  const modelGuard = validateModelId(requestedModel);
  if (modelGuard.ok === false) {
    return { status: 400, body: { error: modelGuard.error } };
  }
  const issueLower = issueUpper.toLowerCase();

  const project = resolveProjectFromIssue(issueUpper);
  if (!project) {
    return {
      status: 404,
      body: { error: `Could not resolve project for ${issueUpper}` },
    };
  }

  const workspacesDir = join(project.projectPath, 'workspaces');
  const mainWorkspace = join(workspacesDir, `feature-${issueLower}`);
  assertPathInside(workspacesDir, mainWorkspace);
  if (!existsSync(mainWorkspace)) {
    return {
      status: 404,
      body: {
        error: `No workspace found for ${issueUpper}`,
        hint: 'Create a workspace first: pan start ' + issueUpper,
      },
    };
  }

  const canonicalPlanPath = await Effect.runPromise(findPlanEffect(mainWorkspace));
  if (!canonicalPlanPath) {
    return {
      status: 422,
      body: {
        error: `No vBRIEF plan found for ${issueUpper}`,
        hint: 'Run planning first to produce a vBRIEF plan.',
      },
    };
  }

  let doc = await readWorkspacePlanAsync(mainWorkspace, canonicalPlanPath);
  if (!doc) {
    return {
      status: 422,
      body: {
        error: `No vBRIEF plan found for ${issueUpper}`,
        hint: 'Run planning first to produce a vBRIEF plan.',
      },
    };
  }

  let annotatedDoc = deriveSynthesisMetadata(doc);
  const waves = groupItemsByWave(annotatedDoc);
  const existingState = await loadSwarmState(issueUpper);
  const continueState = await loadWorkspaceContinue(mainWorkspace, issueUpper);
  // PAN-977 round-14 blocker: only 'merged' slots may satisfy DAG dependencies.
  // A 'completed' slot is one whose tmux pane exited cleanly in its own
  // worktree — the slot's commits are NOT yet on the parent feature branch
  // until /api/swarm/slot-merged transitions it to 'merged'. Treating
  // 'completed' as merged here would dispatch downstream slots against stale
  // parent-branch files and break dependency ordering.
  const mergedItemIds = new Set<string>([
    ...(continueState.swarmRuntime?.slots ?? [])
      .filter(slot => slot.status === 'merged')
      .map(slot => slot.itemId),
    ...(existingState?.slots ?? [])
      .filter(slot => slot.status === 'merged')
      .map(slot => slot.itemId),
  ]);
  const runningItems = (continueState.swarmRuntime?.slots ?? [])
    .filter(slot => slot.status === 'running')
    .map(slot => annotatedDoc.plan.items.find(item => item.id === slot.itemId))
    .filter((item): item is VBriefItem => Boolean(item));
  const dispatchable = getDispatchableItems(annotatedDoc, mergedItemIds)
    .filter(item => !mergedItemIds.has(item.id));

  let readyItems: VBriefItem[];
  if (existingState?.deferred?.length) {
    const deferredIds = new Set(existingState.deferred.map(d => d.itemId));
    readyItems = dispatchable.filter(item => deferredIds.has(item.id));
    // Drop stale deferred entries that are no longer dispatchable (blocked,
    // cancelled, completed, already running, or dependency-not-ready).
    const stillDispatchableIds = new Set(readyItems.map(item => item.id));
    if (existingState.deferred.some(d => !stillDispatchableIds.has(d.itemId))) {
      existingState.deferred = existingState.deferred.filter(d => stillDispatchableIds.has(d.itemId));
    }
  } else {
    readyItems = dispatchable;
  }

  const waveIndex = requestedWave ?? existingState?.currentWave ?? 0;
  const requestedWaveItems = waves[waveIndex]?.items;
  if (!requestedWaveItems) {
    return {
      status: 400,
      body: { error: `Wave ${waveIndex} does not exist for ${issueUpper}.`, wavePlan: waves },
    };
  }
  if (requestedWave !== undefined && !existingState?.deferred?.length) {
    const waveItemIds = new Set(requestedWaveItems.map(item => item.id));
    readyItems = readyItems.filter(item => waveItemIds.has(item.id));
  }

  // Health check and capacity calculation BEFORE overlap-selection pass
  // so the expensive overlap loop is bounded by actual dispatch capacity.
  const health = await getSystemHealthSnapshot();
  const guardrails = evaluateSpawnGuardrails(health);
  if (guardrails.blocked) {
    return {
      status: guardrails.status,
      body: {
        error: guardrails.error,
        hint: guardrails.hint,
        guardrails,
      },
    };
  }

  const swarmModel = modelGuard.value || DEFAULT_SWARM_MODEL;
  const resourceConfig = getResourceConfig();
  const envLimit = process.env['PAN_AGENT_BLOCK_COUNT'];
  const parsedEnvLimit = envLimit !== undefined ? Number(envLimit) : undefined;
  const hardLimit: number = (Number.isFinite(parsedEnvLimit) ? parsedEnvLimit : resourceConfig.agentBlockCount) ?? 0;
  const currentAgents = health.summary.workAgentCount;
  const systemAvailable = Math.max(0, hardLimit - currentAgents);

  if (systemAvailable === 0) {
    return {
      status: 429,
      body: {
        error: `No agent capacity available (${currentAgents}/${hardLimit} agents running).`,
        hint: 'Wait for running agents to finish or stop some before dispatching a swarm.',
      },
    };
  }

  const userMax = maxSlots ?? 4;
  if (!Number.isInteger(userMax) || userMax <= 0) {
    return {
      status: 400,
      body: {
        error: 'maxSlots must be a positive integer.',
      },
    };
  }

  const maxConcurrent = Math.min(userMax, systemAvailable);

  // Precompile files_scope patterns once per dispatch to avoid recompiling
  // on every comparison inside hasFileOverlap.
  const precompiledScopes = new Map<string, ReturnType<typeof compileGlob>[]>();
  for (const item of readyItems) {
    const scope = item.metadata?.files_scope;
    if (scope && scope.length > 0) {
      precompiledScopes.set(item.id, scope.map(compileGlob));
    }
  }

  const selectedItems: VBriefItem[] = [];
  const deferredByOverlap: VBriefItem[] = [];
  const deferredByCapacity: VBriefItem[] = [];
  for (const item of readyItems) {
    if (selectedItems.length >= maxConcurrent) {
      deferredByCapacity.push(item);
      continue;
    }
    if (hasFileOverlap([...runningItems, ...selectedItems], item, precompiledScopes)) {
      deferredByOverlap.push(item);
      continue;
    }
    selectedItems.push(item);
  }
  const candidates = selectedItems;
  if (candidates.length === 0) {
    return {
      status: 422,
      body: {
        error: `No dispatchable items in the plan for ${issueUpper}`,
        hint: readyItems.length > 0
          ? 'Ready items are waiting for overlapping files_scope work to finish.'
          : 'All items may already be running, completed, blocked, or waiting on dependencies.',
        wavePlan: waves,
      },
    };
  }

  const itemById = new Map(annotatedDoc.plan.items.map((planItem) => [planItem.id, planItem]));
  const pendingItems: WaveItem[] = candidates.map(item => ({
    id: item.id,
    title: item.title,
    difficulty: item.metadata?.difficulty,
    blockedBy: annotatedDoc.plan.edges
      .filter(edge => edge.type === 'blocks' && edge.to === item.id)
      .map(edge => edge.from),
  }));

  const itemsToDispatch = pendingItems;

  // PAN-977: when dispatching by DAG readiness without an explicit wave,
  // derive the persisted currentWave from the max wave index of dispatched
  // items. This prevents multi-wave auto-advance swarms from recording a
  // stale wave-0 currentWave after later-wave items have been dispatched.
  const persistedWaveIndex = requestedWave !== undefined
    ? waveIndex
    : Math.max(
        waveIndex,
        ...itemsToDispatch.map(item => {
          const foundWave = waves.find(w => w.items.some(wi => wi.id === item.id));
          return foundWave ? foundWave.index : waveIndex;
        }),
      );

  const deferredItems = [
    ...deferredByCapacity.map(item => ({
      id: item.id,
      title: item.title,
      difficulty: item.metadata?.difficulty,
      blockedBy: annotatedDoc.plan.edges
        .filter(edge => edge.type === 'blocks' && edge.to === item.id)
        .map(edge => edge.from),
    })),
    ...deferredByOverlap.map(item => ({
      id: item.id,
      title: item.title,
      difficulty: item.metadata?.difficulty,
      blockedBy: annotatedDoc.plan.edges
        .filter(edge => edge.type === 'blocks' && edge.to === item.id)
        .map(edge => edge.from),
    })),
  ];

  const existingSessions = await Effect.runPromise(listSessionNamesAsyncEffect());
  const existingSwarmSessions = existingSessions.filter(
    s => s.startsWith(`agent-${issueLower}-`) && /agent-[a-z0-9-]+-\d+$/.test(s),
  );

  const aliveSlots = new Set<string>();
  const sessionLiveness = await runWithConcurrencyLimit(
    existingSwarmSessions,
    SWARM_PANE_CHECK_CONCURRENCY,
    async (sessionName) => {
      const paneDead = await Effect.runPromise(isPaneDeadAsyncEffect(sessionName).pipe(Effect.catch(() => Effect.succeed(false))));
      if (paneDead) {
        await Effect.runPromise(killSessionAsyncEffect(sessionName).pipe(Effect.catch(() => Effect.void)));
        return { sessionName, alive: false };
      }
      return { sessionName, alive: true };
    },
  );

  for (const session of sessionLiveness) {
    if (session.alive) {
      aliveSlots.add(session.sessionName);
    }
  }

  // PAN-977 round-16 blocker #1: allocate slot numbers from the set of free
  // slots, NOT from the positional index in itemsToDispatch. Reusing
  // `index + 1` failed to dispatch valid ready work whenever a low-numbered
  // slot was still occupied by a running/pending dispatch from a prior wave
  // even when higher slot ids were free, stalling auto-advance despite
  // available capacity.
  //
  // Occupied set = live tmux sessions ∪ existingState slots whose status
  // is `running` or `pending`. The dispatcher walks slot ids 1..∞ and hands
  // out the lowest free id to each item. Inside the per-item closure the
  // live-session collision check still fires if the chosen slot becomes
  // alive between allocation and spawn (race-only path, surfaced as an
  // error rather than silent aliasing).
  const occupiedSlotIds = new Set<number>();
  for (const sessionName of aliveSlots) {
    const match = /-(\d+)$/.exec(sessionName);
    if (match) {
      const n = Number.parseInt(match[1]!, 10);
      if (Number.isInteger(n) && n > 0) occupiedSlotIds.add(n);
    }
  }
  for (const slot of (existingState?.slots ?? [])) {
    if (slot.status === 'running' || slot.status === 'pending') {
      occupiedSlotIds.add(slot.slot);
    }
  }
  const allocateNextFreeSlot = (): number => {
    for (let candidate = 1; ; candidate += 1) {
      if (!occupiedSlotIds.has(candidate)) {
        occupiedSlotIds.add(candidate);
        return candidate;
      }
    }
  };
  const itemSlotAssignments = itemsToDispatch.map((item) => ({
    item,
    slotNum: allocateNextFreeSlot(),
  }));

  const dispatched: SlotAssignment[] = [];
  const errors: string[] = [];
  const planPath = canonicalPlanPath;

  const slotResults = await runWithConcurrencyLimit(
    itemSlotAssignments,
    SWARM_SLOT_SPAWN_CONCURRENCY,
    async (assignment) => {
      const { item, slotNum } = assignment;
      const sessionName = `agent-${issueLower}-${slotNum}`;

      // PAN-977 round-15 blocker: compute the phase BEFORE the live-session
      // alias check so the reuse guard can compare phases, not just itemIds.
      // A completed synthesis slot for `item.id` whose tmux session is still
      // alive must NOT be aliased as the implementation dispatch for the same
      // item — that silently skips the implementation work entirely.
      const fullItemForPhase = itemById.get(item.id);
      const requiresSynthesis = Boolean(fullItemForPhase && (fullItemForPhase.metadata?.requiresSynthesis || blockingParentCount(annotatedDoc, fullItemForPhase.id) > 1));
      const persistedSynthesis = continueState.swarmRuntime?.synthesisOutputs?.[item.id];
      const hasSynthesisOutput = Boolean(persistedSynthesis);
      const dispatchSynthesisFirst = requiresSynthesis && !hasSynthesisOutput;
      const requestedPhase: 'synthesis' | 'implementation' = dispatchSynthesisFirst ? 'synthesis' : 'implementation';

      if (aliveSlots.has(sessionName)) {
        // PAN-977 blocker #3: a live session-name collision MUST NOT be silently
        // counted as a successful dispatch for a *different* item — the prompt
        // for the new item would never reach the running agent.
        const existingSlot = existingState?.slots?.find(s => s.sessionName === sessionName);
        // PAN-977 round-15 blocker: only reuse the slot when the in-flight
        // dispatch matches BOTH the same item AND the same phase AND is still
        // 'running'. A 'completed' synthesis slot whose tmux pane has not yet
        // torn down looks "alive" to listSessionNames, but the synthesis is
        // done — aliasing it as the implementation dispatch would skip the
        // real implementation. Same item + different phase, or any non-running
        // status, falls through to the surface-collision branch below.
        if (
          existingSlot
          && existingSlot.itemId === item.id
          && existingSlot.status === 'running'
          && existingSlot.phase === requestedPhase
        ) {
          // Same item, same phase, still running — re-dispatch poll racing
          // an agent that is genuinely in-flight. Safe to keep the existing
          // assignment.
          return {
            slot: slotNum,
            itemId: item.id,
            itemTitle: item.title,
            sessionName,
            workspace: existingSlot.workspace ?? '',
            branch: existingSlot.branch,
            status: 'running' as const,
            phase: existingSlot.phase,
            startedAt: existingSlot.startedAt,
          } satisfies SlotAssignment;
        }
        // The session is alive but tied to a *different* item, a *different*
        // phase, OR the previous occupant has already reported
        // `completed`/`merged`/`failed` and is just waiting on tmux teardown.
        // Either way, refuse to alias — the next dispatch must reap the
        // lingering session first or pick a fresh slot id. Surface a clear
        // error rather than silently mis-routing work.
        const previousStatus = existingSlot?.status ?? 'unknown';
        const previousItemId = existingSlot?.itemId ?? 'an unknown item';
        const previousPhase = existingSlot?.phase ?? 'unknown';
        return `Slot ${slotNum} (${item.id}): tmux session ${sessionName} is already alive (previous occupant ${previousItemId}, phase=${previousPhase}, status=${previousStatus}); refusing to alias onto a live slot whose dispatch does not match the requested phase=${requestedPhase}. Reap the session (kill or let the agent exit) before re-dispatching.`;
      }

      const worktreeResult = await createSlotWorktree(project.projectPath, issueUpper, slotNum);
      if (!worktreeResult.success) {
        return `Slot ${slotNum}: failed to create worktree — ${worktreeResult.error}`;
      }

      if (planPath) {
        const slotPanDir = join(worktreeResult.workspacePath, '.pan');
        await mkdir(slotPanDir, { recursive: true });
        const slotPlanPath = join(slotPanDir, 'spec.vbrief.json');
        const tmpSlotPlanPath = uniqueTmpPath(slotPlanPath);
        try {
          const planContent = await readFile(planPath, 'utf-8');
          await writeFile(tmpSlotPlanPath, planContent, 'utf-8');
          await rename(tmpSlotPlanPath, slotPlanPath);
        } catch (err: any) {
          await unlink(tmpSlotPlanPath).catch(() => {});
          return `Slot ${slotNum}: failed to refresh slot-local vBRIEF — ${err?.message ?? err}`;
        }
      }

      // requiresSynthesis / persistedSynthesis / hasSynthesisOutput /
      // dispatchSynthesisFirst / requestedPhase are computed above so the
      // live-session reuse guard can compare phases. Reuse them here.
      const itemPrompt = dispatchSynthesisFirst
        ? buildSynthesisPrompt(
            annotatedDoc,
            issueUpper,
            item,
            waveIndex,
            slotNum,
            worktreeResult.parentBranch,
            continueState.swarmRuntime?.slots ?? [],
          )
        : buildSlotPrompt(
        annotatedDoc,
        issueUpper,
        item,
        waveIndex,
        slotNum,
        worktreeResult.branch,
        worktreeResult.parentBranch,
        itemById,
        persistedSynthesis?.contextUpdate,
      );

      // PAN-977 blocker #1: claim BEFORE spawn so the canonical vBRIEF is the
      // gate. If the CAS claim fails, no agent is spawned. If spawn fails after
      // a successful claim, release the claim (`unblock`) so the next dispatch
      // can retry — never leave an orphan claim with no live agent.
      try {
        await Effect.runPromise(applyTaskOperationToPlanFileEffect(canonicalPlanPath, {
          type: 'claim',
          itemId: item.id,
          reason: dispatchSynthesisFirst
            ? `Swarm slot ${slotNum} dispatched (synthesis phase)`
            : `Swarm slot ${slotNum} dispatched`,
          writerId: `swarm-dispatch-${process.pid}`,
        }, mainWorkspace));
      } catch (claimErr: any) {
        return `Slot ${slotNum} (${item.id}): canonical vBRIEF claim failed — ${claimErr.message}`;
      }

      try {
        const spawnOptions: SpawnOptions = {
          issueId: issueUpper,
          workspace: worktreeResult.workspacePath,
          model: swarmModel,
          slotId: slotNum,
          swarmItemId: item.id,
          prompt: itemPrompt,
          phase: dispatchSynthesisFirst ? 'synthesis' : 'implementation',
          ...(allowHost ? { allowHost: true } : {}),
        };

        await spawnAgent(spawnOptions);

        const refreshedDoc = await readWorkspacePlanAsync(mainWorkspace);
        if (refreshedDoc) {
          doc = refreshedDoc;
          annotatedDoc = deriveSynthesisMetadata(doc);
        }

        return {
          slot: slotNum,
          itemId: item.id,
          itemTitle: item.title,
          sessionName,
          workspace: worktreeResult.workspacePath,
          branch: worktreeResult.branch,
          status: 'running' as const,
          phase: dispatchSynthesisFirst ? ('synthesis' as const) : ('implementation' as const),
          startedAt: new Date().toISOString(),
        } satisfies SlotAssignment;
      } catch (err: any) {
        // Spawn failed after the claim landed — release the item so the next
        // dispatch cycle can retry. If the release itself fails, the next poll
        // can repair it; record the original spawn error either way.
        await Effect.runPromise(applyTaskOperationToPlanFileEffect(canonicalPlanPath, {
          type: 'unblock',
          itemId: item.id,
          reason: `Spawn failed for slot ${slotNum}; releasing claim for retry`,
          writerId: `swarm-dispatch-${process.pid}`,
        }, mainWorkspace)).catch((releaseErr: any) => {
          console.warn(`[swarm] Failed to release claim after spawn error for ${item.id}: ${releaseErr.message}`);
        });
        return `Slot ${slotNum} (${item.id}): ${err.message}`;
      }
    },
  );

  for (const slotResult of slotResults) {
    if (typeof slotResult === 'string') {
      errors.push(slotResult);
    } else {
      dispatched.push(slotResult);
    }
  }

  if (itemsToDispatch.length > 0 && dispatched.length === 0) {
    return {
      status: 500,
      body: {
        error: `Failed to dispatch any slots for ${issueUpper} wave ${waveIndex}.`,
        hint: 'Resolve the slot creation or agent spawn errors, then retry the swarm wave.',
        errors,
        wavePlan: waves,
      },
    };
  }

  // PAN-977 blocker #4: persist slots cumulatively across dispatch cycles.
  // The previous implementation overwrote `slots` with the latest dispatch
  // batch, dropping prior running/merged slots and weakening file-overlap and
  // merge-state readiness checks downstream. We now keep prior slot records
  // (including terminal `completed`/`merged`/`failed` ones) and only dedupe
  // when the SAME `(slot, itemId)` pair is being re-dispatched — that is the
  // only safe overwrite, because the old record describes the same task as
  // the new one. Reusing slot id 1 for a different item id appends a new
  // record alongside the prior history.
  const newKeys = new Set(dispatched.map(s => `${s.slot}::${s.itemId}`));
  const dispatchedItemIds = new Set(dispatched.map(s => s.itemId));
  const carriedSlots: SlotAssignment[] = (existingState?.slots ?? [])
    .filter(prior => !newKeys.has(`${prior.slot}::${prior.itemId}`))
    .filter(prior => !(isRetryRecoverySlot(prior) && dispatchedItemIds.has(prior.itemId)));
  const cumulativeSlots: SlotAssignment[] = [...carriedSlots, ...dispatched];

  const state: SwarmState = {
    issueId: issueUpper,
    currentWave: persistedWaveIndex,
    totalWaves: waves.length,
    model: swarmModel,
    autoAdvance: autoAdvance ?? existingState?.autoAdvance ?? false,
    hostOverride: allowHost || existingState?.hostOverride || false,
    autoAdvanceFailureCount: 0,
    autoAdvanceRetryAfter: undefined,
    lastAutoAdvanceError: undefined,
    slots: cumulativeSlots,
    deferred: deferredItems.length > 0
      ? deferredItems.map((item) => ({ itemId: item.id, itemTitle: item.title }))
      : undefined,
    createdAt: existingState?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // PAN-977 round-11 high-2: saveSwarmState() now routes through
  // persistSwarmRuntime() and propagates errors, so a separate
  // persistSwarmRuntime() here would just be a duplicate canonical write.
  await saveSwarmState(state);

  if (state.autoAdvance) {
    activeSwarmIssueIds.add(issueUpper);
    ensureSwarmAutoAdvanceLoop();
  }

  return {
    status: 200,
    body: {
      success: true,
      issueId: issueUpper,
      wave: persistedWaveIndex,
      totalWaves: waves.length,
      model: swarmModel,
      autoAdvance: state.autoAdvance,
      dispatched: dispatched.length,
      capacity: { current: currentAgents, limit: hardLimit, available: systemAvailable },
      slots: dispatched.map(s => ({
        slot: s.slot,
        itemId: s.itemId,
        itemTitle: s.itemTitle,
        sessionName: s.sessionName,
        status: s.status,
      })),
      deferred: state.deferred,
      errors: errors.length > 0 ? errors : undefined,
      wavePlan: waves,
    },
  };
}

async function onSlotMergeComplete(issueId: string, itemId: string, slotId: number, synthesisOutput?: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const issueUpper = canonicalIssueId(issueId);
  if (!issueUpper) return { ok: false, status: 400, error: 'invalid issueId' };
  const project = resolveProjectFromIssue(issueUpper);
  if (!project) return { ok: false, status: 404, error: `no project resolved for ${issueUpper}` };
  const mainWorkspace = join(project.projectPath, 'workspaces', `feature-${issueUpper.toLowerCase()}`);
  const canonicalPlanPath = await Effect.runPromise(findPlanEffect(mainWorkspace));
  if (!canonicalPlanPath) {
    return { ok: false, status: 422, error: `No canonical vBRIEF plan found for ${issueUpper}` };
  }
  const now = new Date().toISOString();
  const state = await loadSwarmState(issueUpper);
  // If caller could not provide itemId (e.g. merge-agent only knows slot number),
  // resolve it from runtime state. This is required so the canonical vBRIEF plan
  // gets the matching `done` task operation below.
  let resolvedItemId = itemId;
  let matchedSlot: SlotAssignment | undefined;
  let matchedSlotIndex = -1;
  if (state) {
    // PAN-977 round-11 blocker #1: numeric slot ids can recur across cumulative
    // history (slot 1 used by item-A in wave 0, then by item-B in wave 1).
    // Array.find() returned the OLDEST matching record and the downstream
    // status mapping mutated *every* record sharing the slot or itemId,
    // which could mark a stale historical entry done while the actual current
    // dispatch kept running. Resolve unambiguously:
    //   1. If caller supplied a non-empty itemId, prefer the (slotId,itemId)
    //      tuple — that is the unique key we record at dispatch time.
    //   2. Otherwise reverse-scan and prefer 'running' over already-merged/completed
    //      historical entries, falling back to the most recent matching slot.
    // Then mutate ONLY that resolved record below.
    if (resolvedItemId && resolvedItemId.length > 0) {
      for (let i = state.slots.length - 1; i >= 0; i--) {
        const s = state.slots[i]!;
        if (s.slot === slotId && s.itemId === resolvedItemId) {
          matchedSlot = s;
          matchedSlotIndex = i;
          break;
        }
      }
    }
    if (!matchedSlot) {
      for (let i = state.slots.length - 1; i >= 0; i--) {
        const s = state.slots[i]!;
        if (s.slot !== slotId) continue;
        if (s.status === 'running') {
          matchedSlot = s;
          matchedSlotIndex = i;
          break;
        }
        if (matchedSlotIndex === -1) {
          matchedSlot = s;
          matchedSlotIndex = i;
        }
      }
    }
    if (matchedSlot && (!resolvedItemId || resolvedItemId.length === 0)) {
      resolvedItemId = matchedSlot.itemId;
    }
  }
  // PAN-977 blocker #2: a synthesis-phase slot only generates context for the
  // downstream implementation slot. Marking the convergence item `done` here
  // would skip implementation entirely. Detect synthesis via either the recorded
  // slot.phase OR the presence of `synthesisOutput` in the request, persist the
  // synthesis context, and release (`unblock`) the item so the next dispatch
  // call picks it up as an implementation slot (hasSynthesisOutput=true ⇒
  // buildSlotPrompt receives the persisted context).
  const isSynthesisCompletion = Boolean(synthesisOutput) || matchedSlot?.phase === 'synthesis';

  // If the swarm runtime is missing and we couldn't resolve an itemId from it,
  // we cannot perform any durable mutation. Return non-2xx so the merge-agent
  // writes a retry marker rather than silently believing the slot was handled.
  if (!state && (!resolvedItemId || resolvedItemId.length === 0)) {
    return { ok: false, status: 500, error: `Swarm runtime not found for ${issueUpper} and itemId could not be resolved from slot ${slotId}` };
  }

  // PAN-977 blocker: the canonical vBRIEF task transition must land even when
  // the swarm runtime state is missing, as long as we know which item to mutate.
  // Only the runtime-slot bookkeeping is gated on state existence.
  if (resolvedItemId) {
    try {
      if (isSynthesisCompletion) {
        await Effect.runPromise(applyTaskOperationToPlanFileEffect(canonicalPlanPath, {
          type: 'unblock',
          itemId: resolvedItemId,
          reason: `Synthesis context delivered by slot ${slotId}; released for implementation dispatch`,
          writerId: `swarm-synth-${process.pid}`,
        }, mainWorkspace));
      } else {
        await Effect.runPromise(applyTaskOperationToPlanFileEffect(canonicalPlanPath, {
          type: 'done',
          itemId: resolvedItemId,
          reason: `Swarm slot ${slotId} merged into feature branch`,
          writerId: `swarm-merge-${process.pid}`,
        }, mainWorkspace));
      }
    } catch (mutationErr: any) {
      // Persist a retry-needed marker on the slot so the next reconciliation
      // pass can repair it, then bubble the failure up so the HTTP route
      // returns non-2xx and the caller knows to retry.
      if (state) {
        try {
          const retryNote = `vBRIEF task mutation failed: ${mutationErr.message}`;
          // PAN-977 round-11 blocker #1: only flag the resolved slot index, not
          // every historical record sharing the numeric slot.
          const retrySlots = matchedSlotIndex >= 0
            ? state.slots.map((s, idx) => idx === matchedSlotIndex
              ? { ...s, status: 'failed' as const, failureReason: retryNote }
              : s)
            : state.slots;
          const retryState = { ...state, slots: retrySlots, lastAutoAdvanceError: retryNote, updatedAt: new Date().toISOString() };
          await saveSwarmState(retryState);
        } catch { /* best effort — original error still propagates */ }
      }
      return {
        ok: false,
        status: 500,
        error: `Failed to apply canonical vBRIEF mutation for ${resolvedItemId}: ${mutationErr.message}`,
      };
    }
  }

  if (state) {
    // PAN-977 round-11 blocker #1: mutate ONLY the resolved slot index. Older
    // history records with the same numeric slot or itemId stay untouched, so
    // their `status` and `completedAt` reflect the actual dispatch they belong
    // to. If we couldn't resolve a slot at all (matchedSlotIndex < 0) the
    // canonical record is a no-op write — auto-advance below still runs in
    // case readiness changed via other slots.
    const slots = matchedSlotIndex >= 0
      ? state.slots.map((slot, idx) => idx === matchedSlotIndex
        ? {
            ...slot,
            status: isSynthesisCompletion ? ('completed' as const) : ('merged' as const),
            completedAt: slot.completedAt ?? now,
          }
        : slot)
      : state.slots;
    const nextState = { ...state, slots, updatedAt: now };
    try {
      await saveSwarmState(nextState);
    } catch (persistErr: any) {
      return {
        ok: false,
        status: 500,
        error: `Failed to persist canonical swarm runtime for ${issueUpper} slot ${slotId}: ${persistErr?.message ?? persistErr}`,
      };
    }
    if (synthesisOutput && resolvedItemId) {
      await Effect.runPromise(writeContinueStateEffect(continueDirForWorkspace(mainWorkspace), issueUpper, (cont) => {
        const runtime = cont?.swarmRuntime ?? runtimeFromState(nextState);
        return {
          ...(cont ?? emptyContinueState(issueUpper, now)),
          swarmRuntime: {
            ...runtime,
            synthesisOutputs: {
              ...runtime.synthesisOutputs,
              [resolvedItemId]: { targetItemId: resolvedItemId, writtenAt: now, contextUpdate: synthesisOutput },
            },
            updatedAt: now,
          },
        };
      }));
    }

    let dispatched = false;
    if (nextState.autoAdvance) {
      // PAN-977 blocker #3: do NOT pass `wave` here — auto-advance must dispatch
      // any newly-ready items per-DAG-readiness, not the next wave by index.
      // dispatchSwarmWave with an undefined `wave` falls through to
      // getDispatchableItems(), which reflects the durable mutation we just
      // applied above.
      const result = await dispatchSwarmWave({ issueId: issueUpper, model: nextState.model, autoAdvance: true, allowHost: nextState.hostOverride });
      if (result.status >= 400) ensureSwarmAutoAdvanceLoop();
      else dispatched = true;
    }

    // PAN-977 round-12 blocker #1: registry-cleanup MUST consult post-dispatch
    // state. The pre-dispatch `slots` snapshot only contains records up to and
    // including the just-merged slot — if dispatchSwarmWave just spawned slot B
    // for a freshly-ready DAG item, deleting the issue from
    // activeSwarmIssueIds here would strand slot B without an auto-advance
    // poller. Reload the canonical runtime and decide cleanup from the
    // observed running/pending/deferred set instead.
    if (dispatched) {
      // A fresh slot was dispatched; the swarm is by definition still active.
      // Make sure the poll loop is running and skip the cleanup branch entirely.
      ensureSwarmAutoAdvanceLoop();
    } else {
      const latest = await loadSwarmState(issueUpper).catch(() => null);
      const obs = latest ?? nextState;
      const stillActive = obs.slots.some(slot => slot.status === 'running' || slot.status === 'pending');
      if (!stillActive && (!obs.deferred || obs.deferred.length === 0)) {
        activeSwarmIssueIds.delete(issueUpper);
      }
    }
  } else if (synthesisOutput && resolvedItemId) {
    await Effect.runPromise(writeContinueStateEffect(continueDirForWorkspace(mainWorkspace), issueUpper, (cont) => {
      const runtime = cont?.swarmRuntime ?? {
        model: DEFAULT_SWARM_MODEL,
        slots: [],
        synthesisOutputs: {},
        createdAt: now,
        updatedAt: now,
      } satisfies SwarmRuntime;
      return {
        ...(cont ?? emptyContinueState(issueUpper, now)),
        swarmRuntime: {
          ...runtime,
          synthesisOutputs: {
            ...runtime.synthesisOutputs,
            [resolvedItemId]: { targetItemId: resolvedItemId, writtenAt: now, contextUpdate: synthesisOutput },
          },
          updatedAt: now,
        },
      };
    }));
  }
  return { ok: true };
}

interface SwarmRecoveryResultBody {
  ok?: boolean;
  action?: SwarmRecoveryAction;
  slotId?: number;
  issueId?: string;
  error?: string;
}

function clearAutoAdvanceFailureFields(state: SwarmState): SwarmState {
  return {
    ...state,
    autoAdvanceFailureCount: 0,
    autoAdvanceRetryAfter: undefined,
    lastAutoAdvanceError: undefined,
  };
}

function latestFailedMergeSlotIndex(state: SwarmState, slotId: number): number {
  for (let i = state.slots.length - 1; i >= 0; i--) {
    const slot = state.slots[i]!;
    if (slot.slot === slotId && slot.status === 'failed-merge' && !slot.recoveryAction) return i;
  }
  return -1;
}

async function recoverSwarmSlot(
  issueId: string,
  slotId: number,
  action: SwarmRecoveryAction,
): Promise<{ status: number; body: SwarmRecoveryResultBody }> {
  const issueUpper = canonicalIssueId(issueId);
  if (!issueUpper) return { status: 400, body: { error: 'issueId must be a tracker key like PAN-977.' } };
  if (!Number.isInteger(slotId) || slotId <= 0) return { status: 400, body: { error: 'slotId must be a positive integer.' } };

  const state = await loadSwarmState(issueUpper);
  const matchedIndex = state ? latestFailedMergeSlotIndex(state, slotId) : -1;
  if (!state || matchedIndex < 0) {
    return { status: 409, body: { error: `No failed-merge slot ${slotId} exists for ${issueUpper}.` } };
  }

  const slot = state.slots[matchedIndex]!;
  const project = resolveProjectFromIssue(issueUpper);
  if (!project) return { status: 404, body: { error: `Could not resolve project for ${issueUpper}` } };
  const mainWorkspace = join(project.projectPath, 'workspaces', `feature-${issueUpper.toLowerCase()}`);
  const canonicalPlanPath = await Effect.runPromise(findPlanEffect(mainWorkspace));
  const writerId = `swarm-recover-${action}-${process.pid}`;

  if (action === 'retry' || action === 'drop') {
    if (!canonicalPlanPath) return { status: 422, body: { error: `No canonical vBRIEF plan found for ${issueUpper}` } };
    try {
      await Effect.runPromise(applyTaskOperationToPlanFileEffect(canonicalPlanPath, {
        type: action === 'drop' ? 'done' : 'unblock',
        itemId: slot.itemId,
        reason: action === 'drop'
          ? 'Operator dropped slot via failed-merge recovery'
          : 'Operator retried slot via failed-merge recovery',
        writerId,
      }, mainWorkspace));
    } catch (err: any) {
      return { status: 500, body: { error: err?.message ?? String(err) } };
    }
  }

  const recoveredAt = new Date().toISOString();
  const recoveredSlots = state.slots.map((candidate, index) => {
    if (index !== matchedIndex) return candidate;
    if (action !== 'retry') return { ...candidate, recoveryAction: action, recoveredAt };
    return {
      ...candidate,
      status: 'pending' as const,
      failureReason: undefined,
      consecutiveConflictCount: undefined,
      prUrl: undefined,
      recoveryAction: action,
      recoveredAt,
    };
  });
  const nextState = clearAutoAdvanceFailureFields({
    ...state,
    slots: recoveredSlots,
    autoAdvance: action === 'handoff' ? false : state.autoAdvance,
    updatedAt: recoveredAt,
  });

  try {
    await saveSwarmState(nextState);
  } catch (err: any) {
    return { status: 500, body: { error: err?.message ?? String(err) } };
  }

  emitActivityEntry({
    source: 'ship',
    level: 'info',
    issueId: issueUpper,
    message: `Operator recovered slot ${slotId} via ${action} (${slot.itemId})`,
  });
  if (action === 'handoff') {
    emitActivityEntry({
      source: 'ship',
      level: 'warn',
      issueId: issueUpper,
      message: `Swarm autoAdvance disabled for ${issueUpper} after operator handoff of slot ${slotId}. Take it from here.`,
    });
  }

  activeSwarmIssueIds.add(issueUpper);
  ensureSwarmAutoAdvanceLoop();

  return { status: 200, body: { ok: true, action, slotId, issueId: issueUpper } };
}

/**
 * Discover active swarms by scanning every registered project's `workspaces/feature-*`
 * directory for a continue vBRIEF carrying a `swarmRuntime`. The legacy sidecar
 * (`~/.panopticon/swarms/*.json`) is included only for one-time backward-compat.
 */
async function discoverActiveSwarmIssueIds(): Promise<string[]> {
  const ids = new Set<string>();
  // Continue-state authority: enumerate workspaces under each project.
  try {
    const projects = listProjects();
    for (const { config } of projects) {
      const workspacesDir = join(config.path, 'workspaces');
      const entries = await readdir(workspacesDir).catch(() => [] as string[]);
      for (const entry of entries) {
        const match = /^feature-([a-z][a-z0-9]*-\d+)$/.exec(entry);
        if (!match) continue;
        ids.add(match[1].toUpperCase());
      }
    }
  } catch { /* projects may be unconfigured in tests */ }
  // One-time legacy sidecar discovery (post-PAN-977 the sidecar is no longer
  // written; this loop helps drain pre-existing runtime files into the continue
  // authority during the migration window).
  const legacy = await readdir(getSwarmDir()).catch(() => [] as string[]);
  for (const entry of legacy) {
    if (!entry.endsWith('.json')) continue;
    ids.add(entry.replace(/\.json$/, '').toUpperCase());
  }
  return Array.from(ids);
}

/**
 * PAN-977 round-11 blocker #3: drain pending slot-merge retry markers written
 * by merge-agent when the dashboard loopback was unavailable. Each marker
 * represents a slot branch that was already merged into the feature branch
 * but whose runtime/plan transition never landed. Replay them in-process by
 * calling onSlotMergeComplete directly; remove the marker on success, leave
 * it in place on failure so a future poll cycle retries.
 */
async function drainPendingSlotMerges(): Promise<void> {
  const retryDir = join(getSwarmDir(), 'pending-slot-merges');
  const entries = await readdir(retryDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = join(retryDir, entry);
    try {
      const raw = await readFile(file, 'utf-8');
      const parsed = JSON.parse(raw) as { issueId?: string; slotId?: number; itemId?: string };
      if (!parsed.issueId || !Number.isInteger(parsed.slotId)) {
        await unlink(file).catch(() => undefined);
        continue;
      }
      const result = await onSlotMergeComplete(parsed.issueId, parsed.itemId ?? '', parsed.slotId as number);
      if (result.ok === true) {
        await unlink(file).catch(() => undefined);
        console.log(`[swarm] Drained pending slot-merge marker ${entry}`);
      } else {
        console.warn(`[swarm] Pending slot-merge ${entry} retry failed: ${result.error}; leaving marker for next cycle.`);
      }
    } catch (err: any) {
      console.warn(`[swarm] Failed reading slot-merge marker ${entry}: ${err?.message ?? err}`);
    }
  }
}

async function pollSwarmAutoAdvance(): Promise<void> {
  // Drain any persisted slot-merge retry markers first so a stuck slot can
  // unwedge auto-advance before the readiness check below fires.
  await drainPendingSlotMerges();
  // PAN-977 blocker #2: poll only the bounded active-swarm registry. If the
  // registry is empty, we still do one discovery sweep — this seeds the
  // registry from any pre-existing legacy sidecar files (migration window) and
  // also lets tests that drop a sidecar file directly drive the poller.
  // After the sweep, only the registry is used.
  if (activeSwarmIssueIds.size === 0) {
    const discovered = await discoverActiveSwarmIssueIds();
    for (const issueId of discovered) activeSwarmIssueIds.add(issueId);
    if (activeSwarmIssueIds.size === 0) return;
  }
  const issueIds = Array.from(activeSwarmIssueIds);

  const sessions = await Effect.runPromise(listSessionNamesAsyncEffect().pipe(Effect.catch(() => Effect.succeed([] as string[]))));

  for (const issueId of issueIds) {
    const loadedState = await loadSwarmState(issueId);
    if (!loadedState?.autoAdvance) {
      // No longer an active auto-advance swarm — drop from registry so the
      // poll loop converges to empty.
      activeSwarmIssueIds.delete(issueId);
      continue;
    }
    if (autoAdvanceInFlight.has(loadedState.issueId)) continue;
    if (isAutoAdvanceCoolingDown(loadedState)) continue;

    const project = resolveProjectFromIssue(loadedState.issueId);
    const { state, changed, failedMergeTransitions } = await refreshSwarmRuntimeState(loadedState, sessions, project?.projectPath);
    // PAN-977 round-13 blocker #1: persistence MUST run before any final-wave
    // cleanup so a freshly-observed completed/failed slot status survives a
    // dashboard restart, even on the very last polling tick. Previously the
    // final-wave `continue` short-circuited above this block and we lost the
    // refreshed status (and the registry entry that would have repaired it).
    // Order is now: refresh → persist → failure handling → final-wave cleanup.
    if (changed) {
      // PAN-977 round-11 blocker #2 / high-2: saveSwarmState is now the single
      // canonical writer; if it throws the auto-advance loop records the
      // failure as a backoff condition rather than silently dropping the write.
      try {
        await saveSwarmState(state);
      } catch (persistErr: any) {
        await saveSwarmState(recordAutoAdvanceFailure(state, `Runtime persist failed: ${persistErr?.message ?? persistErr}`)).catch(() => undefined);
        continue;
      }
      emitFailedMergeTransitionActivities(state, failedMergeTransitions);
    }

    const failedSlot = firstFailedSlot(state);
    if (failedSlot) {
      if (!state.autoAdvanceRetryAfter && !state.lastAutoAdvanceError) {
        await saveSwarmState(recordAutoAdvanceFailure(
          state,
          failedSlot.status === 'failed-merge'
            ? failedMergeMessage(state, failedSlot)
            : 'One or more swarm slots failed before completion was confirmed.',
        ));
      }
      // Failed-slot handling runs BEFORE final-wave registry cleanup so the
      // operator sees the recorded failure before the swarm leaves the active
      // poll registry.
      if (state.currentWave >= state.totalWaves - 1 && !state.deferred?.length) {
        const stillActive = state.slots.some(slotKeepsSwarmPolling);
        if (!stillActive) {
          activeSwarmIssueIds.delete(state.issueId);
        }
      }
      continue;
    }

    const hasRetryRecoverySlot = hasRetryRecoverySlotNeedingDispatch(state.slots);

    // PAN-977 round-12 high-1 / round-13 blocker #1: final-wave cleanup
    // consults observed post-refresh state and runs AFTER persistence. If
    // the swarm is on the final wave AND no slots still need polling AND no
    // deferred work remains, drop it from the active registry so the poll loop
    // can converge to empty.
    if (!hasRetryRecoverySlot && state.currentWave >= state.totalWaves - 1 && !state.deferred?.length) {
      const stillActive = state.slots.some(slotKeepsSwarmPolling);
      if (!stillActive) {
        activeSwarmIssueIds.delete(state.issueId);
      }
      continue;
    }

    // PAN-977 round-14 blocker: 'completed' means the slot agent's tmux pane
    // exited cleanly — its work has NOT yet landed on the parent feature
    // branch. Auto-advance MUST wait for 'merged' (the
    // /api/swarm/slot-merged callback) before dispatching the next DAG item;
    // otherwise downstream slots get dispatched against stale parent-branch
    // files. Synthesis slots end at 'completed' by design (they only
    // produce context, never merge), so allow them as ready-to-advance.
    const allSlotsReadyToAdvance = state.slots.length > 0 && state.slots.every(slotReadyToAdvance);
    if (!hasRetryRecoverySlot && !allSlotsReadyToAdvance) continue;

    autoAdvanceInFlight.add(state.issueId);
    try {
      // Per-item DAG dispatch: rely on getDispatchableItems(), not next-wave
      // index. Omit `wave` so dispatchSwarmWave() pulls all currently-ready
      // items from the refreshed plan.
      const result = await dispatchSwarmWave({
        issueId: state.issueId,
        model: state.model,
        autoAdvance: true,
        allowHost: state.hostOverride,
      });
      if (result.status >= 400) {
        const error = result.body.error ?? 'unknown error';
        console.warn(`[swarm] Auto-advance for ${state.issueId} stalled: ${error}`);
        await saveSwarmState(recordAutoAdvanceFailure(state, error));
      }
    } finally {
      autoAdvanceInFlight.delete(state.issueId);
    }
  }
}

function scheduleNextSwarmAutoAdvancePoll(): void {
  // PAN-977 blocker #2: only schedule if there is work to do. When the active
  // swarm registry empties, the loop self-suspends until ensureSwarmAutoAdvanceLoop
  // is called again by a fresh dispatch.
  if (activeSwarmIssueIds.size === 0) {
    autoAdvanceLoopStarted = false;
    autoAdvanceTimer = null;
    return;
  }
  autoAdvanceTimer = setTimeout(() => {
    void runSwarmAutoAdvancePollLoop();
  }, SWARM_AUTO_ADVANCE_POLL_MS);
  autoAdvanceTimer.unref?.();
}

async function runSwarmAutoAdvancePollLoop(): Promise<void> {
  if (autoAdvancePolling) {
    scheduleNextSwarmAutoAdvancePoll();
    return;
  }

  autoAdvancePolling = true;
  try {
    await pollSwarmAutoAdvance();
  } catch (err) {
    console.error('[swarm] Auto-advance loop failed:', err);
  } finally {
    autoAdvancePolling = false;
    scheduleNextSwarmAutoAdvancePoll();
  }
}

function ensureSwarmAutoAdvanceLoop(): void {
  if (autoAdvanceLoopStarted) return;
  if (activeSwarmIssueIds.size === 0) return;
  autoAdvanceLoopStarted = true;
  scheduleNextSwarmAutoAdvancePoll();
}

async function resumeSwarmAutoAdvanceLoopOnStartup(): Promise<void> {
  // Discovery only runs once at startup to seed the bounded registry. Steady-state
  // poll iteration uses the registry alone, never re-scans every workspace.
  const issueIds = await discoverActiveSwarmIssueIds();
  for (const issueId of issueIds) {
    const state = await loadSwarmState(issueId);
    if (!state?.autoAdvance) continue;
    const stillActive = state.slots.some(slotKeepsSwarmPolling);
    if (state.currentWave >= state.totalWaves - 1 && !state.deferred?.length && !stillActive) continue;
    activeSwarmIssueIds.add(issueId);
  }
  if (activeSwarmIssueIds.size > 0) ensureSwarmAutoAdvanceLoop();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    const parsed = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
});

const DEFAULT_SWARM_MODEL = 'kimi-k2.6';

async function resolveParentFeatureBranch(
  _projectPath: string,
  issueUpper: string,
  localList: string[],
  remoteList: string[],
): Promise<string> {
  // PAN-1175: the previous implementation called `git branch --show-current`
  // on the MAIN project path and required it to be on `feature/<issue>`. That
  // is structurally impossible — feature branches live in worktrees, and git
  // forbids the same branch being checked out in two working trees, so the
  // main repo can never have the feature branch checked out. The intent was
  // to verify a feature branch EXISTS for this issue; do that directly
  // against the branch list the caller already computed.
  const issueNumber = issueUpper.split('-').at(-1);
  const legacyIssueBranch = `feature/${issueUpper.toLowerCase()}`;
  const numericIssueBranch = issueNumber ? `feature/${issueNumber.toLowerCase()}` : null;
  const candidates = [legacyIssueBranch, numericIssueBranch].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (localList.includes(candidate) || remoteList.includes(`origin/${candidate}`)) {
      return candidate;
    }
  }
  throw new Error(
    `No feature branch found for ${issueUpper} (looked for ${candidates.join(', ')}). ` +
      `Start an agent for this issue first (\`pan start ${issueUpper}\`) so the workspace and feature branch exist.`,
  );
}

async function createSlotWorktree(
  projectPath: string,
  issueId: string,
  slotNum: number,
): Promise<{ success: boolean; workspacePath: string; branch: string; parentBranch: string; error?: string }> {
  const issueUpper = canonicalIssueId(issueId);
  if (!issueUpper) return { success: false, workspacePath: '', branch: '', parentBranch: '', error: 'Invalid issue ID' };
  const issueLower = issueUpper.toLowerCase();
  const slotWorkspaceName = `feature-${issueLower}-slot-${slotNum}`;
  const workspacesDir = join(projectPath, 'workspaces');
  const workspacePath = join(workspacesDir, slotWorkspaceName);
  assertPathInside(workspacesDir, workspacePath);
  let parentBranch = '';
  let slotBranch = '';

  try {
    await execFileAsync('git', ['fetch', 'origin'], { cwd: projectPath });
    await execFileAsync('git', ['worktree', 'prune'], { cwd: projectPath });

    const { stdout: localBranches } = await execFileAsync('git', ['branch', '--list'], { cwd: projectPath });
    const { stdout: remoteBranches } = await execFileAsync('git', ['branch', '-r', '--list'], { cwd: projectPath });
    const localList = localBranches.split('\n').map(b => b.replace(/^[*+\s]+/, '').trim()).filter(Boolean);
    const remoteList = remoteBranches.split('\n').map(b => b.trim()).filter(Boolean);
    parentBranch = await resolveParentFeatureBranch(projectPath, issueUpper, localList, remoteList);
    // PAN-1176: slot branches are siblings (`feature/<parent>-slot-N`), not
    // children (`feature/<parent>/slot-N`). Git refuses to create a sub-tree
    // ref under a leaf ref — the parent `feature/<parent>` blocks any
    // `feature/<parent>/...` creation. Sibling naming sidesteps the collision.
    slotBranch = `${parentBranch}-slot-${slotNum}`;

    if (existsSync(workspacePath)) {
      return { success: true, workspacePath, branch: slotBranch, parentBranch };
    }

    const slotBranchExists =
      localList.includes(slotBranch) ||
      remoteList.includes(`origin/${slotBranch}`);

    if (slotBranchExists) {
      await execFileAsync('git', ['worktree', 'add', workspacePath, slotBranch], { cwd: projectPath });
    } else {
      await execFileAsync('git', ['worktree', 'add', workspacePath, '-b', slotBranch, parentBranch], { cwd: projectPath });
    }

    // Restore any unstaged deletions
    await execFileAsync('git', ['restore', '.'], { cwd: workspacePath }).catch(() => {});
    await execFileAsync('git', ['config', 'beads.role', 'contributor'], { cwd: workspacePath }).catch(() => {});

    // Set up beads redirect
    const sourceBeadsDir = join(projectPath, '.beads');
    if (existsSync(sourceBeadsDir)) {
      const worktreeBeadsDir = join(workspacePath, '.beads');
      const redirectPath = join(worktreeBeadsDir, 'redirect');
      if (!existsSync(redirectPath)) {
        try {
          await mkdir(worktreeBeadsDir, { recursive: true });
          const relPath = relative(workspacePath, sourceBeadsDir);
          await writeFile(redirectPath, relPath, 'utf-8');
        } catch {}
      }
    }

    // Install dependencies (non-fatal)
    try {
      await execFileAsync('bun', ['install'], { cwd: workspacePath, timeout: 60000 });
    } catch {}

    return { success: true, workspacePath, branch: slotBranch, parentBranch };
  } catch (err: any) {
    return { success: false, workspacePath, branch: slotBranch, parentBranch, error: err.message };
  }
}

// ─── POST /api/swarm ────────────────────────────────────────────────────────

const postSwarmRoute = HttpRouter.add(
  'POST',
  '/api/swarm',
  httpHandler(Effect.gen(function* () {
    // PAN-977 blocker #3: this is a privileged state-changing endpoint that
    // can spawn autonomous agents, create worktrees, and mutate canonical
    // vBRIEF task state. Require the internal-token gate (CLI callers) OR a
    // valid same-origin check (dashboard callers) before any side-effecting work.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalToken } = yield* Effect.promise(() =>
      import('../../../lib/internal-token.js'),
    );
    const expected = getInternalToken();
    if (!expected) {
      return jsonResponse({ error: 'internal token not configured' }, { status: 503 });
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const rawHeader = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const tokenValid = constantTimeTokenEqual(provided, expected);
    if (!tokenValid) {
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) {
        return jsonResponse({ error: 'forbidden' }, { status: 403 });
      }
    }

    const body = yield* readJsonBody;
    const { wave, model, maxSlots, autoAdvance } = body as SwarmDispatchRequest;
    const rawBody = body as Record<string, unknown>;
    const issueId = canonicalIssueId(rawBody['issueId']);

    if (!issueId) {
      return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    }
    if (wave !== undefined && (!Number.isInteger(wave) || wave < 0)) {
      return jsonResponse({ error: 'wave must be a non-negative integer.' }, { status: 400 });
    }
    if (maxSlots !== undefined && (!Number.isInteger(maxSlots) || maxSlots <= 0)) {
      return jsonResponse({ error: 'maxSlots must be a positive integer.' }, { status: 400 });
    }
    const modelCheck = validateModelId(model);
    if (modelCheck.ok === false) {
      return jsonResponse({ error: modelCheck.error }, { status: 400 });
    }
    const requestedHostOverride = rawBody.host === true || rawBody.allowHost === true;
    const hostOverrideConfirmation = buildHostOverrideConfirmation(issueId);
    const allowHost = requestedHostOverride && rawBody.hostOverrideConfirmation === hostOverrideConfirmation;
    if (requestedHostOverride && !allowHost) {
      return jsonResponse({
        success: false,
        error: 'host_override_confirmation_required',
        requiresHostConfirmation: true,
        confirmation: hostOverrideConfirmation,
        hint: `Host override bypasses workspace isolation. Retry only after explicitly confirming: ${hostOverrideConfirmation}`,
      }, { status: 409 });
    }

    const result = yield* Effect.promise(() => dispatchSwarmWave({
      issueId,
      wave,
      model: modelCheck.value,
      maxSlots,
      autoAdvance,
      allowHost,
    }));

    return jsonResponse(result.body, { status: result.status });
  })),
);

interface StructuredSlotTaskInput {
  schema: 'AgentTaskInput';
  agent_id: string;
  issue_id: string;
  plan_id: string;
  task_id: string;
  title: string;
  wave_index: number;
  slot: number;
  branch: string;
  pr_target: string;
  workspace_plan_path: string;
  dependencies: Array<{ item_id: string; title: string }>;
  acceptance_criteria: string[];
}

function extractAcceptanceCriteria(item: VBriefItem): string[] {
  return (item.subItems ?? [])
    .filter(subItem => subItem.metadata?.kind === 'acceptance_criterion')
    .map(subItem => subItem.title);
}

function buildStructuredSlotTaskInput(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  slotBranch: string,
  parentBranch: string,
  itemById = new Map(doc.plan.items.map((planItem) => [planItem.id, planItem])),
): StructuredSlotTaskInput {
  const fullItem = itemById.get(item.id) ?? doc.plan.items.find((planItem) => planItem.id === item.id);
  const issueLower = issueId.toLowerCase();

  return {
    schema: 'AgentTaskInput',
    agent_id: `agent-${issueLower}-${slotNum}`,
    issue_id: issueId,
    plan_id: doc.plan.id,
    task_id: item.id,
    title: item.title,
    wave_index: waveIndex,
    slot: slotNum,
    branch: slotBranch,
    pr_target: parentBranch,
    workspace_plan_path: '.pan/spec.vbrief.json',
    dependencies: item.blockedBy.map((dependencyId) => ({
      item_id: dependencyId,
      title: itemById.get(dependencyId)?.title ?? dependencyId,
    })),
    acceptance_criteria: fullItem ? extractAcceptanceCriteria(fullItem) : [],
  };
}

function buildSynthesisPrompt(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  parentBranch: string,
  // PAN-977 blocker #5: pass cumulative slot runtime so the synthesis agent
  // sees the actual upstream deliverables (slot branch, workspace path, status)
  // instead of just the original plan-text parent titles.
  runtimeSlots: ReadonlyArray<{ slotId: number; itemId: string; itemTitle: string; sessionName: string; workspace: string; status: string; }> = [],
): string {
  const parents = item.blockedBy
    .map(parentId => doc.plan.items.find(planItem => planItem.id === parentId))
    .filter((parent): parent is VBriefItem => Boolean(parent));

  // Map plan-item parents to runtime delivery records (most recent slot wins).
  const slotByItemId = new Map<string, typeof runtimeSlots[number]>();
  for (const slot of runtimeSlots) {
    const existing = slotByItemId.get(slot.itemId);
    if (!existing || slot.slotId >= existing.slotId) slotByItemId.set(slot.itemId, slot);
  }

  const deliverableLines: string[] = [];
  for (const parent of parents) {
    const slot = slotByItemId.get(parent.id);
    if (slot) {
      deliverableLines.push(
        `- **${parent.id}: ${parent.title}**`,
        `  - slot ${slot.slotId}, status \`${slot.status}\``,
        `  - branch: \`${parentBranch}-slot-${slot.slotId}\``,
        `  - merge target: \`${parentBranch}\``,
        `  - slot workspace: \`${slot.workspace || '(not yet created)'}\``,
        `  - tmux session: \`${slot.sessionName}\``,
      );
    } else {
      deliverableLines.push(`- **${parent.id}: ${parent.title}** (no recorded slot — read the plan and feature branch directly)`);
    }
  }

  return [
    `You are the synthesis agent for slot ${slotNum}, wave ${waveIndex} of plan ${doc.plan.id}.`,
    `Issue: ${issueId}`,
    `Convergence target: **${item.id}: ${item.title}**`,
    '',
    'Inspect the actual delivered upstream work (NOT just the original plan text).',
    'Each parent item below lists its slot branch, workspace, and tmux session so',
    'you can read the real commits, changed files, and any continue-state notes.',
    '',
    'Suggested commands to inspect upstream deliverables:',
    '```bash',
    `cd <your synthesis workspace>`,
    `# changed files merged into the parent feature branch by each upstream slot:`,
    `git fetch origin`,
    `git diff --stat origin/${parentBranch}...origin/${parentBranch}-slot-<N>`,
    `# full diff for review:`,
    `git log --stat origin/${parentBranch}-slot-<N> ^origin/main`,
    '```',
    '',
    'Upstream parent items and their delivery records:',
    ...deliverableLines,
    '',
    'Your job is NOT to implement the convergence target. Your job is to produce a concise',
    'markdown synthesis covering: upstream decisions, changed files, hazards/risks, and',
    'constraints the downstream implementation agent must respect.',
    '',
    'When the synthesis is ready, deliver it by POSTing to the dashboard with',
    'the internal token from `~/.panopticon/internal-token`. Unauthenticated',
    'requests are rejected with 403.',
    '',
    '```bash',
    `TOKEN=$(cat ~/.panopticon/internal-token)`,
    `curl -fsS -X POST http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}/api/swarm/slot-merged \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "x-panopticon-internal-token: $TOKEN" \\`,
    `  -d @- <<'JSON'`,
    JSON.stringify({ issueId, itemId: item.id, slotId: slotNum, synthesisOutput: '<your markdown here, ≤64KB>' }, null, 2),
    'JSON',
    '```',
    '',
    'Panopticon persists `synthesisOutput` into the continue vBRIEF runtime under',
    '`swarmRuntime.synthesisOutputs[<convergence-item-id>]`. Only after that record exists',
    'will the downstream implementation slot be dispatched, and it will receive your',
    'synthesis as part of its prompt context.',
    'Do NOT run `pan done` and do NOT modify the convergence target source files.',
  ].join('\n');
}

function buildSlotPrompt(
  doc: VBriefDocument,
  issueId: string,
  item: WaveItem,
  waveIndex: number,
  slotNum: number,
  slotBranch: string,
  parentBranch: string,
  itemById = new Map(doc.plan.items.map((planItem) => [planItem.id, planItem])),
  // PAN-977 blocker #6: when a synthesis agent has already produced an upstream
  // context update for this convergence item, splice it into the implementation
  // slot's prompt so the work agent sees it without having to discover the
  // continue-state file by hand.
  synthesisContextUpdate?: string,
): string {
  const taskInput = buildStructuredSlotTaskInput(
    doc,
    issueId,
    item,
    waveIndex,
    slotNum,
    slotBranch,
    parentBranch,
    itemById,
  );

  const synthesisBlock: string[] = synthesisContextUpdate
    ? [
        '',
        '────────────────────────────────────────────────────────────────────',
        'UPSTREAM SYNTHESIS CONTEXT (from convergence-point synthesis agent):',
        '────────────────────────────────────────────────────────────────────',
        synthesisContextUpdate,
        '────────────────────────────────────────────────────────────────────',
        'Treat the section above as authoritative guidance from your upstream',
        `synthesis agent. It is the persisted \`swarmRuntime.synthesisOutputs[${item.id}]\``,
        'record from the continue vBRIEF.',
        '',
      ]
    : [];

  return [
    `You are swarm slot ${slotNum} working on wave ${waveIndex} of plan ${doc.plan.id}.`,
    `Your assigned task is: **${item.id}: ${item.title}**`,
    '',
    'Focus ONLY on this specific task from the vBRIEF plan.',
    'The plan is in .pan/spec.vbrief.json — read it for full context, acceptance criteria, and dependencies.',
    ...synthesisBlock,
    'Structured AgentTaskInput:',
    '```json',
    JSON.stringify(taskInput, null, 2),
    '```',
    '',
    `Your slot branch: **${slotBranch}**`,
    `Parent feature branch (merge target): **${parentBranch}**`,
    '',
    'When your task is complete:',
    `1. Commit your changes to branch \`${slotBranch}\``,
    `2. Find your bead: \`bd list -l ${doc.plan.id.toLowerCase()} --status open\` and look for the one matching "${item.title}"`,
    `3. Close it: \`bd close <bead-id>\``,
    `4. Push branch \`${slotBranch}\``,
    `5. Create a PR targeting \`${parentBranch}\` — do NOT target main`,
    '',
    `Do NOT run \`pan done\` — that closes the entire issue. You are one slot in a parallel swarm.`,
    'Other slots are working on sibling tasks in parallel. Stay within your task scope.',
  ].join('\n');
}

// ─── POST /api/swarm/refresh ────────────────────────────────────────────────

const postSwarmRefreshRoute = HttpRouter.add(
  'POST',
  '/api/swarm/refresh',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalToken } = yield* Effect.promise(() =>
      import('../../../lib/internal-token.js'),
    );
    const expected = getInternalToken();
    if (!expected) {
      return jsonResponse({ error: 'internal token not configured' }, { status: 503 });
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const rawHeader = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const tokenValid = constantTimeTokenEqual(provided, expected);
    if (!tokenValid) {
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) {
        return jsonResponse({ error: 'forbidden' }, { status: 403 });
      }
    }

    const body = yield* readJsonBody;
    const issueId = canonicalIssueId((body as Record<string, unknown>)['issueId']);
    if (!issueId) return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });

    const result = yield* Effect.promise(() => refreshSwarmIssue(issueId));
    return jsonResponse(result.body, { status: result.status });
  })),
);

// ─── POST /api/swarm/slot-merged ────────────────────────────────────────────

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const postSwarmSlotMergedRoute = HttpRouter.add(
  'POST',
  '/api/swarm/slot-merged',
  httpHandler(Effect.gen(function* () {
    // PAN-977 blocker #1: this route mutates swarm runtime + canonical vBRIEF
    // task state and persists attacker-controlled context into future agent
    // prompts. Require the unforgeable internal token before any state read,
    // and cap synthesisOutput size so a malicious caller cannot bloat the
    // continue vBRIEF or downstream prompts.
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalToken } = yield* Effect.promise(() =>
      import('../../../lib/internal-token.js'),
    );
    const expected = getInternalToken();
    if (!expected) {
      return jsonResponse({ error: 'internal token not configured' }, { status: 503 });
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const rawHeader = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!constantTimeTokenEqual(provided, expected)) {
      return jsonResponse({ error: 'forbidden' }, { status: 403 });
    }

    const body = yield* readJsonBody;
    const issueId = canonicalIssueId((body as Record<string, unknown>)['issueId']);
    const itemId = (body as Record<string, unknown>)['itemId'];
    const slotId = (body as Record<string, unknown>)['slotId'];
    const synthesisOutput = (body as Record<string, unknown>)['synthesisOutput'];

    if (!issueId) return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    // itemId may be empty when the caller is the merge-agent loopback (it knows the
    // slot number but not the canonical item id). onSlotMergeComplete resolves the
    // item id from runtime state by slot in that case.
    if (typeof itemId !== 'string') return jsonResponse({ error: 'itemId must be a string (may be empty when called by merge-agent loopback)' }, { status: 400 });
    if (!Number.isInteger(slotId) || (slotId as number) <= 0) return jsonResponse({ error: 'slotId must be a positive integer.' }, { status: 400 });
    if (synthesisOutput !== undefined && typeof synthesisOutput !== 'string') return jsonResponse({ error: 'synthesisOutput must be a string.' }, { status: 400 });
    if (typeof synthesisOutput === 'string' && Buffer.byteLength(synthesisOutput, 'utf8') > MAX_SYNTHESIS_OUTPUT_BYTES) {
      return jsonResponse({ error: `synthesisOutput exceeds ${MAX_SYNTHESIS_OUTPUT_BYTES} bytes.` }, { status: 413 });
    }

    const result = yield* Effect.promise(() => onSlotMergeComplete(issueId, itemId, slotId as number, synthesisOutput as string | undefined));
    if (result.ok === false) {
      return jsonResponse({ error: result.error }, { status: result.status });
    }
    return jsonResponse({ success: true });
  })),
);

/**
 * Failed-merge recovery matrix:
 * - retry: release the vBRIEF item back to pending, mark the slot recovered, clear auto-advance failure fields, and let polling dispatch the item again.
 * - drop: mark the vBRIEF item done, keep the failed-merge slot visible as recovered, clear auto-advance failure fields, and let polling advance downstream DAG work.
 * - handoff: disable autoAdvance, keep the failed-merge slot visible as recovered, and log that an operator is taking manual control.
 */
const postSwarmSlotRecoverRoute = HttpRouter.add(
  'POST',
  '/api/swarm/:issueId/slot/:slotId/recover',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalToken } = yield* Effect.promise(() =>
      import('../../../lib/internal-token.js'),
    );
    const expected = getInternalToken();
    if (!expected) {
      return jsonResponse({ error: 'internal token not configured' }, { status: 503 });
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const rawHeader = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!constantTimeTokenEqual(provided, expected)) {
      return jsonResponse({ error: 'forbidden' }, { status: 403 });
    }

    const params = yield* HttpRouter.params;
    const issueId = canonicalIssueId(params['issueId'] ?? '');
    const rawSlotId = params['slotId'] ?? '';
    if (!issueId) return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    if (!/^[1-9]\d*$/.test(rawSlotId)) return jsonResponse({ error: 'slotId must be a positive integer.' }, { status: 400 });

    const body = yield* readJsonBody;
    const action = (body as Record<string, unknown>)['action'];
    if (action !== 'retry' && action !== 'drop' && action !== 'handoff') {
      return jsonResponse({ error: "action must be one of 'retry', 'drop', or 'handoff'." }, { status: 400 });
    }

    const result = yield* Effect.promise(() => recoverSwarmSlot(issueId, Number.parseInt(rawSlotId, 10), action));
    return jsonResponse(result.body, { status: result.status });
  })),
);

// ─── GET /api/swarm/:issueId ────────────────────────────────────────────────

const getSwarmRoute = HttpRouter.add(
  'GET',
  '/api/swarm/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = canonicalIssueId(params['issueId'] ?? '');
    if (!issueId) {
      return jsonResponse({ error: 'issueId must be a tracker key like PAN-977.' }, { status: 400 });
    }

    const state = yield* Effect.promise(() => loadSwarmState(issueId));
    if (!state) {
      return jsonResponse({ error: `No swarm state for ${issueId}` }, { status: 404 });
    }

    return jsonResponse(state);
  })),
);

// ─── Export ─────────────────────────────────────────────────────────────────

export const __testInternals = {
  refreshSwarmSlotStatuses,
  refreshSwarmSlotMergeability,
  refreshSwarmIssue,
  dispatchSwarmWave,
  pollSwarmAutoAdvance,
  ensureSwarmAutoAdvanceLoop,
  resumeSwarmAutoAdvanceLoopOnStartup,
  onSlotMergeComplete,
  recoverSwarmSlot,
  buildStructuredSlotTaskInput,
  buildSlotPrompt,
  // PAN-977 round-10 blocker #4: tests read durable runtime state via the
  // continue vBRIEF (the canonical authority); the legacy sidecar file is no
  // longer written. Expose `loadSwarmState`/`persistSwarmRuntime` so tests can
  // read and seed the post-action state without duplicating the continue-state
  // path resolution.
  loadSwarmState,
  persistSwarmRuntime,
  // PAN-977 round-12 blocker #1: regression coverage needs to assert the
  // active-poll registry still contains the issue after a slot merge that
  // dispatches the next DAG item. Expose the bounded set as a read-only view.
  getActiveSwarmIssueIds: () => new Set(activeSwarmIssueIds),
  // Test-only seeder for registry membership: the production path adds
  // entries via dispatchSwarmWave, but regression tests for slot-merge
  // cleanup only need to assert that an existing membership is preserved.
  addActiveSwarmIssueId: (issueId: string) => { activeSwarmIssueIds.add(issueId); },
  clearActiveSwarmIssueIds: () => { activeSwarmIssueIds.clear(); },
};

export { resumeSwarmAutoAdvanceLoopOnStartup };

export const swarmRouteLayer = Layer.mergeAll(
  postSwarmRoute,
  postSwarmRefreshRoute,
  postSwarmSlotMergedRoute,
  postSwarmSlotRecoverRoute,
  getSwarmRoute,
);
