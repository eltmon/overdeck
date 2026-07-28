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
  findWorkspaceVerdictConflicts,
  readWorkspaceVerdictFallback,
} from '../overdeck/review-status-record-sync.js';
import type { VerdictConflict } from '../pan-dir/pipeline-verdict-merge.js';
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';
import { readOwner, recordLockPath } from '../pan-dir/fs-lock.js';
import { findWorkspacePath } from '../lifecycle/archive-planning.js';
import { findRecoveryTrip, recordRecoveryFailure } from './recovery-trip.js';
import { emitActivityEntryOnce } from '../activity-logger.js';

/** How long a fallback may stay undrained before the operator hears about it. */
export const VERDICT_CONTENTION_SURFACE_MS = 10 * 60 * 1000;

/**
 * Episodes already warned about in THIS process, keyed by recovery path + issue
 * + the fallback's own `updatedAt`.
 *
 * Only an optimisation, never the dedupe of record: it saves re-querying the
 * event log every patrol. Correctness across restarts comes from the two
 * durable planes — the open recovery trip, and `emitActivityEntryOnce`'s
 * event-log check on the episode id. An episode is added here only after the
 * warning is confirmed durable, so a failed append is retried rather than
 * suppressed, and entries are dropped once the trip lands.
 */
const warnedEpisodes = new Set<string>();

/**
 * Describe a verdict conflict and the one action that reliably clears it.
 *
 * Deliberately does NOT hand out a `pan admin specialists done` command. That
 * command is not a general conflict resolver: `merge` takes passed|failed and
 * maps them to merged|failed (so the displayed `merged` is rejected), `inspect`
 * requires an `--item` this pipeline-level conflict cannot identify, `review`
 * does not accept `skipped`, verification has no specialist at all, and
 * re-signalling the value already in the journal writes no replacement fallback
 * — so the conflicting one survives and every later drain withholds it again.
 * A conflict can also span several gates, which one command cannot settle.
 *
 * A strictly newer review cycle is the only instruction correct for every gate
 * and every choice, so that is what the operator is told, along with what it
 * costs. A dedicated resolve-this-generation operation through the verdict write
 * door would let an operator adopt a specific written verdict instead; until
 * that exists, promising it here would be a lie.
 */
function conflictMessage(issueId: string, conflicts: VerdictConflict[], ageMinutes: number): string {
  const detail = conflicts
    .map((c) => `${c.gate} (the record holds "${c.journalValue}", the workspace fallback holds "${c.fallbackValue}")`)
    .join('; ');
  const gateCount = conflicts.length === 1 ? 'one gate' : `${conflicts.length} gates`;
  return (
    `${issueId} — two different verdicts have been written for ${gateCount} and Overdeck cannot tell which is `
    + `newer, so it refuses to choose: ${detail}. This has been unresolved for ${ageMinutes}min and will NOT `
    + `clear on its own: the fold is withheld on every patrol, by design, so that neither written verdict is `
    + `destroyed. An operator must decide. The one action that reliably clears it for every gate is to dispatch `
    + `a strictly newer review cycle for ${issueId} — that supersedes the stranded fallback and re-runs the `
    + `gates, rather than adopting either of the verdicts already written. Overdeck has no command today that `
    + `adopts one specific written verdict, so do not expect a re-signal of an existing value to clear this.`
  );
}

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
      // Two different failures land here. Contention clears on its own; a
      // verdict conflict never does, because every later drain withholds the
      // same fold. Telling an operator to wait for the second one would be
      // false remediation, so name which it is before saying anything.
      const conflicts = await findWorkspaceVerdictConflicts(issueId, fallback);
      const conflicted = conflicts.length > 0;
      const recoveryPath = conflicted ? 'verdict-fallback-conflict' : 'verdict-fallback-contention';
      const episode = `${recoveryPath}:${issueId}:${fallback.updatedAt}`;

      let message: string;
      let summary: string;
      if (conflicted) {
        message = conflictMessage(issueId, conflicts, ageMinutes);
        summary = `${issueId}: verdict conflict on ${conflicts.map((c) => c.gate).join(', ')} — needs operator adjudication`;
      } else {
        const owner = await lockOwnerDescription(issueId);
        message =
          `${issueId} — verdict fallback undrained for ${ageMinutes}min; the per-issue record lock is `
          + `contended (current owner: ${owner}). The verdict is durable in the workspace fallback and `
          + `folds automatically once the lock frees.`;
        summary = `${issueId}: verdict contended ${ageMinutes}min (lock owner: ${owner})`;
      }

      const openTrip = await findRecoveryTrip(issueId, recoveryPath, fallback.updatedAt);
      if (openTrip?.open === true) {
        // Already durably surfaced. Do NOT call recordRecoveryFailure: its
        // mutator returns the record unchanged for an open trip, but the write
        // door still takes the per-issue lock and runs the commit/flush path.
        // A retained verdict conflict is permanent by design, so that would be
        // one no-op record write per patrol forever — manufacturing contention
        // on the very lock family this issue exists to relieve.
        warnedEpisodes.delete(episode);
        continue;
      }

      // The warning goes out BEFORE the trip write and never touches the record
      // lock. Ordering it after would put the only immediate operator signal
      // behind the very lock whose contention it is reporting.
      //
      // `emitActivityEntryOnce` keys on the episode and checks the event log
      // before appending, so a restart cannot produce a second warning event —
      // a reused id alone would still append and re-publish one. It also awaits
      // durability, so the episode is marked warned only when the warning
      // actually landed; a failed append is retried on the next patrol instead
      // of being silently suppressed by the in-process set.
      if (!warnedEpisodes.has(episode)) {
        const outcome = await emitActivityEntryOnce({
          id: `verdict-fallback:${episode}`,
          source: 'cloister',
          level: 'warn',
          issueId,
          message,
        });
        if (outcome === 'failed') {
          // Nothing landed — do NOT mark the episode warned, or this process
          // would suppress its own retry and the operator would hear nothing.
          actions.push(`${issueId}: verdict-fallback warning could not be recorded — retrying next patrol`);
        } else {
          warnedEpisodes.add(episode);
          if (outcome !== 'duplicate') actions.push(summary);
        }
      }

      // The durable trip is best-effort and retried on later patrols: it writes
      // through the contended lock, so a failure here is expected during a
      // contention episode and must never suppress the warning above.
      try {
        const { emitNeedsYou } = await recordRecoveryFailure(
          workspacePath, issueId, recoveryPath, fallback.updatedAt, 1,
        );
        // The trip landed, so the durable plane owns dedupe from here — drop the
        // in-process key regardless of `emitNeedsYou`, which controls whether
        // this was the notifying trip, not whether the write succeeded.
        warnedEpisodes.delete(episode);
        if (emitNeedsYou) actions.push(`needs-you ${summary}`);
      } catch {
        actions.push(
          `${issueId}: ${recoveryPath} needs-you trip could not be recorded (record lock contended) — retrying next patrol`,
        );
      }
    } catch {
      // A single unreadable workspace must never stop the sweep.
    }
  }

  return actions;
}
