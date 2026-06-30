import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { findProjectByPathSync, getProjectSwarmHotspots } from '../projects.js';
import { analyzeSwarmReadiness } from '../vbrief/swarm-readiness.js';
import type { VBriefDocument } from '../vbrief/types.js';
import { listAgentStates } from './queries.js';
import type { AgentState } from './agent-state.js';

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
}

export interface ReconciledSlotItem {
  itemId: string;
  slotIndex: number;
  status: ReconciledSlotItemStatus;
  branch?: string;
  agentId?: string;
}

export interface SlotReconcileResult {
  issueId: string;
  merged: ReconciledSlotItem[];
  inFlight: ReconciledSlotItem[];
  pending: ReconciledSlotItem[];
  branches: ReconciledSlotBranch[];
  agents: ReconciledSlotAgent[];
}

export interface SlotReconcileDeps {
  listBranches: (issueId: string, workspace: string) => Promise<ReconciledSlotBranch[]>;
  listAgents: (issueId: string) => ReconciledSlotAgent[];
}

export interface SlotReconcileOptions {
  statusOverrides?: Record<string, string>;
  deps?: Partial<SlotReconcileDeps>;
}

export async function reconcileSlotState(
  issueId: string,
  workspace: string,
  doc: VBriefDocument,
  options: SlotReconcileOptions = {},
): Promise<SlotReconcileResult> {
  const deps: SlotReconcileDeps = {
    listBranches: listSlotBranches,
    listAgents: listSlotAgents,
    ...options.deps,
  };
  const branches = await deps.listBranches(issueId, workspace);
  const agents = deps.listAgents(issueId);
  const branchesBySlot = new Map(branches.map(branch => [branch.slotIndex, branch]));
  const agentsBySlot = new Map(agents.map(agent => [agent.slotIndex, agent]));
  const hotspots = getProjectSwarmHotspots(findProjectByPathSync(workspace));
  const slotItems = analyzeSwarmReadiness(doc, { hotspots }).items
    .filter(item => item.slotEligible)
    .map((item, index) => ({ itemId: item.id, slotIndex: index + 1 }));

  const result: SlotReconcileResult = {
    issueId,
    merged: [],
    inFlight: [],
    pending: [],
    branches,
    agents,
  };

  for (const slotItem of slotItems) {
    const branch = branchesBySlot.get(slotItem.slotIndex);
    const agent = agentsBySlot.get(slotItem.slotIndex);
    const merged = options.statusOverrides?.[slotItem.itemId] === 'completed' || branch?.merged === true;
    const entry: ReconciledSlotItem = {
      ...slotItem,
      status: merged ? 'merged' : agent || branch ? 'in_flight' : 'pending',
      branch: branch?.branch,
      agentId: agent?.agentId,
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
      const match = pattern.exec(agent.id);
      if (!match) return null;
      return {
        slotIndex: Number(match[1]),
        agentId: agent.id,
        status: agent.status,
      };
    })
    .filter((agent): agent is ReconciledSlotAgent => agent !== null)
    .sort((a, b) => a.slotIndex - b.slotIndex);
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

function slotIndexFromBranch(issueLower: string, branch: string): number | null {
  const match = new RegExp(`^feature/${escapeRegExp(issueLower)}-slot-(\\d+)$`).exec(branch);
  if (!match) return null;
  return Number(match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
