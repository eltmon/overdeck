/**
 * Work-start state (PAN-4399): whether a post-planning auto-start actually
 * produced a running work agent, derived from the workspace's pipeline
 * journal rather than stored anywhere.
 *
 * `completePlanningForIssue` and `retryDeferredHandoffs` (`cloister/
 * deferred-handoff.js`) already journal the whole story — `handoff.deferred`,
 * `handoff.retried`, `handoff.started`, `handoff.abandoned` — but nothing
 * before this module turned that into a read the dashboard could render. A
 * refused auto-spawn that later gave up, or one that was accepted but whose
 * `pan start` never actually produced a live pane, left the issue looking
 * like ordinary `working` with no signal that anything needed the operator.
 */
import { getAgentState } from '../agents/agent-state-read.js';
import { lastPipelineEntry } from '../cloister/pipeline-journal.js';
import { getWorkspaceForIssue } from '../workspaces/resolver.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import type { DerivedWorkStart } from '@overdeck/contracts';

/** How long an accepted `handoff.started` may go without a live work agent before it reads as not-started. */
export const WORK_START_GRACE_MS = 10 * 60_000;

/** The one journal read `deriveWorkStart` needs, plus the work agent's own start time. */
export interface WorkStartFacts {
  readonly lastHandoff: { readonly type: string; readonly at: string; readonly data?: Record<string, unknown> } | null;
  /** `Date.parse` of `agent-<issue>`'s `startedAt`, or null when the agent has no recorded state. */
  readonly workAgentStartedAt: number | null;
}

/** Reads the workspace journal and agent state a derivation needs. Never throws. */
export function readWorkStartFacts(issueId: string, projectPath: string): WorkStartFacts | null {
  try {
    const upper = issueId.toUpperCase();
    const workspacePath = getWorkspaceForIssue(upper)?.path
      ?? join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    if (!existsSync(workspacePath)) return null;

    const entry = lastPipelineEntry(workspacePath, 'handoff.');
    if (!entry) return null;

    const startedAt = getAgentState(`agent-${issueId.toLowerCase()}`)?.startedAt;
    const workAgentStartedAt = startedAt ? Date.parse(startedAt) : NaN;

    return {
      lastHandoff: { type: entry.type, at: entry.at, ...(entry.data ? { data: entry.data } : {}) },
      workAgentStartedAt: Number.isNaN(workAgentStartedAt) ? null : workAgentStartedAt,
    };
  } catch {
    return null;
  }
}

/** Pure: the last handoff journal entry, plus whether the work agent started after it, → what to render. */
export function deriveWorkStart(facts: WorkStartFacts, now: number): DerivedWorkStart | undefined {
  const { lastHandoff, workAgentStartedAt } = facts;
  if (!lastHandoff) return undefined;

  const at = Date.parse(lastHandoff.at);
  const data = lastHandoff.data ?? {};
  // PAN-4399 review fix: for an accepted handoff, `pan start` writes the work
  // agent's own startedAt BEFORE the spawn route answers, and this entry is
  // journaled only after that — so comparing a real start against `at` always
  // reads "started after the hand-off" as false. `requestedAt`, stamped
  // before the spawn call, is the correct anchor for that comparison; other
  // handoff types have no such field and fall back to the entry's own `at`.
  const requestedAt = typeof data['requestedAt'] === 'string' ? Date.parse(data['requestedAt']) : NaN;
  const startedAfterAt = lastHandoff.type === 'handoff.started' && !Number.isNaN(requestedAt) ? requestedAt : at;
  if (workAgentStartedAt !== null && workAgentStartedAt >= startedAfterAt) return undefined;

  const error = typeof data['error'] === 'string' ? data['error'] : undefined;
  const nextRetryAt = typeof data['nextRetryAt'] === 'string' ? data['nextRetryAt'] : undefined;
  // PAN-4210: a deferral recorded (or left standing) while the Deacon is
  // frozen is journaled but never actually retried until it thaws.
  const held = data['deaconPaused'] === true ? { held: true as const } : {};

  if (lastHandoff.type === 'handoff.deferred' || lastHandoff.type === 'handoff.retried') {
    return { status: 'retrying', at: lastHandoff.at, ...(error ? { error } : {}), ...(nextRetryAt ? { nextRetryAt } : {}), ...held };
  }
  if (lastHandoff.type === 'handoff.abandoned' && data['outcome'] === 'gave-up') {
    return { status: 'not-started', at: lastHandoff.at, ...(error ? { error } : {}) };
  }
  if (lastHandoff.type === 'handoff.started' && now - at > WORK_START_GRACE_MS) {
    return {
      status: 'not-started',
      at: lastHandoff.at,
      error: `The work agent was accepted but never started${data['queued'] ? ' (container startup did not finish)' : ''}`,
    };
  }
  return undefined;
}
