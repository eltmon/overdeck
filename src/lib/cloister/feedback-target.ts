import { Effect } from 'effect';

import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { readIssueRecordSync } from '../pan-dir/record.js';
import { markWorkspaceStuck } from '../review-status.js';
import { sessionExists } from '../tmux.js';

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
  const assignments = project
    ? readIssueRecordSync(project, normalizedIssue)?.swarm?.slotAssignments ?? []
    : [];

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
  markWorkspaceStuck(issueId, 'feedback_delivery_needs_you', {
    reason,
    ...details,
  });
  console.warn(`[feedback-target] ${reason}`);
}
