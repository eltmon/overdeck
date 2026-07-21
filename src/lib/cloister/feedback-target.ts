import { Effect } from 'effect';

import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { readIssueRecordSync, type PanIssueRecord } from '../pan-dir/record.js';
import { updateIssueRecord } from '../pan-dir/record-update.js';
import { listSessionNames, sessionExists } from '../tmux.js';

export type IssueFeedbackTarget =
  | { agentId: string }
  | { needsYou: true; reason: string };

export interface ResolveIssueFeedbackTargetOptions {
  itemId?: string;
  /** Test hook — replaces the default resurrection attempt for non-live targets. */
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
      await updateIssueRecord(project, normalizedIssue, (current) => selfHealSlotAssignment(current, fallback.agentId, fallback.slotIndex, requestedItemId));
      return { agentId: fallback.agentId };
    }
  }

  // PAN-2209 + PAN-2461 — resurrection-first delivery (operator directive 2026-07-11):
  // feedback with no live target is NOT an operator problem until resurrection has been
  // tried. The verification gate pausing the only delivery target (PAN-2461), a
  // governor/scheduler yield, a crash, or a plain stopped work agent after a BLOCKED
  // verdict (PAN-2209) must all self-heal by bringing the agent back and delivering.
  // Operator pauses are the one gate never overridden. Escalating to a human (or any
  // mailbox-style deferred delivery, PAN-2255) is strictly the last resort after
  // resurrection of every candidate has failed.
  const revive = opts.revivePipelinePausedAgent ?? resurrectAgentForFeedback;
  const candidates: string[] = [wholeIssueAgentId];
  if (requestedItemId) {
    const assigned = assignments.find(a => a.itemId === requestedItemId);
    if (assigned) candidates.push(slotAgentId(normalizedIssue, assigned.slotIndex, assigned.agentId));
  }
  for (const assignment of assignments) {
    candidates.push(slotAgentId(normalizedIssue, assignment.slotIndex, assignment.agentId));
  }
  const attempted = new Set<string>();
  for (const candidate of candidates) {
    if (attempted.has(candidate)) continue;
    attempted.add(candidate);
    if (await revive(candidate, normalizedIssue)) return { agentId: candidate };
  }

  const suffix = requestedItemId ? ` for item ${requestedItemId}` : '';
  return {
    needsYou: true,
    reason: `No live feedback target for ${normalizedIssue}${suffix}: ${wholeIssueAgentId} is not running, no assigned swarm slot has a live tmux session, and resurrection of ${attempted.size} candidate agent(s) failed.`,
  };
}

/**
 * PAN-2209 + PAN-2461: bring a non-running agent back to life so feedback can be
 * delivered to it. Returns true when the agent is live again. Gate handling:
 *
 * - Pipeline pauses (`needs-you:*`, `[governor-slot]*`, scheduler yields) → unpause +
 *   resume. A gate the pipeline set must never deadlock the pipeline's own delivery
 *   (PAN-2461); the operator explicitly prefers briefly exceeding memory targets over
 *   undelivered work↔review feedback.
 * - Troubled / failure-backoff → clear the gate loudly and attempt ONE resume. The
 *   failure-tracking machinery re-trips the gate if the agent crashes again, so this
 *   cannot loop unboundedly.
 * - Plain stopped/completed/crashed → resume.
 * - OPERATOR pauses (pan pause, any non-pipeline pausedReason) are never overridden.
 */
async function resurrectAgentForFeedback(agentId: string, issueId: string): Promise<boolean> {
  try {
    const { getAgentStateSync, clearAgentPausedSync, clearAgentTroubledSync } = await import('../agents/agent-state.js');
    const state = getAgentStateSync(agentId);
    if (!state) return false;

    if (state.paused === true) {
      const reason = state.pausedReason ?? '';
      const pipelinePause = reason.startsWith('needs-you:')
        || reason.startsWith('[governor-slot]')
        || state.yieldedByScheduler === true;
      if (!pipelinePause) {
        console.log(`[feedback-target] ${agentId} is operator-paused (${reason || 'no reason'}) — not overriding to deliver ${issueId} feedback`);
        return false;
      }
      console.log(`[feedback-target] ${agentId} is pipeline-paused (${reason || 'scheduler yield'}) — unpausing to deliver feedback for ${issueId}`);
      clearAgentPausedSync(agentId);
    }

    if (state.troubled === true || (state.consecutiveFailures ?? 0) > 0) {
      console.warn(
        `[feedback-target] ${agentId} is gated (troubled=${state.troubled === true}, ` +
        `failures=${state.consecutiveFailures ?? 0}) — clearing for one resurrection attempt to ` +
        `deliver ${issueId} feedback; failure tracking re-trips the gate on another crash`,
      );
      clearAgentTroubledSync(agentId);
    }

    const { resumeAgent } = await import('../agents/resume.js');
    const result = await resumeAgent(agentId);
    if (!result.success) {
      console.warn(`[feedback-target] Failed to resurrect ${agentId} for ${issueId} feedback: ${result.error}`);
      return false;
    }
    return isLiveSession(agentId);
  } catch (err) {
    console.warn(`[feedback-target] resurrectAgentForFeedback(${agentId}) failed: ${err instanceof Error ? err.message : String(err)}`);
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
