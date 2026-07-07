import { Effect } from 'effect';

import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { readIssueRecordSync, writeIssueRecordSync, type PanIssueRecord } from '../pan-dir/record.js';
import { listSessionNames, sessionExists } from '../tmux.js';

export type IssueFeedbackTarget =
  | { agentId: string }
  | { needsYou: true; reason: string };

export interface ResolveIssueFeedbackTargetOptions {
  itemId?: string;
  revivePipelinePausedAgent?: (agentId: string, issueId: string) => Promise<boolean>;
}

async function isLiveSession(agentId: string): Promise<boolean> {
  return Effect.runPromise(sessionExists(agentId));
}

function slotAgentId(issueId: string, slotIndex: number, assignedAgentId?: string): string {
  return assignedAgentId ?? `agent-${issueId.toLowerCase()}-slot-${slotIndex}`;
}

async function findLiveUnregisteredSlot(issueId: string): Promise<{ agentId: string; slotIndex: number } | null> {
  const prefix = `agent-${issueId.toLowerCase()}-slot-`;
  const sessions = await Effect.runPromise(listSessionNames());
  for (const session of sessions) {
    if (!session.startsWith(prefix)) continue;
    const slotIndex = Number.parseInt(session.slice(prefix.length), 10);
    if (!Number.isInteger(slotIndex) || slotIndex < 1) continue;
    if (await isLiveSession(session)) return { agentId: session, slotIndex };
  }
  return null;
}

function selfHealSlotAssignment(record: PanIssueRecord, agentId: string, slotIndex: number, itemId?: string): PanIssueRecord {
  const assignments = record.swarm?.slotAssignments ?? [];
  const existing = assignments.find((assignment) => assignment.slotIndex === slotIndex || assignment.agentId === agentId);
  const assignedAt = new Date().toISOString();
  const slotAssignments = existing
    ? assignments.map((assignment) => assignment === existing
      ? { ...assignment, agentId, itemId: itemId ?? assignment.itemId, assignedAt: assignment.assignedAt ?? assignedAt }
      : assignment)
    : [
      ...assignments,
      {
        slotIndex,
        itemId: itemId ?? `slot-${slotIndex}`,
        agentId,
        assignedAt,
      },
    ];

  return {
    ...record,
    swarm: {
      ...record.swarm,
      slotAssignments,
    },
  };
}

export async function resolveIssueFeedbackTarget(
  issueId: string,
  opts: ResolveIssueFeedbackTargetOptions = {},
): Promise<IssueFeedbackTarget> {
  const normalizedIssue = issueId.toUpperCase();
  const issueLower = normalizedIssue.toLowerCase();
  const wholeIssueAgentId = `agent-${issueLower}`;

  if (await isLiveSession(wholeIssueAgentId)) {
    return { agentId: wholeIssueAgentId };
  }

  const resolved = resolveProjectFromIssueSync(normalizedIssue);
  const project = resolved ? getProjectSync(resolved.projectKey) : null;
  const record = project ? readIssueRecordSync(project, normalizedIssue) : null;
  const assignments = record?.swarm?.slotAssignments ?? [];

  const requestedItemId = opts.itemId?.trim();
  if (requestedItemId) {
    const assigned = assignments.find(a => a.itemId === requestedItemId);
    if (assigned) {
      const agentId = slotAgentId(normalizedIssue, assigned.slotIndex, assigned.agentId);
      if (await isLiveSession(agentId)) return { agentId };
    }
  }

  for (const assignment of assignments) {
    const agentId = slotAgentId(normalizedIssue, assignment.slotIndex, assignment.agentId);
    if (await isLiveSession(agentId)) return { agentId };
  }

  if (project && record) {
    const fallback = await findLiveUnregisteredSlot(normalizedIssue);
    if (fallback) {
      writeIssueRecordSync(project, normalizedIssue, selfHealSlotAssignment(record, fallback.agentId, fallback.slotIndex, requestedItemId));
      return { agentId: fallback.agentId };
    }
  }

  // PAN-2461: the verification gate pauses the work agent with a "needs-you:" reason,
  // and later specialists then find "no live feedback target" — a deadlock the gate
  // itself created (11 issues in 24h). A pipeline-set needs-you pause is the
  // pipeline's to clear when it has actionable feedback to deliver: unpause and
  // resume the whole-issue agent so the feedback lands. Operator pauses (pan pause,
  // any non-"needs-you:" reason) are never touched.
  const revive = opts.revivePipelinePausedAgent ?? revivePipelinePausedAgent;
  const revived = await revive(wholeIssueAgentId, normalizedIssue);
  if (revived) return { agentId: wholeIssueAgentId };

  const suffix = requestedItemId ? ` for item ${requestedItemId}` : '';
  return {
    needsYou: true,
    reason: `No live feedback target for ${normalizedIssue}${suffix}: ${wholeIssueAgentId} is not running and no assigned swarm slot has a live tmux session.`,
  };
}

/**
 * PAN-2461: unpause + resume an agent that the PIPELINE paused (pausedReason
 * starts with "needs-you:") so feedback can be delivered to it. Returns true
 * when the agent is live again. Operator pauses are left untouched.
 */
async function revivePipelinePausedAgent(agentId: string, issueId: string): Promise<boolean> {
  try {
    const { getAgentStateSync, clearAgentPausedSync } = await import('../agents/agent-state.js');
    const state = getAgentStateSync(agentId);
    if (!state) return false;
    if (state.paused !== true || !state.pausedReason?.startsWith('needs-you:')) return false;

    console.log(`[feedback-target] ${agentId} is pipeline-paused (${state.pausedReason}) — unpausing to deliver feedback for ${issueId}`);
    clearAgentPausedSync(agentId);
    const { resumeAgent } = await import('../agents/resume.js');
    const result = await resumeAgent(agentId);
    if (!result.success) {
      console.warn(`[feedback-target] Failed to revive ${agentId}: ${result.error}`);
      return false;
    }
    return isLiveSession(agentId);
  } catch (err) {
    console.warn(`[feedback-target] revivePipelinePausedAgent(${agentId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function surfaceIssueFeedbackNeedsYou(
  issueId: string,
  reason: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { markWorkspaceStuck } = await import('../review-status.js');
    markWorkspaceStuck(issueId, 'feedback_delivery_needs_you', {
      reason,
      ...details,
    });
  } catch (err) {
    console.warn(`[feedback-target] Failed to mark ${issueId} as needing human attention: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.warn(`[feedback-target] ${reason}`);
}
