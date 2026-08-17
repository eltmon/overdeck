import type { AgentState } from '../agents/agent-state.js';
import { readIssueRecordForWorkspaceSync, type PanIssueRecord } from '../pan-dir/record.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import type { XBriefDocument } from '../xbrief/types.js';

type SwarmSlotAgent = Pick<AgentState, 'id' | 'issueId' | 'role' | 'workspace' | 'slotIndex' | 'slotItemId'>;
type PlanReader = (workspacePath: string) => XBriefDocument | null;
type RecordReader = (workspacePath: string, issueId: string) => PanIssueRecord | null;

/** A registered slot must not run after its assigned item reaches a terminal state. */
export function isTerminalSwarmSlotAgent(
  agent: SwarmSlotAgent,
  readPlan: PlanReader = readWorkspacePlanSync,
  readRecord: RecordReader = readIssueRecordForWorkspaceSync,
): boolean {
  if (agent.role !== 'work' || !agent.workspace) return false;
  const idMatch = /-slot-(\d+)$/.exec(agent.id);
  const slotIndex = agent.slotIndex ?? (idMatch ? Number(idMatch[1]) : undefined);
  if (!slotIndex) return false;

  const baseWorkspace = agent.workspace.replace(/-slot-\d+$/, '');
  const record = readRecord(baseWorkspace, agent.issueId);
  const assignment = record?.swarm?.slotAssignments
    ?.find(candidate => candidate.slotIndex === slotIndex);
  const itemId = agent.slotItemId ?? assignment?.itemId;
  if (!itemId) return false;

  // Swarm task transitions are persisted through the issue record's write
  // door. The immutable workspace plan can still say `running` after the
  // member-repo branch has merged, so recovery must honor the canonical
  // override before it considers reviving stale slot ownership.
  const canonicalStatus = record?.statusOverrides?.[itemId];
  if (canonicalStatus === 'completed' || canonicalStatus === 'cancelled') return true;

  const plan = readPlan(baseWorkspace) ?? readPlan(agent.workspace);
  const item = plan?.plan.items.find(candidate => candidate.id === itemId);
  return item?.status === 'completed' || item?.status === 'cancelled';
}
