import type { AgentState } from '../agents/agent-state.js';
import { readItemStatuses } from '../xbrief/continue-state.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import type { XBriefDocument } from '../xbrief/types.js';
import { readSwarmSlotAssignments, type SwarmSlotAssignment } from './deacon-swarm-record.js';

type SwarmSlotAgent = Pick<AgentState, 'id' | 'issueId' | 'role' | 'workspace' | 'slotIndex' | 'slotItemId'>;
type PlanReader = (workspacePath: string) => XBriefDocument | null;
type AssignmentReader = (workspacePath: string, issueId: string) => SwarmSlotAssignment[];
type ItemStatusReader = (planHome: string, issueId: string) => Record<string, string>;

/** A registered slot must not run after its assigned item reaches a terminal state. */
export function isTerminalSwarmSlotAgent(
  agent: SwarmSlotAgent,
  readPlan: PlanReader = readWorkspacePlanSync,
  readAssignments: AssignmentReader = readSwarmSlotAssignments,
  readStatuses: ItemStatusReader = readItemStatuses,
): boolean {
  if (agent.role !== 'work' || !agent.workspace) return false;
  const idMatch = /-slot-(\d+)$/.exec(agent.id);
  const slotIndex = agent.slotIndex ?? (idMatch ? Number(idMatch[1]) : undefined);
  if (!slotIndex) return false;

  const baseWorkspace = agent.workspace.replace(/-slot-\d+$/, '');
  const assignment = readAssignments(baseWorkspace, agent.issueId)
    .find(candidate => candidate.slotIndex === slotIndex);
  const itemId = agent.slotItemId ?? assignment?.itemId;
  if (!itemId) return false;

  // PAN-3917: item done-ness lives in the issue's continue file, the one home
  // for xBRIEF item progress. The immutable workspace plan can still say
  // `running` after the member-repo branch merged, so the continue file's
  // status wins when the two disagree.
  const itemStatus = readStatuses(baseWorkspace, agent.issueId)[itemId];
  if (itemStatus === 'completed' || itemStatus === 'cancelled') return true;

  const plan = readPlan(baseWorkspace) ?? readPlan(agent.workspace);
  const item = plan?.plan.items.find(candidate => candidate.id === itemId);
  return item?.status === 'completed' || item?.status === 'cancelled';
}
