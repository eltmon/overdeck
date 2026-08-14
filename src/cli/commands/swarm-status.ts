import { join } from 'node:path';
import chalk from 'chalk';
import { Effect } from 'effect';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { findSpecByIssue } from '../../lib/pan-dir/specs.js';
import { readIssueRecordForWorkspaceSync } from '../../lib/pan-dir/record.js';
import { applyStatusOverrides } from '../../lib/xbrief/io.js';
import type { XBriefDocument } from '../../lib/xbrief/types.js';
import {
  classifyInFlightSlots,
  getFailedMergeBlocks,
  type ClassifiedSwarmSlot,
} from '../../lib/cloister/deacon-swarm.js';
import { reconcileSlotState } from '../../lib/agents/slot-reconcile.js';
import { readSwarmHold, readSwarmInterventions } from '../../lib/cloister/deacon-swarm-record.js';
import { countRunningSwarmSlotsForIssue, getConcurrencyLimits } from '../../lib/cloister/concurrency.js';
import { getReviewStatusSync } from '../../lib/review-status.js';
import { listSessionNamesSync } from '../../lib/tmux.js';

type ConsoleLike = Pick<typeof console, 'log' | 'error'>;

interface ResolvedProjectLike {
  projectName: string;
  projectPath: string;
}

export interface SwarmStatusCommandDeps {
  resolveProjectFromIssueSync: (issueId: string) => ResolvedProjectLike | null;
  findSpecByIssue: typeof findSpecByIssue;
  reconcileSlotState: typeof reconcileSlotState;
  classifyInFlightSlots: (
    slots: Parameters<typeof classifyInFlightSlots>[0],
    workspacePath: string,
  ) => Promise<ClassifiedSwarmSlot[]>;
  getFailedMergeBlocks: typeof getFailedMergeBlocks;
  getReviewStatusSync: typeof getReviewStatusSync;
  readSwarmHold: typeof readSwarmHold;
  readSwarmInterventions: typeof readSwarmInterventions;
  readStatusOverrides: (workspacePath: string, issueId: string) => Record<string, string> | undefined;
  listSessionNamesSync: () => string[];
  getConcurrencyLimits: typeof getConcurrencyLimits;
  countRunningSwarmSlotsForIssue: (issueId: string) => number;
  console: ConsoleLike;
}

export interface SwarmStatusOptions {
  json?: boolean;
}

export interface SwarmStatusSnapshot {
  issueId: string;
  foreman: { agentId: string; alive: boolean };
  hold: ReturnType<typeof readSwarmHold>;
  interventions: ReturnType<typeof readSwarmInterventions>;
  capacity: { used: number; limit: number };
  slots: Array<{
    slotIndex: number;
    itemId: string;
    lifecycle: string;
    branch: string;
    branchMerged?: boolean;
    sessionAlive: boolean;
    blockNote?: string;
  }>;
}

export interface SwarmWaitOptions {
  timeout?: string | number;
  json?: boolean;
}

export interface SwarmWaitCommandDeps {
  getSnapshot: (issueId: string) => Promise<SwarmStatusSnapshot | null>;
  delay: (milliseconds: number) => Promise<void>;
  pollIntervalMs: number;
  console: ConsoleLike;
}

const defaultStatusDeps: SwarmStatusCommandDeps = {
  resolveProjectFromIssueSync,
  findSpecByIssue,
  reconcileSlotState,
  classifyInFlightSlots: (slots, workspacePath) => classifyInFlightSlots(slots, undefined, { workspacePath }),
  getFailedMergeBlocks,
  getReviewStatusSync,
  readSwarmHold,
  readSwarmInterventions,
  readStatusOverrides: (workspacePath, issueId) =>
    readIssueRecordForWorkspaceSync(workspacePath, issueId)?.statusOverrides,
  listSessionNamesSync,
  getConcurrencyLimits,
  countRunningSwarmSlotsForIssue,
  console,
};

const defaultWaitDeps: SwarmWaitCommandDeps = {
  getSnapshot: issueId => deriveSwarmStatus(issueId, defaultStatusDeps),
  delay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  pollIntervalMs: 1_000,
  console,
};

export async function deriveSwarmStatus(
  issueId: string,
  deps: SwarmStatusCommandDeps = defaultStatusDeps,
): Promise<SwarmStatusSnapshot | null> {
  const issue = issueId.toUpperCase();
  const issueLower = issue.toLowerCase();
  const loaded = await loadSwarmPlan(issue, deps);
  if (!loaded) return null;
  const workspacePath = join(loaded.project.projectPath, 'workspaces', `feature-${issueLower}`);
  const overrides = deps.readStatusOverrides(workspacePath, issue);
  const effectiveDoc = overrides && Object.keys(overrides).length > 0
    ? applyStatusOverrides(loaded.doc, overrides)
    : loaded.doc;
  const reconciled = await deps.reconcileSlotState(issue, workspacePath, effectiveDoc);
  const classified = await deps.classifyInFlightSlots(reconciled.inFlight, workspacePath);
  const lifecycleBySlot = new Map(classified.map(slot => [slot.slotIndex, slot.lifecycle]));
  const branchMergedBySlot = new Map(reconciled.branches.map(branch => [branch.slotIndex, branch.merged]));
  const liveSessions = new Set(safeListSessionNames(deps));
  const blockedSlots = deps.getFailedMergeBlocks(issue, workspacePath);
  const blockedSlotIndexes = new Set(blockedSlots.map(block => block.slotIndex));
  const blockBySlot = new Map(blockedSlots.map(block => [block.slotIndex, block]));
  const rows = [
    ...reconciled.merged.map(slot => ({ ...slot, lifecycle: 'merged' as const })),
    ...reconciled.inFlight.map(slot => ({
      ...slot,
      lifecycle: blockedSlotIndexes.has(slot.slotIndex)
        ? 'failed-merge-blocked'
        : (lifecycleBySlot.get(slot.slotIndex) ?? 'running'),
    })),
  ];
  for (const block of blockedSlots) {
    if (!rows.some(row => row.slotIndex === block.slotIndex)) {
      rows.push({ ...block, status: 'in_flight', agentId: undefined, lifecycle: 'failed-merge-blocked' as const });
    }
  }
  rows.sort((a, b) => a.slotIndex - b.slotIndex);
  const limits = deps.getConcurrencyLimits();
  const foremanId = `agent-${issueLower}`;
  return {
    issueId: issue,
    foreman: { agentId: foremanId, alive: liveSessions.has(foremanId) },
    hold: deps.readSwarmHold(workspacePath, issue),
    interventions: deps.readSwarmInterventions(workspacePath, issue),
    capacity: { used: deps.countRunningSwarmSlotsForIssue(issue), limit: limits.reservedSwarmSlots },
    slots: rows.map(row => {
      const branch = row.branch ?? `feature/${issueLower}-slot-${row.slotIndex}`;
      const sessionName = row.agentId ?? `agent-${issueLower}-slot-${row.slotIndex}`;
      return {
        slotIndex: row.slotIndex,
        itemId: row.itemId,
        lifecycle: row.lifecycle,
        branch,
        branchMerged: branchMergedBySlot.get(row.slotIndex),
        sessionAlive: liveSessions.has(sessionName),
        blockNote: blockBySlot.get(row.slotIndex)?.note,
      };
    }),
  };
}

export async function swarmStatusCommand(
  issueId: string,
  deps: SwarmStatusCommandDeps = defaultStatusDeps,
  options: SwarmStatusOptions = {},
): Promise<{ ok: boolean; snapshot?: SwarmStatusSnapshot }> {
  const snapshot = await deriveSwarmStatus(issueId, deps);
  if (!snapshot) {
    deps.console.error(chalk.red(`Could not resolve a swarm plan for ${issueId.toUpperCase()}.`));
    return { ok: false };
  }
  if (options.json) {
    deps.console.log(JSON.stringify(snapshot));
    return { ok: true, snapshot };
  }
  printHumanStatus(snapshot, safeGetReviewStatus(snapshot.issueId, deps), deps.console);
  return { ok: true, snapshot };
}

export async function swarmWaitCommand(
  issueId: string,
  options: SwarmWaitOptions = {},
  deps: SwarmWaitCommandDeps = defaultWaitDeps,
): Promise<{ ok: boolean; timedOut?: boolean; delta?: SwarmStatusDelta }> {
  const timeoutSeconds = Number(options.timeout ?? 300);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
    deps.console.error(chalk.red(`Invalid wait timeout: ${String(options.timeout)}`));
    return { ok: false };
  }
  const issue = issueId.toUpperCase();
  const before = await deps.getSnapshot(issue);
  if (!before) return { ok: false };
  const timeoutMs = timeoutSeconds * 1_000;
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    const interval = Math.min(deps.pollIntervalMs, timeoutMs - elapsed);
    await deps.delay(interval);
    elapsed += interval;
    const after = await deps.getSnapshot(issue);
    if (!after) return { ok: false };
    const delta = diffSnapshots(before, after);
    if (delta.slots.length > 0 || delta.foreman || delta.holdChanged) {
      deps.console.log(JSON.stringify({ issueId: issue, timedOut: false, delta }));
      return { ok: true, timedOut: false, delta };
    }
  }
  const delta: SwarmStatusDelta = { slots: [], holdChanged: false };
  deps.console.log(JSON.stringify({ issueId: issue, timedOut: true, delta }));
  return { ok: true, timedOut: true, delta };
}

interface SwarmStatusDelta {
  slots: Array<{ slotIndex: number; before?: string; after?: string; sessionExited?: boolean }>;
  foreman?: { before: boolean; after: boolean };
  holdChanged: boolean;
}

function diffSnapshots(before: SwarmStatusSnapshot, after: SwarmStatusSnapshot): SwarmStatusDelta {
  const oldSlots = new Map(before.slots.map(slot => [slot.slotIndex, slot]));
  const newSlots = new Map(after.slots.map(slot => [slot.slotIndex, slot]));
  const slotIndexes = [...new Set([...oldSlots.keys(), ...newSlots.keys()])].sort((a, b) => a - b);
  const slots = slotIndexes.flatMap(slotIndex => {
    const old = oldSlots.get(slotIndex);
    const next = newSlots.get(slotIndex);
    if (old?.lifecycle === next?.lifecycle && old?.sessionAlive === next?.sessionAlive) return [];
    return [{
      slotIndex,
      before: old?.lifecycle,
      after: next?.lifecycle,
      sessionExited: old?.sessionAlive === true && next?.sessionAlive !== true || undefined,
    }];
  });
  return {
    slots,
    foreman: before.foreman.alive === after.foreman.alive
      ? undefined
      : { before: before.foreman.alive, after: after.foreman.alive },
    holdChanged: JSON.stringify(before.hold) !== JSON.stringify(after.hold),
  };
}

function printHumanStatus(
  snapshot: SwarmStatusSnapshot,
  reviewHold: ReturnType<typeof getReviewStatusSync>,
  output: ConsoleLike,
): void {
  output.log(chalk.bold(`Swarm status for ${snapshot.issueId}`));
  output.log(`Foreman: ${snapshot.foreman.agentId} (${snapshot.foreman.alive ? 'session alive' : 'session dead'})`);
  if (snapshot.hold) output.log(`Hold: frozen — ${snapshot.hold.reason}`);
  else if (reviewHold?.deaconIgnored) {
    const reason = reviewHold.deaconIgnoredReason ? ` Reason: ${reviewHold.deaconIgnoredReason}.` : '';
    output.log(`Hold: deacon-ignored — run \`pan swarm resume ${snapshot.issueId}\` to lift it.${reason}`);
  }
  else if (reviewHold?.stuck) output.log(`Hold: stuck — ${reviewHold.stuckReason ?? 'no reason recorded'}`);
  else output.log(
    'Hold: none — the foreman may run gated dispatch, merge, and recovery actions. '
    + 'Deacon patrols provide janitor, liveness, and event-delivery backstops.',
  );
  output.log(`Capacity: ${snapshot.capacity.used} of ${snapshot.capacity.limit} swarm slots in use.`);
  if (Object.keys(snapshot.interventions).length > 0) {
    output.log(`Interventions: ${JSON.stringify(snapshot.interventions)}`);
  }
  if (snapshot.slots.length === 0) {
    output.log('Slots: none.');
    return;
  }
  output.log('Slots:');
  for (const slot of snapshot.slots) {
    const branchState = slot.branchMerged === undefined ? 'no local branch' : slot.branchMerged ? 'merged' : 'unmerged';
    const lifecycle = slot.lifecycle === 'failed-merge-blocked' ? 'failed-merge (blocked)' : slot.lifecycle;
    output.log(
      `  slot ${slot.slotIndex} · item ${slot.itemId} · ${lifecycle} · branch ${slot.branch} (${branchState}) · `
      + (slot.sessionAlive ? 'session alive' : 'session dead'),
    );
  }
  const blocked = snapshot.slots.filter(slot => slot.blockNote);
  if (blocked.length > 0) {
    output.log('Blocked slots:');
    for (const slot of blocked) {
      output.log(
        `  slot ${slot.slotIndex} (item ${slot.itemId}): ${slot.blockNote}. `
        + `Recover with \`pan swarm recover ${snapshot.issueId} ${slot.slotIndex} --action retry|drop|handoff\`.`,
      );
    }
  }
}

async function loadSwarmPlan(
  issueId: string,
  deps: Pick<SwarmStatusCommandDeps, 'resolveProjectFromIssueSync' | 'findSpecByIssue'>,
): Promise<{ project: ResolvedProjectLike; doc: XBriefDocument } | null> {
  const project = deps.resolveProjectFromIssueSync(issueId);
  if (!project) return null;
  const spec = await Effect.runPromise(deps.findSpecByIssue(project.projectPath, issueId));
  return spec ? { project, doc: spec.document } : null;
}

function safeListSessionNames(deps: Pick<SwarmStatusCommandDeps, 'listSessionNamesSync'>): string[] {
  try { return deps.listSessionNamesSync(); } catch { return []; }
}

function safeGetReviewStatus(
  issueId: string,
  deps: Pick<SwarmStatusCommandDeps, 'getReviewStatusSync'>,
): ReturnType<typeof getReviewStatusSync> {
  try { return deps.getReviewStatusSync(issueId); } catch { return null; }
}
