import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';

import { readFeedbackAgentStates } from '../agents/agent-state-source.js';
import { getReadableWorkspacePanPaths } from '../pan-dir/continue.js';
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

function isWorkFeedbackTarget(role: string): boolean {
  return role === 'work';
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

  const registeredAgents = readFeedbackAgentStates();
  if (registeredAgents) {
    for (const agent of registeredAgents) {
      if (agent.issueId.toUpperCase() !== normalizedIssue) continue;
      if (!isWorkFeedbackTarget(agent.role)) continue;
      if (await isLiveSession(agent.id)) return { agentId: agent.id };
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
  const workspacePath = resolved
    ? join(resolved.projectPath, 'workspaces', `feature-${issueLower}`)
    : undefined;
  const revive = opts.revivePipelinePausedAgent
    ?? ((agentId, reviveIssueId) => resurrectAgentForFeedback(agentId, reviveIssueId, workspacePath));
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
 * - Plain stopped/completed/crashed → resume, then canonical start if resume fails.
 * - Missing registry row + healthy workspace continue state → canonical start.
 * - OPERATOR pauses (pan pause, any non-pipeline pausedReason) are never overridden.
 */
async function startAgentForFeedback(
  agentId: string,
  issueId: string,
  workspacePath: string | undefined,
): Promise<boolean> {
  if (agentId !== `agent-${issueId.toLowerCase()}`) return false;
  if (!workspacePath) {
    console.warn(`[feedback-target] Cannot start ${agentId} for ${issueId} feedback: no configured project workspace`);
    return false;
  }

  const continuePath = getReadableWorkspacePanPaths(workspacePath).continuePath;
  if (!existsSync(workspacePath) || !existsSync(continuePath)) {
    console.warn(
      `[feedback-target] Cannot start ${agentId} for ${issueId} feedback: ` +
      `workspace=${existsSync(workspacePath) ? 'present' : 'missing'}, continue=${existsSync(continuePath) ? 'present' : 'missing'}`,
    );
    return false;
  }

  console.warn(`[feedback-target] Starting ${agentId} for ${issueId} feedback through the canonical work-agent start path`);
  const { spawnWorkAgentThroughAgentsEndpoint } = await import('./work-agent-start.js');
  const result = await spawnWorkAgentThroughAgentsEndpoint(issueId, undefined, false, 'resume-agent');
  if (!result.spawned) {
    console.warn(
      `[feedback-target] Failed to start ${agentId} for ${issueId} feedback: ` +
      `${result.error ?? result.skippedReason ?? 'unknown start failure'}`,
    );
    return false;
  }

  const live = await isLiveSession(agentId);
  if (!live) {
    console.warn(`[feedback-target] Start path accepted ${agentId} for ${issueId} feedback, but no live tmux session appeared`);
  }
  return live;
}

async function resurrectAgentForFeedback(
  agentId: string,
  issueId: string,
  workspacePath: string | undefined,
): Promise<boolean> {
  try {
    const { getAgentStateSync, clearAgentPausedSync, clearAgentTroubledSync } = await import('../agents/agent-state.js');
    const state = getAgentStateSync(agentId);
    if (!state) {
      console.warn(`[feedback-target] Cannot resume ${agentId} for ${issueId} feedback: agent registry row is missing; trying the start path`);
      return startAgentForFeedback(agentId, issueId, workspacePath);
    }

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
      console.warn(`[feedback-target] Failed to resume ${agentId} for ${issueId} feedback: ${result.error}; trying the start path`);
      return startAgentForFeedback(agentId, issueId, workspacePath);
    }
    if (await isLiveSession(agentId)) return true;

    console.warn(`[feedback-target] Resume reported success for ${agentId}, but no live tmux session appeared; trying the start path`);
    return startAgentForFeedback(agentId, issueId, workspacePath);
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
    const { markWorkspaceStuck, FEEDBACK_DELIVERY_STUCK_REASON } = await import('../review-status.js');
    // PAN-3511: consult evidence from the host-recorded active review run
    // before mutating the row. A workspace artifact never authorizes a terminal
    // verdict; the canonical review done signal owns that transition, so a
    // delivery failure still receives its protective stuck mark.
    try {
      const [{ getAgentStateSync }, { readLatestSynthesisVerdictAsync }] = await Promise.all([
        import('../agents/agent-state.js'),
        import('./synthesis-verdict.js'),
      ]);
      const state = getAgentStateSync(`agent-${issueId.toLowerCase()}-review`);
      const artifact = await readLatestSynthesisVerdictAsync(issueId, {
        runId: state?.reviewRunId,
        workspacePath: state?.workspace,
      });
      if (artifact) console.warn(`[feedback-target] ${issueId}: found fresh ${artifact.verdict} artifact for the active run; awaiting canonical review signal. ${reason}`);
    } catch (err) {
      console.warn(`[feedback-target] Artifact consult failed for ${issueId}: ${err instanceof Error ? err.message : String(err)}; proceeding with the stuck mark`);
    }
    markWorkspaceStuck(issueId, FEEDBACK_DELIVERY_STUCK_REASON, {
      reason,
      ...details,
    });
  } catch (err) {
    console.warn(`[feedback-target] Failed to mark ${issueId} as needing human attention: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.warn(`[feedback-target] ${reason}`);
}
