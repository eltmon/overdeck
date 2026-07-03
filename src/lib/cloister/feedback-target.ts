import { Effect } from 'effect';

import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { readIssueRecordSync, writeIssueRecordSync, type PanIssueRecord } from '../pan-dir/record.js';
import { markWorkspaceStuck } from '../review-status.js';
import { listSessionNames, sessionExists } from '../tmux.js';

export type IssueFeedbackTarget =
  | { agentId: string }
  | { needsYou: true; reason: string };

export interface ResolveIssueFeedbackTargetOptions {
  itemId?: string;
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

  const suffix = requestedItemId ? ` for item ${requestedItemId}` : '';
  return {
    needsYou: true,
    reason: `No live feedback target for ${normalizedIssue}${suffix}: ${wholeIssueAgentId} is not running and no assigned swarm slot has a live tmux session.`,
  };
}

export function surfaceIssueFeedbackNeedsYou(
  issueId: string,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  try {
    markWorkspaceStuck(issueId, 'feedback_delivery_needs_you', {
      reason,
      ...details,
    });
  } catch (err) {
    console.warn(`[feedback-target] Failed to mark ${issueId} as needing human attention: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.warn(`[feedback-target] ${reason}`);
}
