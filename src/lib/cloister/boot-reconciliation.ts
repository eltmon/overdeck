import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BootReconciliationDecision,
  getBootReconciliationState,
  setBootReconciliationDecision,
  stampBootReconciliation,
} from '../overdeck/control-settings.js';
import { listAllAgentsSync } from '../overdeck/agents.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { loadCloisterConfigSync } from './config.js';
import { getNoResumeMode } from './no-resume-mode.js';

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

export function getBootReconciliationGraceSeconds(): number {
  const value = loadCloisterConfigSync().startup.reconciliation_grace_secs;
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_BOOT_RECONCILIATION_GRACE_SECS;
}

export function isBootReconciliationCandidate(agent: ReconciliationAgent): boolean {
  if (agent.role !== 'work' || agent.status !== 'stopped') return false;
  if (agent.paused === true || agent.troubled === true) return false;
  if (agent.stoppedByUser === true && !hasCompletionMarker(agent.workspace)) return false;
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
    setBootReconciliationDecision('resume_all');
    logDeaconEventSync('boot reconciliation grace expired — decision set to resume_all');
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
  const candidateIds = listBootReconciliationCandidateIds();
  const existing = getBootReconciliationState();

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

  stampBootReconciliation(bootId, graceDeadline);

  if (getNoResumeMode().active) {
    clearBootReconciliationGraceTimer();
    setBootReconciliationDecision('hold_all');
    logDeaconEventSync(`boot reconciliation stamped ${bootId}: OVERDECK_NO_RESUME requested hold_all`);
    return { bootId, graceDeadline, candidateIds, decision: 'hold_all', timerArmed: false };
  }

  if (candidateIds.length === 0) {
    clearBootReconciliationGraceTimer();
    setBootReconciliationDecision('resume_all');
    logDeaconEventSync(`boot reconciliation stamped ${bootId}: no candidates`);
    return { bootId, graceDeadline, candidateIds, decision: 'resume_all', timerArmed: false };
  }

  setBootReconciliationDecision('pending');
  const timerArmed = armBootReconciliationGraceTimer(graceDeadline, options.onGraceExpired);
  logDeaconEventSync(`boot reconciliation stamped ${bootId}: holding ${candidateIds.length} candidate(s) until ${graceDeadline}`);
  return { bootId, graceDeadline, candidateIds, decision: 'pending', timerArmed };
}
