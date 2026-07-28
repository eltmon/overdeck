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
import { emitActivityEntryOnce, type ActivityEmitOutcome } from '../activity-logger.js';

/** How long a fallback may stay undrained before the operator hears about it. */
export const VERDICT_CONTENTION_SURFACE_MS = 10 * 60 * 1000;

/**
 * Total time this sweep may spend waiting on warning delivery, across ALL issues.
 *
 * Bounding each request alone is not enough: the sweep visits issues serially,
 * so N stranded fallbacks against a stalled dashboard would cost N × the
 * per-request deadline — six would consume a whole 60s patrol interval and dozens
 * would hold it for many minutes, starving every later issue and later patrol
 * phase while the patrol heartbeat still reported healthy. The systemic
 * degradation that strands several verdicts at once is exactly the state that
 * makes every loopback request hit its deadline, so the budget is shared.
 */
export const SWEEP_WARNING_BUDGET_MS = 30 * 1000;

/**
 * Resolve `attempt`, or give up at `deadlineMs` and report `failed`.
 *
 * Abandoning a warning is always safe: nothing is marked warned on `failed`, and
 * a later retry carries the same idempotency key, so a call that lands after we
 * stopped waiting returns `duplicate` rather than emitting a second warning.
 */
async function withWarningDeadline(
  attempt: Promise<ActivityEmitOutcome>,
  deadlineMs: number,
): Promise<ActivityEmitOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      attempt,
      new Promise<ActivityEmitOutcome>((resolve) => {
        timer = setTimeout(() => { resolve('failed'); }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
interface WarningCandidate {
  issueId: string;
  workspacePath: string;
  recoveryPath: string;
  generation: string;
  episode: string;
  message: string;
  summary: string;
}

/**
 * Drain every pending workspace verdict fallback, and surface the ones that stay
 * stuck. Returns one action line per drain or escalation, for the patrol log.
 *
 * `budgetMs` bounds the total time spent waiting on warning delivery. The deacon
 * derives it from the resolved patrol interval so a shortened interval cannot be
 * overrun by the sweep.
 */
export async function sweepStrandedVerdictFallbacks(
  now = Date.now(),
  budgetMs = SWEEP_WARNING_BUDGET_MS,
): Promise<string[]> {
  const actions: string[] = [];
  let statuses: Record<string, { mergeStatus?: string; closedOut?: boolean; stuck?: boolean; deaconIgnored?: boolean }>;
  try {
    statuses = loadReviewStatuses();
  } catch {
    return actions;
  }

  // ── Phase 1: drain everything, and collect who needs a warning ──────────────
  const candidates: WarningCandidate[] = [];

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

      candidates.push({
        issueId, workspacePath, recoveryPath, generation: fallback.updatedAt, episode, message, summary,
      });
    } catch {
      // A single unreadable workspace must never stop the sweep.
    }
  }

  // ── Phase 2: warn, all candidates concurrently under ONE deadline ───────────
  //
  // Concurrent rather than serial, and started together rather than in turn.
  // Spending a shared budget in issue order let the first hanging episode
  // consume all of it every patrol — iteration order is stable, so the same
  // episode won recursively and every later one was silently dropped without
  // ever attempting its warning. That is the exact hard case this feature
  // targets (a stalled dashboard plus a contended lock), so the unfairness bit
  // hardest when it mattered most. Fanning out gives every episode an attempt
  // and keeps total wall-clock at one budget regardless of how many stranded.
  // Each request is idempotent by episode key, so concurrency cannot duplicate
  // a warning, and an attempt abandoned at the deadline is retried next patrol.
  const pending = candidates.filter((c) => !warnedEpisodes.has(c.episode));
  if (pending.length > 0) {
    const outcomes = await Promise.all(pending.map((candidate) =>
      withWarningDeadline(
        emitActivityEntryOnce({
          id: `verdict-fallback:${candidate.episode}`,
          source: 'cloister',
          level: 'warn',
          issueId: candidate.issueId,
          message: candidate.message,
        }),
        budgetMs,
      ).catch((): ActivityEmitOutcome => 'failed')));

    outcomes.forEach((outcome, index) => {
      const candidate = pending[index]!;
      if (outcome === 'appended' || outcome === 'duplicate') {
        warnedEpisodes.add(candidate.episode);
        if (outcome === 'appended') actions.push(candidate.summary);
      } else {
        // `failed` wrote nothing; `unconfirmed` means the wired store offers no
        // settled path, so delivery is unknown. Neither is evidence the operator
        // was told, and marking the episode warned would suppress the retry.
        actions.push(`${candidate.issueId}: verdict-fallback warning could not be confirmed — retrying next patrol`);
      }
    });
  }

  // ── Phase 3: the durable needs-you trips ───────────────────────────────────
  //
  // After the warnings, never before: these go through the very record lock
  // whose contention is being reported, so a slow or failing trip write must
  // not delay or suppress the operator-visible warning.
  for (const candidate of candidates) {
    try {
      const { emitNeedsYou } = await recordRecoveryFailure(
        candidate.workspacePath, candidate.issueId, candidate.recoveryPath, candidate.generation, 1,
      );
      // The trip landed, so the durable plane owns dedupe from here — drop the
      // in-process key regardless of `emitNeedsYou`, which controls whether this
      // was the notifying trip, not whether the write succeeded.
      warnedEpisodes.delete(candidate.episode);
      if (emitNeedsYou) actions.push(`needs-you ${candidate.summary}`);
    } catch {
      actions.push(
        `${candidate.issueId}: ${candidate.recoveryPath} needs-you trip could not be recorded (record lock contended) — retrying next patrol`,
      );
    }
  }

  return actions;
}
