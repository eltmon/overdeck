/**
 * PAN-3092: sweep stranded workspace verdict fallbacks.
 *
 * The fallback drain is scheduled by the process that wrote the fallback, on
 * unref'd timers. In a short-lived CLI (`pan admin specialists done` exits in
 * under a second) those timers never fire, so a verdict that failed its journal
 * write under lock contention can sit in `<workspace>/.overdeck/pipeline-verdict.json`
 * with nothing left alive to fold it. This patrol is the external retry the CLI
 * cannot provide.
 *
 * It also surfaces the case the retry cannot fix: a fallback still undrained ten
 * minutes on means the record lock has been held that long, and the operator
 * should hear about it once — MIN-902 spent an hour in exactly that state while
 * every surface reported the reviewer healthy.
 */

import { loadReviewStatuses } from '../review-status.js';
import {
  drainWorkspaceVerdictFallback,
  readWorkspaceVerdictFallback,
} from '../overdeck/review-status-record-sync.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';
import { readOwner, recordLockPath } from '../pan-dir/fs-lock.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { recordRecoveryFailure } from './recovery-trip.js';
import { emitActivityEntrySync } from '../activity-logger.js';

/** How long a fallback may stay undrained before the operator hears about it. */
export const VERDICT_CONTENTION_SURFACE_MS = 10 * 60 * 1000;

/**
 * Contention episodes already warned about, keyed by issue + the fallback's own
 * `updatedAt`. This dedupe is deliberately in-process and lock-free: the thing
 * being reported IS contention on the per-issue record lock, so the immediate
 * operator signal must not depend on taking that lock. The durable
 * recovery-trip record is the cross-restart dedupe; this map only stops one
 * long-running server from warning on every patrol cycle.
 */
const warnedContentionEpisodes = new Set<string>();

async function lockOwnerDescription(issueId: string): Promise<string> {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return 'unknown writer';
    const project = getProjectSync(resolved.projectKey);
    if (!project) return 'unknown writer';
    return (await readOwner(recordLockPath(project, issueId))).description;
  } catch {
    return 'unknown writer';
  }
}

/**
 * Drain every pending workspace verdict fallback, and surface the ones that stay
 * stuck. Returns one action line per drain or escalation, for the patrol log.
 */
export async function sweepStrandedVerdictFallbacks(now = Date.now()): Promise<string[]> {
  const actions: string[] = [];
  let statuses: Record<string, { mergeStatus?: string; closedOut?: boolean; stuck?: boolean; deaconIgnored?: boolean }>;
  try {
    statuses = loadReviewStatuses();
  } catch {
    return actions;
  }

  for (const [issueId, status] of Object.entries(statuses)) {
    // A merged or closed-out issue's fallback is history, not a pending verdict.
    if (status.mergeStatus === 'merged' || status.closedOut) continue;

    try {
      const fallback = await readWorkspaceVerdictFallback(issueId);
      if (!fallback) continue;

      if (await drainWorkspaceVerdictFallback(issueId)) {
        actions.push(`Drained stranded verdict fallback for ${issueId}`);
        continue;
      }

      const ageMs = now - Date.parse(fallback.updatedAt);
      if (!Number.isFinite(ageMs) || ageMs < VERDICT_CONTENTION_SURFACE_MS) continue;
      // A stuck or deacon-ignored issue is already an operator's problem; drain
      // it, but do not add a second voice on top of the one they already have.
      if (status.stuck || status.deaconIgnored) continue;

      const resolved = resolveProjectFromIssueSync(issueId);
      const workspacePath = resolved
        ? findWorkspacePath(resolved.projectPath, issueId.toLowerCase())
        : null;
      if (!workspacePath) continue;

      const ageMinutes = Math.round(ageMs / 60_000);
      const owner = await lockOwnerDescription(issueId);
      const episode = `${issueId}:${fallback.updatedAt}`;

      // The activity warning goes out FIRST and never touches the record lock.
      // Ordering it after the recovery-trip write would put the only immediate
      // operator signal behind the very lock whose contention it is reporting —
      // so a genuine >10min episode could produce no signal at all.
      if (!warnedContentionEpisodes.has(episode)) {
        warnedContentionEpisodes.add(episode);
        emitActivityEntrySync({
          source: 'cloister',
          level: 'warn',
          issueId,
          message:
            `${issueId} — verdict fallback undrained for ${ageMinutes}min; the per-issue record lock is `
            + `contended (current owner: ${owner}). The verdict is durable in the workspace fallback and `
            + `folds automatically once the lock frees.`,
        });
        actions.push(`${issueId}: verdict contended ${ageMinutes}min (lock owner: ${owner})`);
      }

      // The durable trip is best-effort and retried on later patrols: it writes
      // through the contended lock, so a failure here is expected during the
      // episode and must never suppress the warning above.
      try {
        const { emitNeedsYou } = await recordRecoveryFailure(
          workspacePath, issueId, 'verdict-fallback-contention', fallback.updatedAt, 1,
        );
        if (emitNeedsYou) {
          actions.push(`needs-you ${issueId}: verdict contended ${ageMinutes}min (lock owner: ${owner})`);
        }
      } catch {
        actions.push(
          `${issueId}: verdict-contention needs-you trip could not be recorded (record lock contended) — retrying next patrol`,
        );
      }
    } catch {
      // A single unreadable workspace must never stop the sweep.
    }
  }

  return actions;
}
