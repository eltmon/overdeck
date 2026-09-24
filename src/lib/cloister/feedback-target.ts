import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';

import { readFeedbackAgentStates } from '../agents/agent-state-source.js';
import { getReadableWorkspacePanPaths } from '../pan-dir/continue.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { listSessionNames } from '../tmux.js';
import { readSwarmSlotAssignments } from './deacon-swarm-record.js';
import { isAlive, isConfirmedDead } from '../agents/liveness.js';

export type IssueFeedbackTarget =
  | { agentId: string }
  | { needsYou: true; reason: string };

export interface ResolveIssueFeedbackTargetOptions {
  itemId?: string;
  /**
   * Replaces the default resurrection attempt for non-live targets;
   * `async () => false` disables it (the verification stuck notice, #4019).
   * Also a test hook.
   */
  revivePipelinePausedAgent?: (agentId: string, issueId: string) => Promise<boolean>;
}

// PAN-3849 (W32): liveness is the single oracle, not a bare has-session. A
// remain-on-exit pane whose harness process exited still "exists" as a tmux
// session, and feedback pasted into that dead shell was previously reported
// as delivered (pipeline-reliability-review F12, last bullet).
async function isLiveSession(agentId: string): Promise<boolean> {
  // An indeterminate probe is not death: deliver to the session and let the
  // transport fail naturally rather than resurrecting a possibly-live agent.
  return !isConfirmedDead(await isAlive(agentId));
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

  // PAN-3917: slot assignments live in the issue's own `.pan/continues` slot
  // ledger, read from the feature workspace.
  const resolved = resolveProjectFromIssueSync(normalizedIssue);
  const workspacePath = resolved
    ? join(resolved.projectPath, 'workspaces', `feature-${issueLower}`)
    : undefined;
  const assignments = workspacePath ? readSwarmSlotAssignments(workspacePath, normalizedIssue) : [];

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

  // A live slot session that no ledger entry names is still a delivery target:
  // the pane is the fact. Nothing is written back to make the ledger agree.
  const fallback = await findLiveUnregisteredSlot(normalizedIssue);
  if (fallback) return { agentId: fallback.agentId };

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
    const { getAgentStateSync, clearAgentPaused, clearAgentTroubled } = await import('../agents/agent-state.js');
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
      await Effect.runPromise(clearAgentPaused(agentId));
    }

    if (state.troubled === true || (state.consecutiveFailures ?? 0) > 0) {
      console.warn(
        `[feedback-target] ${agentId} is gated (troubled=${state.troubled === true}, ` +
        `failures=${state.consecutiveFailures ?? 0}) — clearing for one resurrection attempt to ` +
        `deliver ${issueId} feedback; failure tracking re-trips the gate on another crash`,
      );
      await Effect.runPromise(clearAgentTroubled(agentId));
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

/**
 * Report that feedback for an issue has no reachable agent and needs a human.
 *
 * PAN-3917: this used to write a `stuck` flag onto the issue's `review_status`
 * row for the dashboard to read back. The flag is gone; the delivery failure is
 * announced on the activity stream, where the dashboard already listens, and
 * the feedback file the caller wrote remains on disk as the durable artifact.
 */
export async function surfaceIssueFeedbackNeedsYou(
  issueId: string,
  reason: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { emitActivityEntrySync } = await import('../activity-logger.js');
  try {
    emitActivityEntrySync({
      source: 'cloister',
      level: 'warn',
      message: `${issueId} needs you: ${reason}`,
      issueId,
      details: Object.keys(details).length > 0 ? JSON.stringify(details) : undefined,
    });
  } catch (err) {
    console.warn(`[feedback-target] Failed to announce needs-you for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.warn(`[feedback-target] ${reason}`);
}
