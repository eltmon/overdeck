import { Effect } from 'effect';

import { logDeaconEventSync } from '../persistent-logger.js';
import { loadReviewStatuses, setReviewStatusSync } from '../review-status.js';
import { killSession, sessionExists } from '../tmux.js';

/**
 * Inspect prompts state a 10-minute budget. Deacon gives the agent a small
 * grace window beyond that, then fails loud so the parent work agent never waits
 * forever for a verdict that will not arrive.
 */
export const INSPECT_TIMEOUT_MS = 12 * 60_000;

function inspectSessionName(issueId: string, beadId: string): string {
  const issueLower = issueId.toLowerCase();
  const beadSlug = beadId.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 24);
  return `inspect-${issueLower}-${beadSlug}`;
}

function formatInspectElapsed(elapsedMs: number): string {
  return `${Math.max(0, Math.round(elapsedMs / 60_000))}m`;
}

export async function checkInspectAgentTimeouts(now = new Date()): Promise<string[]> {
  const actions: string[] = [];
  const statuses = loadReviewStatuses();
  const nowMs = now.getTime();

  for (const [rawIssueId, status] of Object.entries(statuses)) {
    if (status.inspectStatus !== 'inspecting') continue;

    const issueId = rawIssueId.toUpperCase();
    const beadId = status.inspectBeadId;
    const startedMs = status.inspectStartedAt ? Date.parse(status.inspectStartedAt) : NaN;
    const hasStartedAt = Number.isFinite(startedMs);
    const elapsedMs = hasStartedAt ? nowMs - startedMs : Number.POSITIVE_INFINITY;
    const timedOut = elapsedMs > INSPECT_TIMEOUT_MS;
    const sessionName = beadId ? inspectSessionName(issueId, beadId) : undefined;
    const sessionAlive = sessionName
      ? await Effect.runPromise(sessionExists(sessionName)).catch(() => false)
      : false;
    const crashed = !!sessionName && !sessionAlive;

    if (!timedOut && !crashed) continue;

    const reason = !hasStartedAt
      ? 'missing inspectStartedAt metadata'
      : timedOut
        ? `timed out after ${formatInspectElapsed(elapsedMs)} (limit ${formatInspectElapsed(INSPECT_TIMEOUT_MS)})`
        : `tmux session ${sessionName} exited before producing a verdict`;
    const effectiveBeadId = beadId ?? 'unknown';
    const notes = `Inspection error for bead ${effectiveBeadId}: ${reason}. No verdict was produced.`;
    const verdict = `INSPECTION ERROR for bead ${effectiveBeadId}: inspection could not complete (${reason}) — no verdict was produced. Treat as infrastructure failure: do not silently proceed.`;

    // Mark terminal first so the next patrol cycle skips this inspection even if
    // kill or delivery fails; this is the idempotency guard.
    setReviewStatusSync(issueId, {
      inspectStatus: 'error',
      inspectNotes: notes,
    });

    if (sessionName && sessionAlive) {
      await Effect.runPromise(killSession(sessionName)).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[deacon] Failed to kill inspect session ${sessionName}: ${msg}`);
      });
    }

    try {
      const { messageAgent } = await import('../agents.js');
      await messageAgent(`agent-${issueId.toLowerCase()}`, verdict, 'deacon:inspect-watchdog');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[deacon] Failed to deliver inspect error verdict for ${issueId}: ${msg}`);
    }

    const action = `Inspection watchdog tripped for ${issueId} bead ${effectiveBeadId}: ${reason}`;
    actions.push(action);
    logDeaconEventSync(`checkInspectAgentTimeouts: ${action}`);
  }

  return actions;
}
