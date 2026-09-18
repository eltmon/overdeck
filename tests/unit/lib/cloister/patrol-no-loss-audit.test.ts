/**
 * PAN-3850 (W42, NFR-4): the Phase 5 patrol no-loss audit.
 *
 * `runPatrol` in `src/lib/cloister/deacon.ts` is a registry: every patrol that
 * exists is registered there, and nothing else registers patrols. This audit
 * parses the registered names straight out of the source and holds them
 * against Appendix C of drafts/pipeline-reliability-review.md:
 *
 * 1. Every registered name is either a Keep/Rewire row, a Delete row still
 *    awaiting its soak-gated removal (W41, deferred), or the Phase 5 addition
 *    `runInvariantChecker`. No fourth kind of patrol can slip in unaudited.
 *
 * PAN-3894 (W4) split the surviving patrols in two: `runPatrol` keeps the 14
 * `TICK_PATROLS` and the housekeeping scheduler runs the 29
 * `HOUSEKEEPING_CHORES`, both declared in `src/lib/cloister/patrol-registry.ts`.
 * "Registered" therefore means tick-registered OR chore-registered, and the
 * audit now holds the union against Appendix C.
 * 2. The registered set equals the audited snapshot exactly — a patrol silently
 *    dropped from runPatrol (a deletion without an audit) fails here.
 * 3. The five exempt alarm patrols (Appendix C #3, #64, #70, #71, #77) are
 *    still wired directly, unwrapped and unbudgeted.
 * 4. Every patrol already deleted by W6/W27-W29/W36 has a covering no-loss
 *    audit file, and none of them is registered any more.
 *
 * Naming: two Appendix C rows are prose descriptions of inline patrols, not
 * function names — `per-project ephemeral specialist patrol` is registered as
 * `perProjectSpecialistPatrol`, and `workspace-missing readyForMerge clear
 * (inline)` as `clearReadyForMergeWorkspaceMissing`. The sets below use the
 * registered spellings.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TICK_PATROLS,
  HOUSEKEEPING_CHORES,
} from '../../../../src/lib/cloister/patrol-registry.js';

const DEACON_PATH = resolve(__dirname, '../../../../src/lib/cloister/deacon.ts');
const TESTS_ROOT = resolve(__dirname, '../../..');
const DELIVERY_AUDIT_PATH = resolve(TESTS_ROOT, 'unit/lib/agents/delivery-no-loss-audit.test.ts');

/** Appendix C Keep + Rewire rows (37 + 5 = 42), in registered spelling. */
const KEEP_REWIRE = new Set([
  'autoCloseOut',
  'checkAndSuspendIdleAgents',
  'checkApiErrorAgents',
  'checkFailedMergeRetry',
  'checkInspectAgentTimeouts',
  'checkMassDeath',
  'checkMergedAdvancingSessions',
  'checkMergedWorkSessions',
  'checkThinkingSignatureCorruption',
  'checkWorkspaceContainerHealth',
  'cleanupStaleAgentState',
  'patrolDockerBridgePool',
  'patrolStaleTaskClaims',
  'perProjectSpecialistPatrol',
  'processPendingLifecycleForPatrol',
  'pruneTerminalStoppedAgents',
  'reapCompletedRemoteAgents',
  'reapLeftoverPlaywrightBrowsers',
  'reapMergedStrikeWorkspaces',
  'reapOrphanedDashboardServers',
  'reconcileAutoMergeRows',
  'reconcileClosedIssueAgents',
  'reconcileIdleWorkspaceStacks',
  'reconcileOrphanProposedSpecs',
  'reconcilePendingPromotions',
  'reconcilePipelineLabelsPatrol',
  'reconcileProjectStatePlanes',
  'reconcileTerminalIssueResidue',
  'reconcileTraefikNetworks',
  'recordMainDivergenceHealth',
  'recreatedStateWarnings',
  'refreshClaudeCredentialsForActiveRemoteAgents',
  'refreshHostHeartbeatForEphemeralVms',
  'runScheduledDeployPatrol',
  'runStallSweeperPatrol',
  'swarmJanitorPass',
  'sweepTranscriptRetention',
  // Rewire
  'checkDeadEndAgents',
  'checkPostReviewCommits',
  'monitorReviewConvoySignals',
  'nudgeIdleWorkAgentsWithOpenBeads',
  'patrolStrikeLandings',
]);

/**
 * Appendix C Delete rows still registered pending the W30/W41 soak — their
 * removal is soak-gated (zero would-have-fired counters for 7 days) and is
 * deliberately out of Phase 5's non-soak scope.
 */
const PENDING_SOAK_DELETION = new Set([
  'checkAwaitingTestWorkSessions',
  'checkCompletedButUnsignaledReviews',
  'checkCompletedButUnsignaledTests',
  'checkFirstCompletionAgents',
  'checkMissingReviewStatuses',
  'checkOrphanedCompletions',
  'checkOrphanedReviewStatuses',
  'checkPendingTestDispatch',
  'checkReadyForMergeStuck',
  'checkStalledReviewParents',
  'checkStuckAgentRemediation',
  'checkStuckReviewing',
  'cleanupOrphanReviewerSessions',
  'cleanupOrphanedInspectSessions',
  'cleanupOrphanedPlanningSessions',
  'cleanupOrphanedReviewSessions',
  'clearReadyForMergeWorkspaceMissing',
  'reconcileAgentLiveness',
  'reconcileClosedPrReadyForMerge',
  'reconcileFalseMerged',
  'reconcileInFlightJournals',
  'reconcileMergedButReviewing',
  'reconcileStaleMergeBlockers',
  'reconcileStaleMergeStatus',
  'reconcileStuckMergingStates',
  'reconcileStuckReadyForMerge',
  'reconcileUnappliedReviewVerdicts',
  'recoverStalledReviewConvoys',
  'sweepStrandedVerdictFallbacks',
]);

/** Phase 5's only addition to the registry (PAN-3850 W40). */
const PHASE_5_ADDITIONS = new Set(['runInvariantChecker']);

/** The five exempt alarm patrols — wired directly, never budgeted. */
const ALARM_PATROLS = [
  'runStallSweeperPatrol',
  'checkApiErrorAgents',
  'recreatedStateWarnings',
  'recordMainDivergenceHealth',
  'checkMassDeath',
];

/**
 * Patrols already deleted by earlier phases, each mapped to the no-loss audit
 * file that gates its deletion. The four delivery-recovery patrols (W6) are
 * covered by one group fixture whose header names them as a set; the two
 * verdict-gate patrols (W27-W29) are named individually in their file.
 */
const DELETED_PATROLS: Record<string, { file: string; namedIndividually: boolean }> = {
  retireResolvedFeedbackDeliveryStuckFlags: { file: 'unit/lib/agents/delivery-no-loss-audit.test.ts', namedIndividually: false },
  nudgeStalledResumeWorkAgents: { file: 'unit/lib/agents/delivery-no-loss-audit.test.ts', namedIndividually: false },
  redeliverUndeliveredKickoffs: { file: 'unit/lib/agents/delivery-no-loss-audit.test.ts', namedIndividually: false },
  cleanupAbandonedFeedback: { file: 'unit/lib/agents/delivery-no-loss-audit.test.ts', namedIndividually: false },
  reconcileTestStatusFromGreenCi: { file: 'unit/lib/cloister/verdict-gate-no-loss-audit.test.ts', namedIndividually: true },
  checkVerificationReviewContradiction: { file: 'unit/lib/cloister/verdict-gate-no-loss-audit.test.ts', namedIndividually: true },
  // PAN-3894 (W8): no-op stub since PAN-800 — the body was `return []`, so it
  // repaired nothing and needed no soak. Stuck detection lives in
  // checkStuckAgentRemediation (stuck-remediation.ts).
  checkStuckWorkAgents: { file: 'unit/lib/cloister/stuck-remediation-oracle.test.ts', namedIndividually: false },
};

function registeredBudgetedNames(): string[] {
  const source = readFileSync(DEACON_PATH, 'utf8');
  const names = [...source.matchAll(/runBudgetedPatrol\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

const CHORE_NAMES = HOUSEKEEPING_CHORES.map((c) => c.name);

/** The body of `runPatrol` alone, so cadence gates elsewhere in deacon.ts do not count. */
function runPatrolBody(): string {
  const source = readFileSync(DEACON_PATH, 'utf8');
  const start = source.indexOf('export async function runPatrol');
  const end = source.indexOf('\nexport ', start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('Phase 5 patrol no-loss audit (PAN-3850 W42)', () => {
  it('every registered patrol is a Keep/Rewire row, a pending-soak Delete row, or a Phase 5 addition', () => {
    const allowed = new Set([...KEEP_REWIRE, ...PENDING_SOAK_DELETION, ...PHASE_5_ADDITIONS]);
    const unaccounted = [...registeredBudgetedNames(), ...CHORE_NAMES].filter((name) => !allowed.has(name));
    expect(unaccounted).toEqual([]);
  });

  it('runPatrol registers exactly the budgeted tick patrols plus the pending-soak rows', () => {
    const expected = new Set([
      // Every tick patrol except the five alarms (wired directly, never budgeted).
      ...TICK_PATROLS.filter((name) => !ALARM_PATROLS.includes(name)),
      ...PENDING_SOAK_DELETION,
    ]);
    expect(registeredBudgetedNames()).toEqual([...expected].sort());
  });

  it('PAN-3894: the tick set and the housekeeping chores partition Keep/Rewire plus the Phase 5 addition', () => {
    const union = [...TICK_PATROLS, ...CHORE_NAMES].sort();
    const audited = [...new Set([...KEEP_REWIRE, ...PHASE_5_ADDITIONS])].sort();
    expect(union).toEqual(audited);
    expect(TICK_PATROLS).toHaveLength(14);
    expect(CHORE_NAMES).toHaveLength(29);
  });

  it('PAN-3894: no patrol is both a tick patrol and a housekeeping chore', () => {
    expect(CHORE_NAMES.filter((name) => (TICK_PATROLS as readonly string[]).includes(name))).toEqual([]);
  });

  it('PAN-3894: runPatrol keeps exactly one modulo cadence gate — the invariant checker', () => {
    const body = runPatrolBody();
    expect(body.match(/patrolCycle %/g) ?? []).toHaveLength(1);
    expect(body).toContain("runBudgetedPatrol('runInvariantChecker'");
  });

  it('the five exempt alarm patrols are still wired directly in runPatrol', () => {
    const source = readFileSync(DEACON_PATH, 'utf8');
    for (const alarm of ALARM_PATROLS) {
      expect(source).toContain(alarm);
      expect(registeredBudgetedNames()).not.toContain(alarm);
    }
  });

  it('every already-deleted patrol has a covering no-loss audit file', () => {
    for (const [patrol, { file, namedIndividually }] of Object.entries(DELETED_PATROLS)) {
      const path = resolve(TESTS_ROOT, file);
      expect(existsSync(path), `${patrol}: missing audit file ${file}`).toBe(true);
      if (namedIndividually) {
        expect(readFileSync(path, 'utf8'), `${patrol}: not named in ${file}`).toContain(patrol);
      }
    }
    // The W6 group fixture must still describe itself as covering all four.
    const delivery = readFileSync(DELIVERY_AUDIT_PATH, 'utf8');
    expect(delivery).toContain('four delivery-recovery patrols (W6)');
  });

  it('no deleted patrol is registered any more', () => {
    const registered = new Set(registeredBudgetedNames());
    for (const patrol of Object.keys(DELETED_PATROLS)) {
      expect(registered.has(patrol), `${patrol} is deleted but still registered`).toBe(false);
    }
  });
});
