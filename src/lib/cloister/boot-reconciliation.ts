import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BootReconciliationDecision,
  getBootReconciliationState,
  setBootReconciliationDecision,
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

function hasCompletionMarker(workspace: string | null): boolean {
  if (!workspace) return false;
  return existsSync(join(workspace, '.pan', 'completed'))
    || existsSync(join(workspace, '.pan', 'completed.processed'));
}

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

export function isBootReconciliationCandidate(agent: ReconciliationAgent): boolean {
  if (agent.role !== 'work' || agent.status !== 'stopped') return false;
  if (agent.paused === true || agent.troubled === true) return false;
  if (agent.stoppedByUser === true && !hasCompletionMarker(agent.workspace)) return false;
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
  if (!graceTimer) return;
  clearTimeout(graceTimer);
  graceTimer = null;
}

export function armBootReconciliationGraceTimer(
  graceDeadline: string,
  onGraceExpired: () => void | Promise<void> = () => undefined,
): boolean {
  clearBootReconciliationGraceTimer();
  const deadlineMs = Date.parse(graceDeadline);
  if (!Number.isFinite(deadlineMs)) return false;
  const delayMs = Math.max(0, deadlineMs - Date.now());

  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (getBootReconciliationState().decision !== 'pending') return;
    setBootReconciliationDecision('hold_all');
    logDeaconEventSync('boot reconciliation grace expired — decision set to hold_all');
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
