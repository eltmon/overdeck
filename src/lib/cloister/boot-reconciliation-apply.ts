/**
 * Applies the operator's boot-reconciliation decision without changing the
 * auto-resume policy that evaluates each selected agent (PAN-3052).
 */
import { cpus, loadavg } from 'os';
import { Effect } from 'effect';
import {
  alreadyRunningBootReconciliationOutcome,
  resumedBootReconciliationOutcome,
  skippedBootReconciliationOutcome,
  skippedBootReconciliationOutcomes,
  type BootReconciliationApplyResult,
  type BootReconciliationOutcome,
} from './boot-reconciliation-outcomes.js';
import { getConcurrencyLimits, countRunningAgents, workResumeSlotsAvailable } from './concurrency.js';
import { assessMemoryPressure } from './memory-governor.js';
import { listBootReconciliationCandidates } from './boot-reconciliation.js';
import { bootReconciliationSkipReason, type BootReconciliationSkipReason } from './boot-reconciliation-predicates.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { getBootReconciliationState } from '../overdeck/control-settings.js';
import { sessionExists } from '../tmux.js';
import {
  handleAgentStoppedEvent,
  RESUME_LOAD_FACTOR,
  RESUME_STAGGER_MS,
  RSS_SETTLE_MS,
  type AutoResumeNotifierDeps,
} from './deacon-auto-resume.js';

export type { BootReconciliationApplyResult, BootReconciliationOutcome, BootReconciliationOutcomeReason } from './boot-reconciliation-outcomes.js';

export interface BootReconciliationApplyOptions {
  origin?: 'operator' | 'auto';
}

const appliedBootReconciliationDecisions = new Set<string>();
const emptyBootReconciliationApplyResult = (): BootReconciliationApplyResult => ({ resumed: [], outcomes: [], skipped: { workspace_missing: 0, merged: 0, completed: 0, other: 0 }, deferred: 0 });

function bootReconciliationDecisionKey(): string | null {
  const state = getBootReconciliationState();
  if (!state.decision || state.decision === 'pending') return null;
  return `${state.bootId ?? 'boot'}:${state.decision}:${JSON.stringify(state.perAgent)}`;
}

export async function applyBootReconciliationDecision(
  deps: AutoResumeNotifierDeps,
  opts: BootReconciliationApplyOptions = {},
): Promise<BootReconciliationApplyResult> {
  const origin = opts.origin ?? 'auto';
  const decisionKey = bootReconciliationDecisionKey();
  if (!decisionKey) return emptyBootReconciliationApplyResult();
  if (appliedBootReconciliationDecisions.has(decisionKey)) {
    logDeaconEventSync('applyBootReconciliationDecision: decision already applied');
    return emptyBootReconciliationApplyResult();
  }

  const state = getBootReconciliationState();
  if (state.decision === 'hold_all') {
    appliedBootReconciliationDecisions.add(decisionKey);
    logDeaconEventSync('applyBootReconciliationDecision: hold_all — no agents resumed');
    return emptyBootReconciliationApplyResult();
  }

  let candidates = listBootReconciliationCandidates();
  if (origin === 'auto') {
    const candidateCount = candidates.length;
    candidates = candidates.filter((agent) => agent.stoppedByUser !== true);
    const filteredCount = candidateCount - candidates.length;
    if (filteredCount > 0) {
      logDeaconEventSync(`applyBootReconciliationDecision: auto origin filtered ${filteredCount} stoppedByUser candidate(s)`);
    }
  }
  if (state.decision === 'per_agent') {
    candidates = candidates.filter((agent) => state.perAgent[agent.issueId] === 'resume');
  }

  const resumed: string[] = [];
  const outcomes: BootReconciliationOutcome[] = [];
  const skipped: Record<BootReconciliationSkipReason | 'other', number> = { workspace_missing: 0, merged: 0, completed: 0, other: 0 };
  let deferred = 0;
  let resumeAttempts = 0;
  const concurrencyLimits = getConcurrencyLimits();
  const runningBefore = countRunningAgents();
  const workSlots = workResumeSlotsAvailable(runningBefore, concurrencyLimits);
  const cores = cpus().length || 1;
  const loadCeiling = cores * RESUME_LOAD_FACTOR;

  for (let index = 0; index < candidates.length; index++) {
    const agent = candidates[index];
    if (resumeAttempts >= workSlots) {
      logDeaconEventSync(`applyBootReconciliationDecision: work concurrency cap reached (running=${runningBefore.work}, max=${concurrencyLimits.maxWorkAgents}, slots=${workSlots}); deferring remaining candidates`);
      const deferredAgents = candidates.slice(index);
      deferred += deferredAgents.length;
      outcomes.push(...skippedBootReconciliationOutcomes(deferredAgents, 'deferred-concurrency'));
      break;
    }
    const load1 = loadavg()[0];
    if (load1 > loadCeiling) {
      logDeaconEventSync(`applyBootReconciliationDecision: load gate tripped (load1=${load1.toFixed(2)} > ${loadCeiling.toFixed(2)} = ${cores} cores * ${RESUME_LOAD_FACTOR}); deferring remaining candidates`);
      const deferredAgents = candidates.slice(index);
      deferred += deferredAgents.length;
      outcomes.push(...skippedBootReconciliationOutcomes(deferredAgents, 'deferred-load'));
      break;
    }
    const memVerdict = await assessMemoryPressure();
    if (memVerdict.band !== 'ok') {
      logDeaconEventSync(`applyBootReconciliationDecision: memory gate (${memVerdict.band}), availMB=${Math.round(memVerdict.availableBytes / 1048576)}; deferring remaining candidates`);
      const deferredAgents = candidates.slice(index);
      deferred += deferredAgents.length;
      outcomes.push(...skippedBootReconciliationOutcomes(deferredAgents, 'deferred-memory'));
      break;
    }
    if (resumeAttempts > 0) {
      await new Promise(r => setTimeout(r, RESUME_STAGGER_MS));
    }

    const result = await handleAgentStoppedEvent(
      agent.id,
      {
        skipGlobalGates: true,
        context: 'boot-reconciliation',
        ...(origin === 'operator' ? { overrideStoppedByUser: true } : {}),
      },
      deps,
    );
    if (result) {
      resumed.push(result);
      outcomes.push(resumedBootReconciliationOutcome(agent));
      resumeAttempts++;
      // PAN-2500 memory-paced-boot: let RSS settle before the next candidate's
      // memory check (top of the next loop iteration) re-assesses.
      await new Promise(r => setTimeout(r, RSS_SETTLE_MS));
    } else if (await Effect.runPromise(sessionExists(agent.id))) {
      // PAN-3052: already live — the reactive stopped-event path won the race in
      // the seconds between the operator saving the decision and this batch. It
      // is counted in runningBefore, so it takes no slot; reporting it as a skip
      // told the operator an agent was "not resumable" while it was running.
      resumed.push(agent.id);
      outcomes.push(alreadyRunningBootReconciliationOutcome(agent));
    } else {
      const skipReason = bootReconciliationSkipReason(agent) ?? 'other';
      skipped[skipReason]++;
      outcomes.push(skippedBootReconciliationOutcome(agent, 'no-resumable-session'));
    }
  }

  appliedBootReconciliationDecisions.add(decisionKey);
  logDeaconEventSync(`applyBootReconciliationDecision: decision=${state.decision} resumed ${resumed.length} agent(s)`);
  return { resumed, outcomes, skipped, deferred };
}
