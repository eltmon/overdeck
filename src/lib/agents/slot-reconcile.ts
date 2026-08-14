import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readIssueRecordForWorkspaceSync } from '../pan-dir/record.js';
import { findProjectByPathSync, getProjectSwarmHotspots } from '../projects.js';
import { analyzeSwarmReadiness } from '../xbrief/swarm-readiness.js';
import type { XBriefDocument } from '../xbrief/types.js';
import { listAgentStates } from './queries.js';
import type { AgentState } from './agent-state.js';
import { RETAINED_TRANSCRIPTS_PHASE } from '../overdeck/agents.js';
import type { PanIssueSwarmSlotCompletion } from '../pan-dir/record.js';

const execAsync = promisify(exec);

export type ReconciledSlotItemStatus = 'merged' | 'in_flight' | 'pending';

export interface ReconciledSlotBranch {
  slotIndex: number;
  branch: string;
  merged: boolean;
}

export interface ReconciledSlotAgent {
  slotIndex: number;
  agentId: string;
  status: AgentState['status'];
  slotItemId?: string;
}

export interface ReconciledSlotAssignment {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
}

export interface ReconciledSlotItem {
  itemId: string;
  slotIndex: number;
  status: ReconciledSlotItemStatus;
  branch?: string;
  agentId?: string;
  mergedVia?: 'completed-status' | 'branch-ancestry';
}

export interface SlotReconcileResult {
  issueId: string;
  merged: ReconciledSlotItem[];
  inFlight: ReconciledSlotItem[];
  pending: ReconciledSlotItem[];
  branches: ReconciledSlotBranch[];
  agents: ReconciledSlotAgent[];
  superseded?: NonNullable<NonNullable<ReturnType<typeof readIssueRecordForWorkspaceSync>>['swarm']>['supersededAttempts'];
}

export interface SlotReconcileDeps {
  listBranches: (issueId: string, workspace: string) => Promise<ReconciledSlotBranch[]>;
  listAgents: (issueId: string) => ReconciledSlotAgent[];
  listSlotAssignments: (issueId: string, workspace: string) => ReconciledSlotAssignment[];
  listSlotCompletions: (issueId: string, workspace: string) => Record<string, PanIssueSwarmSlotCompletion>;
}

export interface SlotReconcileOptions {
  statusOverrides?: Record<string, string>;
  deps?: Partial<SlotReconcileDeps>;
}

export async function reconcileSlotState(
  issueId: string,
  workspace: string,
  doc: XBriefDocument,
  options: SlotReconcileOptions = {},
): Promise<SlotReconcileResult> {
  const deps: SlotReconcileDeps = {
    listBranches: listSlotBranches,
    listAgents: listSlotAgents,
    listSlotAssignments,
    listSlotCompletions,
    ...options.deps,
  };
  const branches = await deps.listBranches(issueId, workspace);
  const agents = deps.listAgents(issueId);
  const assignments = deps.listSlotAssignments(issueId, workspace);
  const completions = deps.listSlotCompletions(issueId, workspace);
  const releasedSlotIndexes = new Set(Object.keys(
    readIssueRecordForWorkspaceSync(workspace, issueId.toUpperCase())?.swarm?.releasedBlockedSlots ?? {},
  ).map(Number));
  const branchesBySlot = new Map(branches.map(branch => [branch.slotIndex, branch]));
  const agentsBySlot = new Map(agents.map(agent => [agent.slotIndex, agent]));
  const hotspots = getProjectSwarmHotspots(findProjectByPathSync(workspace));
  const slotEligibleItemIds = new Set(analyzeSwarmReadiness(doc, { hotspots }).items
    .filter(item => item.slotEligible)
    .map(item => item.id));
  const itemStatuses = new Map(doc.plan.items.map(item => [item.id, item.status]));
  const slotItems = resolveSlotItemOwnership(slotEligibleItemIds, assignments, agents, releasedSlotIndexes);

  const result: SlotReconcileResult = {
    issueId,
    merged: [],
    inFlight: [],
    pending: [],
    branches,
    agents,
    superseded: readIssueRecordForWorkspaceSync(workspace, issueId.toUpperCase())?.swarm?.supersededAttempts ?? [],
  };

  for (const slotItem of slotItems) {
    const branch = branchesBySlot.get(slotItem.slotIndex);
    const agent = agentsBySlot.get(slotItem.slotIndex);
    const completed = options.statusOverrides?.[slotItem.itemId] === 'completed'
      || itemStatuses.get(slotItem.itemId) === 'completed';
    // Branch ancestry is only supporting evidence. A polyrepo workspace root
    // can be unchanged while its member repositories still contain live slot
    // work, which makes the wrapper slot branch appear merged immediately.
    // A slot completion marker means the worker is done but the merge door has
    // not consumed the branch yet. mergeReadySlots clears that marker only
    // after verifyAndMergeSlot succeeds, then records the item as completed.
    const awaitingMerge = completions[String(slotItem.slotIndex)]?.itemId === slotItem.itemId;
    const merged = completed && !awaitingMerge;
    const entry: ReconciledSlotItem = {
      ...slotItem,
      status: merged ? 'merged' : agent || branch ? 'in_flight' : 'pending',
      branch: branch?.branch,
      agentId: agent?.agentId,
      ...(merged ? { mergedVia: 'completed-status' as const } : {}),
    };

    if (entry.status === 'merged') result.merged.push(entry);
    else if (entry.status === 'in_flight') result.inFlight.push(entry);
    else result.pending.push(entry);
  }

  return result;
}

export async function listSlotBranches(issueId: string, workspace: string): Promise<ReconciledSlotBranch[]> {
  const issueLower = issueId.toLowerCase();
  const pattern = `feature/${issueLower}-slot-*`;
  const [allBranches, mergedBranches] = await Promise.all([
    gitBranchNames(workspace, pattern, false),
    gitBranchNames(workspace, pattern, true),
  ]);
  const mergedSet = new Set(mergedBranches);
  return allBranches
    .map(branch => ({ branch, slotIndex: slotIndexFromBranch(issueLower, branch), merged: mergedSet.has(branch) }))
    .filter((branch): branch is ReconciledSlotBranch => branch.slotIndex !== null)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

export function listSlotAgents(issueId: string): ReconciledSlotAgent[] {
  const issueLower = issueId.toLowerCase();
  const pattern = new RegExp(`^agent-${escapeRegExp(issueLower)}-slot-(\\d+)$`);
  return listAgentStates({ role: 'work' })
    .map(agent => {
      // PAN-3465: tombstoned rows (removeAgent keeps them for transcript
      // linkage) are not live slot occupants — counting them wedged dispatch
      // with "all slot indexes occupied" after a swarm reset.
      if (agent.phase === RETAINED_TRANSCRIPTS_PHASE) return null;
      const match = pattern.exec(agent.id);
      if (!match) return null;
      const entry: ReconciledSlotAgent = {
        slotIndex: Number(match[1]),
        agentId: agent.id,
        status: agent.status,
      };
      if (agent.slotItemId) entry.slotItemId = agent.slotItemId;
      return entry;
    })
    .filter((agent): agent is ReconciledSlotAgent => agent !== null)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

export function listSlotAssignments(issueId: string, workspace: string): ReconciledSlotAssignment[] {
  const record = readIssueRecordForWorkspaceSync(workspace, issueId.toUpperCase());
  return (record?.swarm?.slotAssignments ?? [])
    .filter(assignment => Number.isInteger(assignment.slotIndex) && assignment.slotIndex > 0 && assignment.itemId.trim().length > 0)
    .map(assignment => ({
      slotIndex: assignment.slotIndex,
      itemId: assignment.itemId,
      agentId: assignment.agentId,
      branch: assignment.branch,
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

export function listSlotCompletions(issueId: string, workspace: string): Record<string, PanIssueSwarmSlotCompletion> {
  return readIssueRecordForWorkspaceSync(workspace, issueId.toUpperCase())?.swarm?.slotCompletions ?? {};
}

export function listSlotOwnership(issueId: string, workspace: string): ReconciledSlotAssignment[] {
  const byItemId = new Map<string, ReconciledSlotAssignment>();
  for (const assignment of listSlotAssignments(issueId, workspace)) {
    byItemId.set(assignment.itemId, assignment);
  }
  for (const agent of listSlotAgents(issueId)) {
    if (!agent.slotItemId || byItemId.has(agent.slotItemId)) continue;
    byItemId.set(agent.slotItemId, {
      slotIndex: agent.slotIndex,
      itemId: agent.slotItemId,
      agentId: agent.agentId,
    });
  }
  return [...byItemId.values()].sort((a, b) => a.slotIndex - b.slotIndex);
}

async function gitBranchNames(workspace: string, pattern: string, merged: boolean): Promise<string[]> {
  const { stdout } = await execAsync(
    `git branch ${merged ? '--merged HEAD ' : ''}--list ${JSON.stringify(pattern)}`,
    { cwd: workspace },
  );
  return stdout
    .split('\n')
    .map(line => line.replace(/^[*+\s]+/, '').trim())
    .filter(Boolean);
}

function resolveSlotItemOwnership(
  slotEligibleItemIds: Set<string>,
  assignments: ReconciledSlotAssignment[],
  agents: ReconciledSlotAgent[],
  releasedSlotIndexes: Set<number>,
): Array<{ itemId: string; slotIndex: number }> {
  const ownership = new Map<string, number>();

  for (const assignment of assignments) {
    if (!slotEligibleItemIds.has(assignment.itemId)) continue;
    ownership.set(assignment.itemId, assignment.slotIndex);
  }

  for (const agent of agents) {
    if (agent.status === 'stopped' && releasedSlotIndexes.has(agent.slotIndex)) continue;
    if (!agent.slotItemId || !slotEligibleItemIds.has(agent.slotItemId) || ownership.has(agent.slotItemId)) continue;
    ownership.set(agent.slotItemId, agent.slotIndex);
  }

  return [...ownership.entries()]
    .map(([itemId, slotIndex]) => ({ itemId, slotIndex }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

function slotIndexFromBranch(issueLower: string, branch: string): number | null {
  const match = new RegExp(`^feature/${escapeRegExp(issueLower)}-slot-(\\d+)(?:-attempt-\\d+)?$`).exec(branch);
  if (!match) return null;
  return Number(match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
