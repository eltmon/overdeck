/**
 * The pipeline-journal side of the planning auto-start hand-off, split out of
 * `planning-promotion.ts` (PAN-5498). complete-planning journals the request
 * before it sends the spawn, then a deferral, a start or a plain failure.
 * deacon-lite (`cloister/deferred-handoff.ts`) retries whatever is left pending.
 */
import { existsSync } from 'node:fs';

import { emitActivityEntry } from '../activity-logger.js';
import { recordHandoffDeferred, recordHandoffRequested, type DeferredHandoffReason } from '../cloister/deferred-handoff.js';
import { appendPipelineEntry } from '../cloister/pipeline-journal.js';
import { isDeaconGloballyPaused } from './control-settings.js';

export interface CompletePlanningAutoSpawnResult {
  workAgentSpawned: boolean;
  workAgentQueued?: boolean;
  workAgentSession?: string;
  workAgentError?: string;
  workAgentSkipReason?: 'stack-unhealthy' | 'guardrails' | 'paused' | 'troubled' | 'unauthorized' | 'spawn-failed';
  /**
   * PAN-4155: a spawn guardrail refused the start (the response carried a
   * guardrail decision). Deacon-lite retries it later, so the hand-off is
   * deferred, not failed. Other 409s (start gate, dirty tree) stay failures.
   */
  workAgentDeferred?: boolean;
  workAgentHttpStatus?: number;
  /** PAN-4399: stamped before the `/api/agents` POST, since `pan start` writes its own `startedAt` before the route answers. */
  workAgentRequestedAt?: string;
}

/**
 * PAN-5498: journal `handoff.requested` before the spawn POST. If the
 * dashboard dies while the request runs (a slow stack rebuild, then a
 * restart), it stays the last handoff entry and deacon-lite resumes the start.
 * Returns whether the entry was written. Never throws.
 */
export function journalHandoffRequest(workspacePath: string | null | undefined, issueId: string): boolean {
  if (!workspacePath || !existsSync(workspacePath)) return false;
  try {
    recordHandoffRequested({ workspacePath, issueId });
    return true;
  } catch (error) {
    console.warn(`[complete-planning] Could not journal the ${issueId} hand-off request: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * PAN-5498: close a journaled request that failed in a way no wait fixes, so
 * deacon-lite does not retry it. Only guardrail and stack refusals are retried.
 */
export function journalHandoffFailed(workspacePath: string, issueId: string, skipReason: string, error: string): void {
  appendPipelineEntry(workspacePath, {
    type: 'handoff.abandoned',
    issueId: issueId.toUpperCase(),
    source: 'complete-planning',
    data: { outcome: 'failed', skipReason, error },
  });
}

/** Default `readDeaconPaused`: the retry hold is advisory, so an unreadable pause flag reads as unpaused. */
function defaultReadDeaconPaused(): boolean {
  try {
    return isDeaconGloballyPaused();
  } catch {
    return false;
  }
}

/**
 * PAN-4155: a guardrail or an unhealthy workspace Docker stack refused the
 * hand-off. Journal the deferral in the workspace so deacon-lite retries the
 * spawn without acknowledgement, and say so at warn level. No
 * `planning.failed`: that is recorded only if the retries give up.
 *
 * PAN-4210: deacon-lite's retry only ever runs from `runDeaconLite()`, which
 * returns immediately while the Deacon is globally frozen — so a deferral
 * recorded during a freeze is journaled but silently never retried. Say so.
 */
export function recordPlanningAutoHandoffDeferred(options: {
  issueId: string;
  workspacePath: string;
  result: CompletePlanningAutoSpawnResult;
  emitActivity?: typeof emitActivityEntry;
  readDeaconPaused?: () => boolean;
}): { error: string; deaconPaused: boolean } {
  const reason: DeferredHandoffReason = options.result.workAgentSkipReason === 'stack-unhealthy' ? 'stack-unhealthy' : 'guardrails';
  const cause = reason === 'stack-unhealthy' ? 'the workspace docker stack is unhealthy' : 'spawn guardrails';
  const error = options.result.workAgentError ?? `Work agent startup refused by ${cause}`;
  const deaconPaused = (options.readDeaconPaused ?? defaultReadDeaconPaused)();
  recordHandoffDeferred({
    workspacePath: options.workspacePath,
    issueId: options.issueId,
    error,
    reason,
    httpStatus: options.result.workAgentHttpStatus,
    deaconPaused,
  });
  console.warn(`[complete-planning] ${options.issueId} auto-handoff deferred by ${cause}: ${error}`);
  (options.emitActivity ?? emitActivityEntry)({
    source: 'plan',
    level: 'warn',
    message: deaconPaused
      ? `${options.issueId} planning complete; work-agent start deferred by ${cause}. The retry is held while the Deacon is frozen: unfreeze it, or run pan start ${options.issueId}. ${error}`
      : `${options.issueId} planning complete; work-agent start deferred by ${cause} and retried for up to 2 hours: ${error}`,
    issueId: options.issueId,
    details: JSON.stringify({ workAgentSkipReason: reason, workAgentError: error }),
  });
  return { error, deaconPaused };
}
