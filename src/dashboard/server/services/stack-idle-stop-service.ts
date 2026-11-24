/**
 * PAN-5250: primary-dashboard service that stops a workspace's frontend and
 * dev containers after they have sat unused for the project's idle-stop
 * minutes (default 20), even while the issue's work agent is alive.
 *
 * Every `STACK_IDLE_POLL_MS` it lists candidates (FR-2), probes them for use
 * (FR-3: browser connections, exec sessions, test/UAT agents, verification,
 * the gate queue, pins), and advances an in-memory idle clock per issue
 * (FR-4). A due workspace is stopped inside its stack lock after every fact
 * is re-read fresh; the `stack.reclaimed` entry (reason `idle`) is journaled
 * and read back before any `docker stop` (FR-5). One activity entry names the
 * restart path (FR-6).
 *
 * Deny by default (NFR-3): an unreadable listing, pane inventory or gate queue
 * skips the whole poll; an unreadable usage probe or memory read skips that
 * workspace. Started and stopped by `startStackReclaimService` /
 * `stopStackReclaimService`, so it runs in the primary dashboard only
 * (NFR-4). This module must never import `stack-reclaim-service.ts`, which
 * imports it.
 */
import type { BackendPane } from '@overdeck/contracts';
import { existsSync } from 'node:fs';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import {
  appendPipelineEntry,
  openStackReclaim,
  readPipelineJournal,
  type PipelineJournalEntry,
} from '../../../lib/cloister/pipeline-journal.js';
import type { QualityGateQueueSnapshot } from '../../../lib/cloister/quality-gate-admission.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { tryComposeProjectNameForWorkspace } from '../../../lib/workspace/stack-health.js';
import {
  IDLE_STOP_DISABLE_ENV,
  idleStopConfigForIssue,
  isStackPinned,
  type IdleStopConfig,
} from '../../../lib/workspace/stack-idle-config.js';
import { advanceIdleClock, idleStopTargets, workspaceInUse } from '../../../lib/workspace/stack-idle-stop.js';
import { issueInGateQueue, issuePanes } from '../../../lib/workspace/stack-reclaim.js';
import {
  listComposeContainers,
  readContainerMemoryBytes,
  stopContainer,
  type ComposeContainer,
} from '../../../lib/workspace/stack-reclaim-docker.js';
import { stackLockPath, withStackLock } from '../../../lib/workspace/stack-restore.js';
import { probeContainerUsage, type ContainerUsageResult } from '../../../lib/workspace/stack-usage-probe.js';
import { listWorkspaces } from '../../../lib/workspaces/resolver.js';
import type { WorkspaceRow } from '../../../lib/workspaces/types.js';

export const STACK_IDLE_POLL_MS = 60_000;
const IDLE_LOCK_TIMEOUT_MS = 5_000;

export interface StackIdleStopDeps {
  listWorkspaces: () => WorkspaceRow[];
  pathExists: (path: string) => boolean;
  projectRegistered: (issueId: string) => boolean;
  configFor: (issueId: string) => IdleStopConfig;
  composeProjectFor: (workspacePath: string, issueId: string) => string | null;
  listRunningContainers: () => Promise<ComposeContainer[] | null>;
  listPanes: () => Promise<BackendPane[] | null>;
  readQueue: () => Promise<QualityGateQueueSnapshot>;
  verificationBusy: (issueId: string) => boolean;
  isPinned: (workspacePath: string) => boolean;
  probeUsage: (names: readonly string[]) => Promise<Map<string, ContainerUsageResult> | null>;
  readMemoryBytes: (names: readonly string[]) => Promise<Map<string, number> | null>;
  readJournal: (workspacePath: string) => PipelineJournalEntry[];
  appendEntry: typeof appendPipelineEntry;
  stopContainer: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  emitActivity: typeof emitActivityEntry;
  withLock: <T>(lockPath: string, fn: () => Promise<T>) => Promise<T>;
  now: () => number;
}

/** The three deps the reclaim service already resolves; they have no default here. */
export type StackIdleStopStartDeps = Partial<StackIdleStopDeps> & Pick<StackIdleStopDeps, 'listPanes' | 'readQueue' | 'verificationBusy'>;

function resolveDeps(deps: StackIdleStopStartDeps): StackIdleStopDeps {
  return {
    listWorkspaces: deps.listWorkspaces ?? (() => listWorkspaces()),
    pathExists: deps.pathExists ?? existsSync,
    projectRegistered: deps.projectRegistered ?? ((issueId) => resolveProjectFromIssueSync(issueId) !== null),
    configFor: deps.configFor ?? idleStopConfigForIssue,
    composeProjectFor: deps.composeProjectFor ?? tryComposeProjectNameForWorkspace,
    listRunningContainers: deps.listRunningContainers ?? (() => listComposeContainers({ all: false })),
    listPanes: deps.listPanes,
    readQueue: deps.readQueue,
    verificationBusy: deps.verificationBusy,
    isPinned: deps.isPinned ?? isStackPinned,
    probeUsage: deps.probeUsage ?? ((names) => probeContainerUsage(names)),
    readMemoryBytes: deps.readMemoryBytes ?? readContainerMemoryBytes,
    readJournal: deps.readJournal ?? ((workspacePath) => readPipelineJournal(workspacePath)),
    appendEntry: deps.appendEntry ?? appendPipelineEntry,
    stopContainer: deps.stopContainer ?? stopContainer,
    emitActivity: deps.emitActivity ?? emitActivityEntry,
    withLock: deps.withLock ?? ((lockPath, fn) => withStackLock(lockPath, fn, IDLE_LOCK_TIMEOUT_MS)),
    now: deps.now ?? Date.now,
  };
}

export type StackIdlePollResult =
  | { kind: 'idle'; reason: string }
  | { kind: 'polled'; stopped: string[]; waiting: string[] };

interface IdleCandidate {
  issueId: string;
  workspacePath: string;
  composeProject: string;
  config: IdleStopConfig;
  targets: ComposeContainer[];
}

/** FR-2: every rule must hold; containers match only by exact compose labels. */
function buildCandidates(deps: StackIdleStopDeps, running: readonly ComposeContainer[]): IdleCandidate[] {
  const candidates: IdleCandidate[] = [];
  const seen = new Set<string>();
  for (const workspace of deps.listWorkspaces()) {
    if (workspace.kind === 'main' || !workspace.issueId) continue;
    const issueId = workspace.issueId.toUpperCase();
    if (seen.has(issueId) || !deps.pathExists(workspace.path)) continue;
    if (!deps.projectRegistered(issueId)) continue;
    const config = deps.configFor(issueId);
    if (!config.enabled) continue;
    const composeProject = deps.composeProjectFor(workspace.path, issueId);
    if (!composeProject) continue;
    const targets = idleStopTargets(running, composeProject, config.services);
    if (targets.length === 0) continue;
    seen.add(issueId);
    candidates.push({ issueId, workspacePath: workspace.path, composeProject, config, targets });
  }
  return candidates;
}

function formatGib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function idleActivityDetails(issueId: string, names: readonly string[], idleMs: number, memoryBytes: number, failed: readonly string[]): string {
  const failedText = failed.length > 0 ? ` docker stop failed for ${failed.join(', ')}.` : '';
  return `Stopped ${names.join(', ')} after ${Math.round(idleMs / 60_000)} min unused, freeing ${formatGib(memoryBytes)} GiB. `
    + `They start again when you open the app's URL, a test or UAT agent is spawned for ${issueId}, `
    + `its verification starts, or you run: pan workspace up ${issueId}.${failedText}`;
}

type LockedOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'stopped'; stopped: string[]; failed: string[]; memoryBytes: number };

/** FR-5: every fact re-read fresh under the stack lock, journal and read back, then stop by id. */
async function stopUnderLock(
  deps: StackIdleStopDeps,
  clock: Map<string, number>,
  candidate: IdleCandidate,
  idleMs: number,
): Promise<LockedOutcome> {
  const { issueId, workspacePath, composeProject, config, targets } = candidate;
  const running = await deps.listRunningContainers();
  if (!running) return { kind: 'skipped', reason: 'docker-unreadable' };
  const byName = new Map(running.map((container) => [container.name, container]));
  for (const target of targets) {
    const now = byName.get(target.name);
    if (!now
      || now.id !== target.id
      || now.state !== 'running'
      || now.composeProject !== composeProject
      || !config.services.has(now.composeService)) {
      return { kind: 'skipped', reason: 'changed-before-stop' };
    }
  }

  const names = targets.map((target) => target.name);
  const panes = await deps.listPanes();
  if (!panes) return { kind: 'skipped', reason: 'inventory-unreadable' };
  const queue = await deps.readQueue();
  if (queue.readError) return { kind: 'skipped', reason: 'queue-unreadable' };
  const usage = await deps.probeUsage(names);
  const inUse = workspaceInUse({
    targets,
    usage: usage ?? new Map(),
    panes: issuePanes(panes, issueId, workspacePath),
    verificationBusy: deps.verificationBusy(issueId),
    inGateQueue: issueInGateQueue(queue, issueId, workspacePath),
    pinned: deps.isPinned(workspacePath),
  });
  if (inUse !== null) {
    clock.delete(issueId);
    return { kind: 'skipped', reason: `in-use:${inUse}` };
  }

  const memory = await deps.readMemoryBytes(names);
  if (!memory) return { kind: 'skipped', reason: 'stats-unreadable' };
  const memoryBytes = names.reduce((sum, name) => sum + (memory.get(name) ?? 0), 0);

  const written = deps.appendEntry(workspacePath, {
    type: 'stack.reclaimed',
    issueId,
    source: 'stack-idle-stop',
    data: {
      containers: names,
      containerIds: targets.map((target) => target.id),
      services: targets.map((target) => target.composeService),
      composeProject,
      memoryBytes,
      reason: 'idle',
      idleMs,
    },
  });
  // appendPipelineEntry swallows write errors, so stop nothing unless the entry landed (D4: newest entry only).
  const open = openStackReclaim(deps.readJournal(workspacePath));
  if (!open || open.latestAt !== written.at || open.latestContainers.join('\n') !== names.join('\n')) {
    return { kind: 'skipped', reason: 'journal-unwritable' };
  }

  const stopped: string[] = [];
  const failed: string[] = [];
  for (const target of targets) {
    const result = await deps.stopContainer(target.id);
    if (result.ok) {
      stopped.push(target.name);
    } else {
      failed.push(target.name);
      console.warn(`[stack-idle-stop] docker stop ${target.name} (${target.id}) failed: ${result.error}`);
    }
  }
  clock.delete(issueId);
  return { kind: 'stopped', stopped, failed, memoryBytes };
}

/** One poll: FR-4 clock steps for every candidate, then the FR-5 stop for each due one. */
export async function runStackIdleStopPoll(deps: StackIdleStopDeps, clock: Map<string, number>): Promise<StackIdlePollResult> {
  if (process.env[IDLE_STOP_DISABLE_ENV] === '1') {
    clock.clear();
    return { kind: 'idle', reason: 'disabled' };
  }
  const running = await deps.listRunningContainers();
  if (!running) return { kind: 'idle', reason: 'docker-unreadable' };
  const panes = await deps.listPanes();
  if (!panes) return { kind: 'idle', reason: 'inventory-unreadable' };
  const queue = await deps.readQueue();
  if (queue.readError) return { kind: 'idle', reason: 'queue-unreadable' };

  const candidates = buildCandidates(deps, running);
  const candidateIds = new Set(candidates.map((candidate) => candidate.issueId));
  for (const issueId of [...clock.keys()]) {
    if (!candidateIds.has(issueId)) clock.delete(issueId);
  }
  if (candidates.length === 0) return { kind: 'polled', stopped: [], waiting: [] };

  const usage = await deps.probeUsage(candidates.flatMap((candidate) => candidate.targets.map((target) => target.name)));
  const now = deps.now();
  const due: { candidate: IdleCandidate; idleMs: number }[] = [];
  const waiting: string[] = [];
  for (const candidate of candidates) {
    const inUse = workspaceInUse({
      targets: candidate.targets,
      usage: usage ?? new Map(),
      panes: issuePanes(panes, candidate.issueId, candidate.workspacePath),
      verificationBusy: deps.verificationBusy(candidate.issueId),
      inGateQueue: issueInGateQueue(queue, candidate.issueId, candidate.workspacePath),
      pinned: deps.isPinned(candidate.workspacePath),
    });
    const step = advanceIdleClock(clock, candidate.issueId, inUse, now, candidate.config.minutes * 60_000);
    if (step.kind === 'due') due.push({ candidate, idleMs: step.idleMs });
    else if (step.kind !== 'in-use') waiting.push(candidate.issueId);
  }

  const stopped: string[] = [];
  due.sort((a, b) => a.candidate.issueId.localeCompare(b.candidate.issueId));
  for (const { candidate, idleMs } of due) {
    let entered = false;
    let outcome: LockedOutcome;
    try {
      outcome = await deps.withLock(stackLockPath(candidate.workspacePath), async () => {
        entered = true;
        return stopUnderLock(deps, clock, candidate, idleMs);
      });
    } catch (error) {
      if (entered) {
        console.warn(`[stack-idle-stop] ${candidate.issueId}: stop failed:`, error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    if (outcome.kind === 'skipped') continue;
    stopped.push(...outcome.stopped);
    deps.emitActivity({
      source: 'cloister',
      level: 'info',
      issueId: candidate.issueId,
      message: `stack-idle-stopped: ${candidate.issueId}`,
      details: idleActivityDetails(
        candidate.issueId,
        candidate.targets.map((target) => target.name),
        idleMs,
        outcome.memoryBytes,
        outcome.failed,
      ),
    });
  }
  return { kind: 'polled', stopped, waiting };
}

interface ServiceState {
  deps: StackIdleStopDeps;
  clock: Map<string, number>;
  inFlight: boolean;
}

let service: ServiceState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function pollOnce(s: ServiceState): Promise<void> {
  if (s.inFlight) return;
  s.inFlight = true;
  try {
    await runStackIdleStopPoll(s.deps, s.clock);
  } catch (error) {
    console.warn('[stack-idle-stop] poll failed:', error instanceof Error ? error.message : String(error));
  } finally {
    s.inFlight = false;
  }
}

/** Idempotent. Starts the idle-stop poll; it never holds the process open. */
export function startStackIdleStopService(deps: StackIdleStopStartDeps): void {
  if (service !== null) return;
  const s: ServiceState = { deps: resolveDeps(deps), clock: new Map(), inFlight: false };
  service = s;
  timer = setInterval(() => { void pollOnce(s); }, STACK_IDLE_POLL_MS);
  timer.unref?.();
}

export function stopStackIdleStopService(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  service = null;
}
