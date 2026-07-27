import { existsSync } from 'node:fs';
import {
  type BootReconciliationDecision,
  getBootReconciliationState,
  getLastCleanShutdownAt,
  setBootReconciliationDecision,
  setBootReconciliationGrace,
  stampBootReconciliation,
} from '../overdeck/control-settings.js';
import {
  getIssueStageSync,
  isTerminalIssueStage,
  listAllAgentsSync,
} from '../overdeck/agents.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { loadCloisterConfigSync } from './config.js';
import { isExplicitNoResumeRequest } from './no-resume-mode.js';
import { bootReconciliationSkipReason } from './boot-reconciliation-predicates.js';

export const DEFAULT_BOOT_RECONCILIATION_GRACE_SECS = 120;
export const CLEAN_SHUTDOWN_FRESHNESS_MS = 30 * 60 * 1000;

/**
 * How many times the grace window may be pushed out because the operator is
 * answering a different blocking question (an AskUserQuestion, a plan approval,
 * a permission prompt). The dialog is time-boxed on purpose — expiry commits
 * `hold_all`, which parks every candidate — so an operator who cannot even see
 * the countdown must not lose the window. The cap keeps that bounded: a dialog
 * nobody ever dismisses still resolves after grace * (1 + MAX_EXTENSIONS).
 */
export const MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS = 3;

export interface BootReconciliationExtendResult {
  extended: boolean;
  graceDeadline: string | null;
  graceExtensions: number;
  maxGraceExtensions: number;
  reason: 'extended' | 'not-pending' | 'cap-reached' | 'no-deadline';
}

type ReconciliationAgent = ReturnType<typeof listAllAgentsSync>[number];

export interface BootReconciliationStartupResult {
  bootId: string;
  graceDeadline: string;
  candidateIds: string[];
  decision: BootReconciliationDecision;
  timerArmed: boolean;
}

export interface StartBootReconciliationOptions {
  bootId?: string;
  now?: Date;
  onGraceExpired?: () => void | Promise<void>;
}

let graceTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The expiry hook the live timer was armed with. Held so `extendBootReconciliationGrace`
 * can re-arm against the new deadline without the HTTP route having to know how
 * the boot path wires the apply step.
 */
let graceExpiryHook: (() => void | Promise<void>) | null = null;

function newestAgentTimestampMs(agent: ReconciliationAgent): number | null {
  const timestamps = [agent.lastActivity, agent.stoppedAt, agent.startedAt]
    .map((value) => value == null ? NaN : Date.parse(value))
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function isRecentBootCandidate(agent: ReconciliationAgent): boolean {
  const bootStartedAt = getBootReconciliationState().bootStartedAt;
  const bootStartedAtMs = bootStartedAt == null ? NaN : Date.parse(bootStartedAt);
  const newestTimestampMs = newestAgentTimestampMs(agent);
  if (!Number.isFinite(bootStartedAtMs) || newestTimestampMs == null) return false;
  const maxAgeMs = getBootReconciliationMaxCandidateAgeSeconds() * 1000;
  return newestTimestampMs >= bootStartedAtMs - maxAgeMs;
}

export function isCleanShutdownBoot(): boolean {
  // Classify against boot start so grace extensions cannot age a clean marker into a crash.
  const state = getBootReconciliationState();
  const bootStartedAtMs = state.bootStartedAt == null ? NaN : Date.parse(state.bootStartedAt);
  const marker = getLastCleanShutdownAt();
  const markerMs = marker == null ? NaN : Date.parse(marker);
  return Number.isFinite(bootStartedAtMs)
    && Number.isFinite(markerMs)
    && bootStartedAtMs - markerMs <= CLEAN_SHUTDOWN_FRESHNESS_MS;
}

export function getBootReconciliationGraceSeconds(): number {
  const value = loadCloisterConfigSync().startup.reconciliation_grace_secs;
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_BOOT_RECONCILIATION_GRACE_SECS;
}

export function getBootReconciliationMaxCandidateAgeSeconds(): number {
  const config = loadCloisterConfigSync().startup;
  const value = config.reconciliation_max_candidate_age_secs;
  return Number.isFinite(value) && value > 0
    ? value
    : getBootReconciliationGraceSeconds() * 2;
}

export function isAutoResumableRole(role: ReconciliationAgent['role']): boolean {
  return role === 'work' || role === 'strike';
}

export function isBootReconciliationCandidate(agent: ReconciliationAgent): boolean {
  if (!isAutoResumableRole(agent.role) || agent.status !== 'stopped') return false;
  if (agent.paused === true || agent.troubled === true) return false;
  if (!isRecentBootCandidate(agent)) return false;
  if (bootReconciliationSkipReason(agent) !== null) return false;
  if (!agent.workspace || !existsSync(agent.workspace)) return false;
  if (isTerminalIssueStage(getIssueStageSync(agent.issueId))) return false;
  return true;
}

export function listBootReconciliationCandidateIds(): string[] {
  return listBootReconciliationCandidates().map((agent) => agent.id);
}

export function listBootReconciliationCandidates(): ReconciliationAgent[] {
  return listAllAgentsSync()
    .filter(isBootReconciliationCandidate);
}

export function getBootReconciliationPendingHoldSet(): Set<string> {
  const state = getBootReconciliationState();
  if (state.decision !== 'pending') return new Set();
  return new Set(listBootReconciliationCandidateIds());
}

export function getBootReconciliationHeldResumeSet(): Set<string> {
  const state = getBootReconciliationState();
  if (state.decision !== 'pending' && state.decision !== 'hold_all' && state.decision !== 'per_agent') {
    return new Set();
  }

  const heldCandidates = listBootReconciliationCandidates()
    .filter((agent) => state.decision !== 'per_agent' || state.perAgent[agent.issueId] !== 'resume')
    .map((agent) => agent.id);
  return new Set(heldCandidates);
}

export function clearBootReconciliationGraceTimer(): void {
  graceExpiryHook = null;
  if (!graceTimer) return;
  clearTimeout(graceTimer);
  graceTimer = null;
}

/**
 * Push the grace deadline out by one full grace period. Only legal while the
 * decision is still `pending`, and only up to MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS
 * times per boot. The caller (the extend route) is expected to fire this while
 * another blocking dialog is covering the boot modal.
 */
export function extendBootReconciliationGrace(now: Date = new Date()): BootReconciliationExtendResult {
  const state = getBootReconciliationState();
  const maxGraceExtensions = MAX_BOOT_RECONCILIATION_GRACE_EXTENSIONS;

  if (state.decision !== 'pending') {
    return {
      extended: false,
      graceDeadline: state.graceDeadline,
      graceExtensions: state.graceExtensions,
      maxGraceExtensions,
      reason: 'not-pending',
    };
  }

  if (state.graceExtensions >= maxGraceExtensions) {
    return {
      extended: false,
      graceDeadline: state.graceDeadline,
      graceExtensions: state.graceExtensions,
      maxGraceExtensions,
      reason: 'cap-reached',
    };
  }

  const currentDeadlineMs = state.graceDeadline == null ? NaN : Date.parse(state.graceDeadline);
  if (!Number.isFinite(currentDeadlineMs)) {
    return {
      extended: false,
      graceDeadline: state.graceDeadline,
      graceExtensions: state.graceExtensions,
      maxGraceExtensions,
      reason: 'no-deadline',
    };
  }

  // Extend from whichever is later: the standing deadline, or now. A deadline
  // that already slipped past (server was busy) must still yield a full window.
  const graceMs = getBootReconciliationGraceSeconds() * 1000;
  const base = Math.max(currentDeadlineMs, now.getTime());
  const graceDeadline = new Date(base + graceMs).toISOString();
  const graceExtensions = state.graceExtensions + 1;

  setBootReconciliationGrace(graceDeadline, graceExtensions);
  armBootReconciliationGraceTimer(graceDeadline, graceExpiryHook ?? undefined);
  logDeaconEventSync(
    `boot reconciliation grace extended to ${graceDeadline} (${graceExtensions}/${maxGraceExtensions}) — operator has another blocking dialog open`,
  );

  return { extended: true, graceDeadline, graceExtensions, maxGraceExtensions, reason: 'extended' };
}

export function armBootReconciliationGraceTimer(
  graceDeadline: string,
  onGraceExpired: () => void | Promise<void> = () => undefined,
): boolean {
  clearBootReconciliationGraceTimer();
  const deadlineMs = Date.parse(graceDeadline);
  if (!Number.isFinite(deadlineMs)) return false;
  const delayMs = Math.max(0, deadlineMs - Date.now());
  // Retained so an extend can re-arm the same apply step against a later deadline.
  graceExpiryHook = onGraceExpired;

  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (getBootReconciliationState().decision !== 'pending') return;
    if (listBootReconciliationCandidateIds().length === 0) {
      setBootReconciliationDecision('resume_all');
      logDeaconEventSync('boot reconciliation grace expired — vacuous hold auto-released (0 candidates)');
      void Promise.resolve(onGraceExpired()).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logDeaconEventSync(`boot reconciliation grace expiry apply hook failed: ${message}`);
      });
      return;
    }
    const decision = isCleanShutdownBoot() ? 'resume_all' : 'hold_all';
    setBootReconciliationDecision(decision);
    logDeaconEventSync(decision === 'resume_all'
      ? 'boot reconciliation grace expired — clean shutdown within 30m, decision set to resume_all'
      : 'boot reconciliation grace expired — no clean shutdown marker (crash boot), decision set to hold_all');
    void Promise.resolve(onGraceExpired()).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logDeaconEventSync(`boot reconciliation grace expiry apply hook failed: ${message}`);
    });
  }, delayMs);
  graceTimer.unref?.();
  return true;
}

export function startBootReconciliation(
  options: StartBootReconciliationOptions = {},
): BootReconciliationStartupResult {
  const now = options.now ?? new Date();
  const bootId = options.bootId ?? process.env.OVERDECK_BOOT_ID ?? `boot-${now.toISOString()}`;
  const graceDeadline = new Date(now.getTime() + getBootReconciliationGraceSeconds() * 1000).toISOString();
  const existing = getBootReconciliationState();
  const bootStartedAt = existing.bootId === bootId && existing.bootStartedAt
    ? existing.bootStartedAt
    : now.toISOString();
  const stampedGraceDeadline = existing.bootId === bootId && existing.graceDeadline
    ? existing.graceDeadline
    : graceDeadline;

  if (existing.bootId !== bootId || !existing.bootStartedAt) {
    stampBootReconciliation(bootId, stampedGraceDeadline, bootStartedAt);
  }

  const candidateIds = listBootReconciliationCandidateIds();

  if (existing.bootId === bootId && existing.decision) {
    const existingGraceDeadline = existing.graceDeadline ?? graceDeadline;
    if (existing.decision === 'pending') {
      const timerArmed = armBootReconciliationGraceTimer(existingGraceDeadline, options.onGraceExpired);
      logDeaconEventSync(`boot reconciliation preserved ${bootId}: pending until ${existingGraceDeadline}`);
      return { bootId, graceDeadline: existingGraceDeadline, candidateIds, decision: 'pending', timerArmed };
    }

    clearBootReconciliationGraceTimer();
    logDeaconEventSync(`boot reconciliation preserved ${bootId}: decision=${existing.decision}`);
    return {
      bootId,
      graceDeadline: existingGraceDeadline,
      candidateIds,
      decision: existing.decision,
      timerArmed: false,
    };
  }

  if (isExplicitNoResumeRequest()) {
    clearBootReconciliationGraceTimer();
    setBootReconciliationDecision('hold_all');
    logDeaconEventSync(`boot reconciliation stamped ${bootId}: explicit OVERDECK_NO_RESUME requested hold_all`);
    return { bootId, graceDeadline, candidateIds, decision: 'hold_all', timerArmed: false };
  }

  // PAN-2510: an empty candidate list at stamp time does NOT mean "genuinely
  // nothing to reconcile". startBootReconciliation() runs in the dashboard
  // process, but agent liveness is reconciled asynchronously in the separately
  // spawned deacon child (reconcileAgentLiveness marks crashed agents `stopped`
  // ~1s later). On a full box reboot (OOM crash, power cycle) the agents are
  // still marked `healthy`/`running` in the table when the dashboard stamps, so
  // listBootReconciliationCandidateIds() returns 0 — then the crashed agents
  // materialize as candidates a second later. Terminally committing `resume_all`
  // here (the pre-PAN-2510 fast path) permanently skipped the operator dialog
  // AND left the held-resume set empty, so those late-arriving candidates
  // auto-resumed ungated — the exact post-reboot flood we must avoid.
  //
  // Instead we always open the grace window in `pending`. The candidate set is
  // recomputed live (frontend poll + held-resume/pending-hold sets), so late
  // arrivals from the deacon-child reconciliation are discovered and held, and
  // the dialog renders. If the window expires with still-zero candidates
  // (genuinely clean boot / dashboard-only restart with nothing stopped), the
  // grace timer resolves `pending` → `hold_all`, the safe timeout default.
  setBootReconciliationDecision('pending');
  const timerArmed = armBootReconciliationGraceTimer(graceDeadline, options.onGraceExpired);
  const heldSummary = candidateIds.length === 0
    ? 'awaiting agent-table reconciliation (0 candidates at stamp time)'
    : `holding ${candidateIds.length} candidate(s)`;
  logDeaconEventSync(`boot reconciliation stamped ${bootId}: ${heldSummary} until ${graceDeadline}`);
  return { bootId, graceDeadline, candidateIds, decision: 'pending', timerArmed };
}
