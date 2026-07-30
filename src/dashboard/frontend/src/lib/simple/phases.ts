/**
 * PAN-2908 · C-VOCAB — the ONE lifecycle vocabulary for the dashboard.
 *
 * Six phases, in order, used by every surface: Plan → Work → Review → Test →
 * Ship → Done. All legacy label sets (board columns, pipeline groups, drawer
 * timeline, cockpit stepper) must derive from this module. The conformance
 * gate (tests/unit/ux-vocabulary.test.ts) greps for the legacy sets.
 *
 * Simple mode does NOT show these words — it shows USER_FACING_STATES from
 * ./userFacingState.ts, which is a projection over the same machine state.
 */
import type { PipelineState } from '../issuePipelineState';

export const PHASES = ['plan', 'work', 'review', 'test', 'ship', 'done'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  plan: 'Plan',
  work: 'Work',
  review: 'Review',
  test: 'Test',
  ship: 'Ship',
  done: 'Done',
};

export function phaseLabel(phase: Phase): string {
  return PHASE_LABELS[phase];
}

/** Visual state of one rail step. `attention` = needs a human (changes/failures). */
export type PhaseStepState = 'done' | 'current' | 'pending' | 'attention';

export type PhaseRailState = Record<Phase, PhaseStepState>;

const D = 'done' as const;
const C = 'current' as const;
const P = 'pending' as const;
const A = 'attention' as const;

/**
 * Exhaustive projection from the machine's PipelineState (issuePipelineState.ts)
 * onto the six-phase rail. Every PipelineState must appear here — the unit test
 * asserts exhaustiveness so a new machine state fails to compile green without
 * choosing its user-facing meaning.
 */
const RAIL_BY_PIPELINE_STATE: Record<PipelineState, PhaseRailState> = {
  planning_active:            { plan: C, work: P, review: P, test: P, ship: P, done: P },
  planning_done_awaiting_work:{ plan: D, work: C, review: P, test: P, ship: P, done: P },
  in_progress_work_running:   { plan: D, work: C, review: P, test: P, ship: P, done: P },
  in_progress_work_idle:      { plan: D, work: C, review: P, test: P, ship: P, done: P },
  in_review_reviewers_running:{ plan: D, work: D, review: C, test: P, ship: P, done: P },
  in_review_changes_requested:{ plan: D, work: D, review: A, test: P, ship: P, done: P },
  in_review_approved:         { plan: D, work: D, review: D, test: C, ship: P, done: P },
  testing_running:            { plan: D, work: D, review: D, test: C, ship: P, done: P },
  testing_failures:           { plan: D, work: D, review: D, test: A, ship: P, done: P },
  verification_failing:       { plan: D, work: D, review: D, test: A, ship: P, done: P },
  ready_to_merge:             { plan: D, work: D, review: D, test: D, ship: C, done: P },
  merging:                    { plan: D, work: D, review: D, test: D, ship: C, done: P },
  verifying:                  { plan: D, work: D, review: D, test: D, ship: C, done: P },
  merged:                     { plan: D, work: D, review: D, test: D, ship: D, done: C },
  done:                       { plan: D, work: D, review: D, test: D, ship: D, done: D },
  canceled:                   { plan: P, work: P, review: P, test: P, ship: P, done: P },
  generic:                    { plan: P, work: P, review: P, test: P, ship: P, done: P },
};

export function phaseRailState(pipelineState: PipelineState): PhaseRailState {
  return RAIL_BY_PIPELINE_STATE[pipelineState];
}

/**
 * Simple mode's four-step track (Started · Writing code · Checking · Ready)
 * projected from the same machine state. Index 4 means every step is behind us.
 *
 * This is deliberately NOT derived from `currentPhase` + the six-phase rail:
 * the rail marks `work` current the moment a plan exists, which on the
 * four-step track would read as "Writing code" before any code was written.
 * A finished plan that nobody has started sits on step 0 — it started, and it
 * is waiting on you before it writes anything.
 */
const SIMPLE_STEP_BY_PIPELINE_STATE: Record<PipelineState, number> = {
  planning_active:             0,
  planning_done_awaiting_work: 0,
  in_progress_work_running:    1,
  in_progress_work_idle:       1,
  in_review_reviewers_running: 2,
  in_review_changes_requested: 2,
  in_review_approved:          2,
  testing_running:             2,
  testing_failures:            2,
  verification_failing:        2,
  ready_to_merge:              3,
  merging:                     3,
  verifying:                   3,
  merged:                      4,
  done:                        4,
  canceled:                    0,
  generic:                     0,
};

export function simpleStepIndex(pipelineState: PipelineState): number {
  return SIMPLE_STEP_BY_PIPELINE_STATE[pipelineState];
}

/** The phase an issue is "at" (its current or attention step, else null). */
export function currentPhase(pipelineState: PipelineState): Phase | null {
  const rail = RAIL_BY_PIPELINE_STATE[pipelineState];
  for (const phase of PHASES) {
    if (rail[phase] === 'current' || rail[phase] === 'attention') return phase;
  }
  return null;
}
