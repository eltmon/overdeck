/**
 * PAN-5623: primary-dashboard service that frees memory for a starved
 * quality-gate admission queue by stopping the `api`/`fe`/`frontend`/`server`
 * containers of one parked issue's workspace stack, and starts them again when
 * the issue's agent starts a turn.
 *
 * Two timers, each with its own in-flight guard and `unref()`:
 *
 * - The reclaim poll (every `STACK_RECLAIM_POLL_MS`) acts only while a
 *   PAN-5621 starvation episode is open and the queue head still cannot run
 *   alone. It picks at most one candidate per poll (largest memory first, a
 *   closed deny-by-default rule list, FR-2), re-checks every fact from fresh
 *   reads inside the per-workspace stack lock, journals `stack.reclaimed`,
 *   reads it back, and only then stops the containers by verified id (D5).
 * - The restore poll (every `STACK_RESTORE_POLL_MS`) keeps an index of open
 *   reclaims, seeded from every workspace journal on its first tick so it
 *   survives a dashboard restart (FR-7), and restores a stack when one of its
 *   issue's non-review panes is working or mid-turn (FR-5 `turn` trigger).
 *   Spawn and verification restore through `restoreReclaimedStack` directly.
 *
 * Runs in the primary dashboard only (main.ts): the runtime mirror that
 * answers "is this agent mid-turn" exists only there (NFR-4). A poll error is
 * logged and never thrown out of a timer (NFR-3).
 */
import type { BackendPane } from '@overdeck/contracts';
import { Effect } from 'effect';
import { existsSync } from 'node:fs';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { getRuntimeSnapshot } from '../../../lib/agent-runtime-mirror.js';
import { isSessionAtTurnBoundary } from '../../../lib/agents/liveness.js';
import { pendingDeclarations } from '../../../lib/cloister/blocker-wake.js';
import {
  gateAdmissionRoot,
  readGateStarvationRecord,
  starvationEpisodeCloseReason,
  type GateStarvationRecord,
} from '../../../lib/cloister/gate-starvation.js';
import { evaluateIssueMergeGate } from '../../../lib/cloister/merge-gate.js';
import {
  appendPipelineEntry,
  openStackReclaim,
  reclaimedInEpisode,
  tryReadPipelineJournal,
  type PipelineJournalEntry,
} from '../../../lib/cloister/pipeline-journal.js';
import {
  readQualityGateMemory,
  readQualityGateQueue,
  type QualityGateMemorySample,
  type QualityGateQueueEntry,
  type QualityGateQueueSnapshot,
} from '../../../lib/cloister/quality-gate-admission.js';
import { fitsAloneAboveHardReserve, readGateFootprintEstimate, resolveGateReserveBytes } from '../../../lib/cloister/quality-gate-memory.js';
import { isVerificationWorkerActive, readVerificationDispatchOwed } from '../../../lib/cloister/verification-worker-supervisor.js';
import { paneFromBackendSnapshot } from '../../../lib/overdeck/derived-issue-state.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { resolveLaunchBackend } from '../../../lib/terminal-backends/launch.js';
import { isUnsupported } from '../../../lib/terminal-backends/types.js';
import { tryComposeProjectNameForWorkspace } from '../../../lib/workspace/stack-health.js';
import {
  issueInGateQueue,
  issuePanes,
  panesAllowReclaim,
  panesNeedStack,
  rankCandidates,
  reclaimableContainers,
  type ReclaimCandidate,
  type TurnState,
} from '../../../lib/workspace/stack-reclaim.js';
import {
  RECLAIMABLE_STACK_SERVICES,
  listComposeContainers,
  readContainerMemoryBytes,
  stopContainer,
  type ComposeContainer,
} from '../../../lib/workspace/stack-reclaim-docker.js';
import { restoreReclaimedStack, stackLockPath, withStackLock } from '../../../lib/workspace/stack-restore.js';
import { listWorkspaces } from '../../../lib/workspaces/resolver.js';
import type { WorkspaceRow } from '../../../lib/workspaces/types.js';

export const STACK_RECLAIM_POLL_MS = 30_000;
export const STACK_RESTORE_POLL_MS = 5_000;
export const STACK_RESTORE_RETRY_MS = 60_000;
/** How long a reclaim waits for the stack lock before it skips this poll. */
const RECLAIM_LOCK_TIMEOUT_MS = 5_000;
/** The merge gate can take seconds per issue, so only the largest few are asked. */
const MERGE_GATE_CANDIDATES = 3;

type DockerResult = { ok: true } | { ok: false; error: string };

export interface StackReclaimServiceDeps {
  withLock: <T>(lockPath: string, fn: () => Promise<T>) => Promise<T>;
  readRecord: () => Promise<GateStarvationRecord | null>;
  readQueue: () => Promise<QualityGateQueueSnapshot>;
  readMemory: () => Promise<QualityGateMemorySample | null>;
  readHardReserveBytes: () => Promise<number>;
  readEstimate: (footprintKey: string) => Promise<number>;
  listWorkspaces: () => WorkspaceRow[];
  pathExists: (path: string) => boolean;
  projectRegistered: (issueId: string) => boolean;
  composeProjectFor: (workspacePath: string, issueId: string) => string | null;
  listRunningContainers: () => Promise<ComposeContainer[] | null>;
  listPanes: () => Promise<BackendPane[] | null>;
  turnState: (agentId: string) => TurnState;
  verificationBusy: (issueId: string) => boolean;
  /** `null` when the journal exists but cannot be read; every call site fails closed on it. */
  readJournal: (workspacePath: string) => PipelineJournalEntry[] | null;
  readMemoryBytes: (names: readonly string[]) => Promise<Map<string, number> | null>;
  mergeReady: (issueId: string) => Promise<boolean>;
  appendEntry: typeof appendPipelineEntry;
  stopContainer: (id: string) => Promise<DockerResult>;
  emitActivity: typeof emitActivityEntry;
  restore: typeof restoreReclaimedStack;
  now: () => number;
}

/** D16: the live pane inventory, or null when it cannot be read (never `[]` for unknown). */
async function defaultListPanes(): Promise<BackendPane[] | null> {
  try {
    const backend = await resolveLaunchBackend();
    const snapshots = await Effect.runPromise(backend.list().pipe(Effect.catch(() => Effect.succeed(null))));
    if (snapshots === null || isUnsupported(snapshots)) return null;
    const now = Date.now();
    return snapshots.map((snapshot) => paneFromBackendSnapshot(snapshot, now));
  } catch {
    return null;
  }
}

function defaultTurnState(agentId: string): TurnState {
  if (!Effect.runSync(getRuntimeSnapshot(agentId))) return 'unknown';
  return isSessionAtTurnBoundary(agentId) ? 'boundary' : 'in-turn';
}

function resolveDeps(deps: Partial<StackReclaimServiceDeps> = {}): StackReclaimServiceDeps {
  return {
    withLock: deps.withLock ?? ((lockPath, fn) => withStackLock(lockPath, fn, RECLAIM_LOCK_TIMEOUT_MS)),
    readRecord: deps.readRecord ?? (() => readGateStarvationRecord()),
    readQueue: deps.readQueue ?? (() => readQualityGateQueue()),
    readMemory: deps.readMemory ?? readQualityGateMemory,
    readHardReserveBytes: deps.readHardReserveBytes ?? (async () => (await resolveGateReserveBytes()).hardBytes),
    readEstimate: deps.readEstimate ?? ((key) => readGateFootprintEstimate(key, gateAdmissionRoot())),
    listWorkspaces: deps.listWorkspaces ?? (() => listWorkspaces()),
    pathExists: deps.pathExists ?? existsSync,
    projectRegistered: deps.projectRegistered ?? ((issueId) => resolveProjectFromIssueSync(issueId) !== null),
    composeProjectFor: deps.composeProjectFor ?? tryComposeProjectNameForWorkspace,
    listRunningContainers: deps.listRunningContainers ?? (() => listComposeContainers({ all: false })),
    listPanes: deps.listPanes ?? defaultListPanes,
    turnState: deps.turnState ?? defaultTurnState,
    verificationBusy: deps.verificationBusy
      ?? ((issueId) => isVerificationWorkerActive(issueId) || readVerificationDispatchOwed(issueId) !== null),
    readJournal: deps.readJournal ?? ((workspacePath) => tryReadPipelineJournal(workspacePath)),
    readMemoryBytes: deps.readMemoryBytes ?? readContainerMemoryBytes,
    mergeReady: deps.mergeReady ?? (async (issueId) => (await evaluateIssueMergeGate(issueId)).ready),
    appendEntry: deps.appendEntry ?? appendPipelineEntry,
    stopContainer: deps.stopContainer ?? stopContainer,
    emitActivity: deps.emitActivity ?? emitActivityEntry,
    restore: deps.restore ?? restoreReclaimedStack,
    now: deps.now ?? Date.now,
  };
}

export interface StackReclaimState {
  /** Open reclaims the restore poll watches: upper-case issue id → workspace path. */
  restoreIndex: Map<string, string>;
  /** Upper-case issue id → epoch ms before which a failed restore is not retried. */
  restoreRetryAt: Map<string, number>;
  /** False until the restore poll has seeded the index from the journals (FR-7). */
  seeded: boolean;
}

export function createStackReclaimState(): StackReclaimState {
  return { restoreIndex: new Map(), restoreRetryAt: new Map(), seeded: false };
}

export type StackReclaimPollResult =
  | { kind: 'idle'; reason: string }
  | { kind: 'reclaimed'; issueId: string; stopped: string[]; failed: string[] };

const idle = (reason: string): StackReclaimPollResult => ({ kind: 'idle', reason });

function isOpenEpisode(record: GateStarvationRecord | null): record is GateStarvationRecord {
  return record !== null && !record.closing;
}

/** FR-1: the head has a footprint key and cannot start even alone above the hard reserve. */
async function headStillBlocked(
  deps: StackReclaimServiceDeps,
  snapshot: QualityGateQueueSnapshot,
): Promise<{ ok: true; head: QualityGateQueueEntry } | { ok: false; reason: string }> {
  const head = snapshot.waiters[0];
  if (!head?.footprintKey) return { ok: false, reason: 'head-unknown' };
  const memory = await deps.readMemory();
  if (!memory) return { ok: false, reason: 'memory-unreadable' };
  const hardReserveBytes = await deps.readHardReserveBytes();
  const estimateBytes = await deps.readEstimate(head.footprintKey);
  const fits = fitsAloneAboveHardReserve({
    memAvailableBytes: memory.memAvailableBytes,
    memTotalBytes: memory.memTotalBytes,
    hardReserveBytes,
    estimateBytes,
  });
  return fits.ok ? { ok: false, reason: 'head-fits' } : { ok: true, head };
}

/** FR-2 rules 1–7, cheapest first. */
function buildCandidates(
  deps: StackReclaimServiceDeps,
  record: GateStarvationRecord,
  snapshot: QualityGateQueueSnapshot,
  running: readonly ComposeContainer[],
  panes: readonly BackendPane[],
): Omit<ReclaimCandidate, 'memoryBytes'>[] {
  const candidates: Omit<ReclaimCandidate, 'memoryBytes'>[] = [];
  const seen = new Set<string>();
  const runningNames = new Set(running.map((container) => container.name));
  for (const workspace of deps.listWorkspaces()) {
    if (workspace.kind === 'main' || !workspace.issueId) continue;
    const issueId = workspace.issueId.toUpperCase();
    if (seen.has(issueId) || !deps.pathExists(workspace.path)) continue;
    if (!deps.projectRegistered(issueId)) continue;
    const composeProject = deps.composeProjectFor(workspace.path, issueId);
    if (!composeProject) continue;
    const containers = reclaimableContainers(running, composeProject);
    if (containers.length === 0) continue;
    if (issueInGateQueue(snapshot, issueId, workspace.path)) continue;
    if (deps.verificationBusy(issueId)) continue;
    const journal = deps.readJournal(workspace.path);
    if (journal === null) continue;
    if (reclaimedInEpisode(journal, record.since)) continue;
    // PAN-5648 r4672667681: an open reclaim (any episode) still holding a
    // stopped container means Overdeck is mid-reclaim-or-restore for this
    // issue, so it must not be reclaimed again. One whose containers are ALL
    // running again is effectively closed in practice — don't let it block
    // the issue forever just because no `stack.restored` entry was written.
    const open = openStackReclaim(journal);
    if (open && open.containers.some((name) => !runningNames.has(name))) continue;
    if (!panesAllowReclaim(issuePanes(panes, issueId, workspace.path), deps.turnState).ok) continue;
    seen.add(issueId);
    candidates.push({ issueId, workspacePath: workspace.path, composeProject, containers });
  }
  return candidates;
}

/**
 * FR-3 step 8: every fact the decision rested on, re-read fresh inside the
 * stack lock. Returns the head for the journal entry, or null when anything
 * changed.
 */
async function recheckBeforeStop(
  deps: StackReclaimServiceDeps,
  record: GateStarvationRecord,
  target: ReclaimCandidate,
): Promise<{ record: GateStarvationRecord; head: QualityGateQueueEntry } | null> {
  const fresh = await deps.readRecord();
  if (!isOpenEpisode(fresh) || fresh.since !== record.since) return null;
  const snapshot = await deps.readQueue();
  if (snapshot.readError || starvationEpisodeCloseReason(snapshot, fresh.openedAtMs) !== null) return null;
  if (issueInGateQueue(snapshot, target.issueId, target.workspacePath)) return null;
  const blocked = await headStillBlocked(deps, snapshot);
  if (!blocked.ok) return null;
  if (deps.verificationBusy(target.issueId)) return null;
  const panes = await deps.listPanes();
  if (!panes || !panesAllowReclaim(issuePanes(panes, target.issueId, target.workspacePath), deps.turnState).ok) return null;
  const running = await deps.listRunningContainers();
  if (!running) return null;
  const byName = new Map(running.map((container) => [container.name, container]));
  for (const container of target.containers) {
    const now = byName.get(container.name);
    if (!now
      || now.id !== container.id
      || now.state !== 'running'
      || now.composeProject !== target.composeProject
      || !RECLAIMABLE_STACK_SERVICES.has(now.composeService)) {
      return null;
    }
  }
  return { record: fresh, head: blocked.head };
}

function formatGib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function reclaimActivityDetails(
  issueId: string,
  names: readonly string[],
  memoryBytes: number,
  head: QualityGateQueueEntry,
  failed: readonly string[],
): string {
  const forIssue = head.issueId ? ` for ${head.issueId}` : '';
  const failedText = failed.length > 0 ? ` docker stop failed for ${failed.join(', ')}.` : '';
  return `Stopped ${names.join(', ')} (${formatGib(memoryBytes)} GiB) to free memory for the starved gate queue `
    + `(${head.gateName}${forIssue} is waiting). They start again when ${issueId} next needs them; `
    + `to start them by hand: docker start ${names.join(' ')}.${failedText}`;
}

/** The reclaim poll, steps 1–9 of WI-12. */
export async function runStackReclaimPoll(
  deps: StackReclaimServiceDeps,
  state: StackReclaimState,
): Promise<StackReclaimPollResult> {
  // 1–3: an open episode whose head still cannot run alone.
  const record = await deps.readRecord();
  if (!isOpenEpisode(record)) return idle('no-episode');
  const snapshot = await deps.readQueue();
  if (snapshot.readError) return idle('queue-unreadable');
  if (starvationEpisodeCloseReason(snapshot, record.openedAtMs) !== null) return idle('episode-ending');
  const blocked = await headStillBlocked(deps, snapshot);
  if (!blocked.ok) return idle(blocked.reason);

  // 4: the listings every candidate rule needs; unknown is never "none".
  const running = await deps.listRunningContainers();
  if (!running) return idle('docker-unreadable');
  const panes = await deps.listPanes();
  if (!panes) return idle('inventory-unreadable');

  // 5–6: candidates and their memory.
  const candidates = buildCandidates(deps, record, snapshot, running, panes);
  if (candidates.length === 0) return idle('no-candidates');
  const memory = await deps.readMemoryBytes(candidates.flatMap((candidate) => candidate.containers.map((c) => c.name)));
  if (!memory) return idle('stats-unreadable');

  // 7 (FR-2 rule 8 / FR-4): the largest parked candidate. A pending blocker
  // declaration is free and checked for every candidate; the merge gate is
  // a network call, so only the first MERGE_GATE_CANDIDATES candidates this
  // poll — by rank, not by position in the scan — spend that budget.
  let target: ReclaimCandidate | null = null;
  let mergeGateCalls = 0;
  for (const candidate of rankCandidates(candidates, memory)) {
    const journal = deps.readJournal(candidate.workspacePath);
    if (journal === null) continue;
    if (pendingDeclarations(journal).length > 0) {
      target = candidate;
      break;
    }
    if (mergeGateCalls >= MERGE_GATE_CANDIDATES) continue;
    mergeGateCalls += 1;
    let ready: boolean;
    try {
      ready = await deps.mergeReady(candidate.issueId);
    } catch {
      ready = false;
    }
    if (ready) {
      target = candidate;
      break;
    }
  }
  if (!target) return idle('none-parked');
  const chosen = target;

  // 8–9: re-check, journal, read back and stop, all under the stack lock.
  let entered = false;
  let outcome: { kind: 'idle'; reason: string } | { kind: 'stopped'; stopped: string[]; failed: string[]; head: QualityGateQueueEntry };
  try {
    outcome = await deps.withLock(stackLockPath(chosen.workspacePath), async () => {
      entered = true;
      const checked = await recheckBeforeStop(deps, record, chosen);
      if (!checked) return { kind: 'idle' as const, reason: 'changed-before-stop' };
      const names = chosen.containers.map((container) => container.name);
      const written = deps.appendEntry(chosen.workspacePath, {
        type: 'stack.reclaimed',
        issueId: chosen.issueId,
        source: 'stack-reclaim',
        data: {
          containers: names,
          containerIds: chosen.containers.map((container) => container.id),
          services: chosen.containers.map((container) => container.composeService),
          composeProject: chosen.composeProject,
          memoryBytes: chosen.memoryBytes,
          reason: 'gate-starvation',
          episodeSince: checked.record.since,
          head: { gateName: checked.head.gateName, ...(checked.head.issueId ? { issueId: checked.head.issueId } : {}) },
        },
      });
      // D5: appendPipelineEntry swallows write errors, so stop nothing unless the entry landed.
      const readBack = deps.readJournal(chosen.workspacePath);
      const open = readBack === null ? null : openStackReclaim(readBack);
      if (!open || open.at !== written.at || open.containers.join('\n') !== names.join('\n')) {
        return { kind: 'idle' as const, reason: 'journal-unwritable' };
      }
      const stopped: string[] = [];
      const failed: string[] = [];
      for (const container of chosen.containers) {
        const result = await deps.stopContainer(container.id);
        if (result.ok) {
          stopped.push(container.name);
        } else {
          failed.push(container.name);
          console.warn(`[stack-reclaim] docker stop ${container.name} (${container.id}) failed: ${result.error}`);
        }
      }
      return { kind: 'stopped' as const, stopped, failed, head: checked.head };
    });
  } catch (error) {
    if (!entered) return idle('lock-busy');
    throw error;
  }
  if (outcome.kind === 'idle') return outcome;

  deps.emitActivity({
    source: 'cloister',
    level: 'info',
    issueId: chosen.issueId,
    message: `stack-reclaimed: ${chosen.issueId}`,
    details: reclaimActivityDetails(chosen.issueId, chosen.containers.map((c) => c.name), chosen.memoryBytes, outcome.head, outcome.failed),
  });
  state.restoreIndex.set(chosen.issueId, chosen.workspacePath);
  return { kind: 'reclaimed', issueId: chosen.issueId, stopped: outcome.stopped, failed: outcome.failed };
}

/**
 * D15: seed the index once from every workspace journal, so open reclaims
 * survive a restart (FR-7). A journal that cannot be read yet leaves
 * `state.seeded` false so a later tick retries every workspace, rather than
 * permanently missing the reclaim an unreadable journal was hiding.
 */
function seedRestoreIndex(deps: StackReclaimServiceDeps, state: StackReclaimState): void {
  let allReadable = true;
  for (const workspace of deps.listWorkspaces()) {
    if (!workspace.issueId || !deps.pathExists(workspace.path)) continue;
    const journal = deps.readJournal(workspace.path);
    if (journal === null) {
      allReadable = false;
      continue;
    }
    if (openStackReclaim(journal)) {
      state.restoreIndex.set(workspace.issueId.toUpperCase(), workspace.path);
    }
  }
  if (allReadable) state.seeded = true;
}

/** The restore poll (D15, WI-13): restores an open reclaim when its issue's agent is working or mid-turn. */
export async function runStackRestorePoll(deps: StackReclaimServiceDeps, state: StackReclaimState): Promise<void> {
  if (!state.seeded) seedRestoreIndex(deps, state);
  if (state.restoreIndex.size === 0) return;
  const panes = await deps.listPanes();
  if (!panes) return;
  const now = deps.now();
  for (const [issueId, workspacePath] of [...state.restoreIndex]) {
    if (!deps.pathExists(workspacePath)) {
      state.restoreIndex.delete(issueId);
      state.restoreRetryAt.delete(issueId);
      continue;
    }
    const journal = deps.readJournal(workspacePath);
    if (journal === null) continue; // unreadable this tick — keep the entry, try again next tick.
    if (!openStackReclaim(journal)) {
      state.restoreIndex.delete(issueId);
      state.restoreRetryAt.delete(issueId);
      continue;
    }
    if ((state.restoreRetryAt.get(issueId) ?? 0) > now) continue;
    if (!panesNeedStack(issuePanes(panes, issueId, workspacePath), deps.turnState)) continue;
    const result = await deps.restore({ issueId, workspacePath, trigger: 'turn' });
    if (result.kind === 'failed') {
      state.restoreRetryAt.set(issueId, now + STACK_RESTORE_RETRY_MS);
      console.warn(`[stack-reclaim] restore of ${issueId} failed: ${result.error}; retrying in ${STACK_RESTORE_RETRY_MS / 1000} s`);
      continue;
    }
    state.restoreIndex.delete(issueId);
    state.restoreRetryAt.delete(issueId);
  }
}

interface ServiceState {
  deps: StackReclaimServiceDeps;
  data: StackReclaimState;
  reclaimInFlight: boolean;
  restoreInFlight: boolean;
}

let service: ServiceState | null = null;
let reclaimTimer: ReturnType<typeof setInterval> | null = null;
let restoreTimer: ReturnType<typeof setInterval> | null = null;

async function reclaimOnce(s: ServiceState): Promise<void> {
  if (s.reclaimInFlight) return;
  s.reclaimInFlight = true;
  try {
    await runStackReclaimPoll(s.deps, s.data);
  } catch (error) {
    console.warn('[stack-reclaim] poll failed:', error instanceof Error ? error.message : String(error));
  } finally {
    s.reclaimInFlight = false;
  }
}

async function restoreOnce(s: ServiceState): Promise<void> {
  if (s.restoreInFlight) return;
  s.restoreInFlight = true;
  try {
    await runStackRestorePoll(s.deps, s.data);
  } catch (error) {
    console.warn('[stack-reclaim] restore poll failed:', error instanceof Error ? error.message : String(error));
  } finally {
    s.restoreInFlight = false;
  }
}

/** Idempotent. Starts the reclaim poll and the restore poll; neither holds the process open. */
export function startStackReclaimService(deps: Partial<StackReclaimServiceDeps> = {}): void {
  if (service !== null) return;
  const s: ServiceState = { deps: resolveDeps(deps), data: createStackReclaimState(), reclaimInFlight: false, restoreInFlight: false };
  service = s;
  reclaimTimer = setInterval(() => { void reclaimOnce(s); }, STACK_RECLAIM_POLL_MS);
  reclaimTimer.unref?.();
  restoreTimer = setInterval(() => { void restoreOnce(s); }, STACK_RESTORE_POLL_MS);
  restoreTimer.unref?.();
}

export function stopStackReclaimService(): void {
  if (reclaimTimer !== null) clearInterval(reclaimTimer);
  if (restoreTimer !== null) clearInterval(restoreTimer);
  reclaimTimer = null;
  restoreTimer = null;
  service = null;
}

/** Exported for tests: the running service's state, or null. */
export function stackReclaimStateForTests(): StackReclaimState | null {
  return service?.data ?? null;
}
