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

describe('Phase 5 patrol no-loss audit (PAN-3850 W42)', () => {
  it('every registered patrol is a Keep/Rewire row, a pending-soak Delete row, or a Phase 5 addition', () => {
    const allowed = new Set([...KEEP_REWIRE, ...PENDING_SOAK_DELETION, ...PHASE_5_ADDITIONS]);
    const unaccounted = registeredBudgetedNames().filter((name) => !allowed.has(name));
    expect(unaccounted).toEqual([]);
  });

  it('the registered set matches the audited snapshot exactly — no silent additions or removals', () => {
    const expected = new Set([
      // Every Keep/Rewire row except the five alarms (wired directly).
      ...[...KEEP_REWIRE].filter((name) => !ALARM_PATROLS.includes(name)),
      ...PENDING_SOAK_DELETION,
      ...PHASE_5_ADDITIONS,
    ]);
    expect(registeredBudgetedNames()).toEqual([...expected].sort());
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
