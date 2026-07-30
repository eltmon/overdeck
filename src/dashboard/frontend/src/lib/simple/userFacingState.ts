/**
 * PAN-2908 · C-SIMPLE — the five user-facing states for simple mode.
 *
 * Simple mode answers three questions only: what is it doing, does it need me,
 * is it done. The internal machine lifecycle (PipelineState) projects onto
 * five plain-English states; simple-mode UI never renders internal phase names
 * (enforced by the copy lint — see ./strings.ts).
 *
 * Every label here must pass the banned-words lint.
 */
import type { PipelineState } from '../issuePipelineState';

export const USER_FACING_STATES = ['not-started', 'working', 'needs-you', 'ready', 'done'] as const;
export type UserFacingState = (typeof USER_FACING_STATES)[number];

export interface UserFacingInput {
  pipelineState: PipelineState;
  /** An agent is waiting on an AskUserQuestion / operator message. */
  pendingInput?: boolean;
  /**
   * The pending input is a bare turn-end — the agent simply stopped talking —
   * rather than an actual open decision (a question, a plan approval, a
   * permission prompt). See `isBareTurnEnd` in ./derive.ts.
   */
  bareTurnEnd?: boolean;
  /** An agent is past the stuck threshold or gated troubled. */
  stuck?: boolean;
}

/** Why the task needs a human, when it does. Drives copy and home grouping. */
export type NeedsYouReason = 'question' | 'start-work' | 'problems' | 'stuck';

export interface UserFacingDisplay {
  state: UserFacingState;
  /** Short status line, e.g. "Writing code". */
  title: string;
  /** One plain sentence, e.g. "The agent is writing the code." */
  sentence: string;
  /** The ONE primary action label (plain verb phrase), or null when there is
   *  nothing useful to press (machine has it). */
  primaryAction: string | null;
  /** Secondary, quiet actions. */
  secondaryActions: string[];
  /** Set exactly when `state` is 'needs-you'; null otherwise. */
  needsYouReason: NeedsYouReason | null;
}

interface BaseDisplay {
  state: UserFacingState;
  title: string;
  sentence: string;
  primaryAction: string | null;
  needsYouReason?: NeedsYouReason;
}

const BASE_BY_PIPELINE_STATE: Record<PipelineState, BaseDisplay> = {
  planning_active:            { state: 'working', title: 'Planning', sentence: 'The agent is breaking this down into tasks.', primaryAction: null },
  // The plan exists and nothing is running: work does NOT start by itself, so
  // this is a decision, not a transition. Naming the button is the whole point.
  planning_done_awaiting_work:{ state: 'needs-you', title: 'The plan is ready', sentence: 'The plan is written and nothing is running. Nothing starts until you say go.', primaryAction: 'Start work', needsYouReason: 'start-work' },
  in_progress_work_running:   { state: 'working', title: 'Writing code', sentence: 'The agent is writing the code.', primaryAction: null },
  in_progress_work_idle:      { state: 'working', title: 'Paused mid-work', sentence: 'Work started but is idle right now.', primaryAction: null },
  in_review_reviewers_running:{ state: 'working', title: 'Being checked', sentence: 'The work is done and being checked over.', primaryAction: null },
  in_review_changes_requested:{ state: 'needs-you', title: 'Problems found', sentence: 'The check found problems that need fixing before this can merge.', primaryAction: 'Tell the agent to fix them', needsYouReason: 'problems' },
  in_review_approved:         { state: 'working', title: 'Almost there', sentence: 'Checks passed — finishing the last automated steps.', primaryAction: null },
  testing_running:            { state: 'working', title: 'Being tested', sentence: 'The finished work is being tested.', primaryAction: null },
  testing_failures:           { state: 'needs-you', title: 'Tests failing', sentence: 'Some tests are failing and need a look.', primaryAction: 'Tell the agent to fix them', needsYouReason: 'problems' },
  verification_failing:       { state: 'needs-you', title: 'Checks failing', sentence: 'Some checks are failing and need a look.', primaryAction: 'Tell the agent to fix them', needsYouReason: 'problems' },
  ready_to_merge:             { state: 'ready', title: 'Ready to merge', sentence: 'Done and checked — ready to merge. Nothing merges by itself.', primaryAction: 'Merge to main' },
  merging:                    { state: 'working', title: 'Merging', sentence: 'Being merged to main now.', primaryAction: null },
  verifying:                  { state: 'working', title: 'Verifying on main', sentence: 'Merged — making sure it works on main.', primaryAction: null },
  merged:                     { state: 'done', title: 'Merged', sentence: 'Merged to main. This task is complete.', primaryAction: 'See what changed' },
  done:                       { state: 'done', title: 'Done', sentence: 'This task is complete.', primaryAction: 'See what changed' },
  canceled:                   { state: 'done', title: 'Canceled', sentence: 'This task was canceled.', primaryAction: null },
  generic:                    { state: 'not-started', title: 'Not started', sentence: 'No one has started this yet.', primaryAction: 'Start work' },
};

/**
 * A finished plan's agent goes idle, which reads as pending input even though
 * it asked nothing. When that bare turn-end is the ONLY pending signal and the
 * plan is done, the base state already says the true thing ("the plan is ready,
 * press start") — a generic question card would replace it with a lie and an
 * answer box that goes nowhere.
 */
function showsQuestion(input: UserFacingInput): boolean {
  if (!input.pendingInput) return false;
  return !(input.bareTurnEnd === true && input.pipelineState === 'planning_done_awaiting_work');
}

/** Signals that override the base projection: questions and stuck agents always win. */
export function userFacingState(input: UserFacingInput): UserFacingState {
  if (showsQuestion(input)) return 'needs-you';
  if (input.stuck) return 'needs-you';
  return BASE_BY_PIPELINE_STATE[input.pipelineState].state;
}

export function userFacingDisplay(input: UserFacingInput): UserFacingDisplay {
  if (showsQuestion(input)) {
    return {
      state: 'needs-you',
      title: 'Question for you',
      sentence: 'The agent needs one decision from you before it can continue.',
      primaryAction: 'Answer',
      secondaryActions: [],
      needsYouReason: 'question',
    };
  }
  if (input.stuck) {
    return {
      state: 'needs-you',
      title: 'Stuck',
      sentence: 'The agent got stuck and is not making progress.',
      primaryAction: 'Get it unstuck',
      secondaryActions: [],
      needsYouReason: 'stuck',
    };
  }
  const base = BASE_BY_PIPELINE_STATE[input.pipelineState];
  const secondaryActions: string[] = [];
  if (base.state === 'working') secondaryActions.push('Tell the agent something');
  if (base.state === 'ready') secondaryActions.push('See what changed');
  return { ...base, secondaryActions, needsYouReason: base.needsYouReason ?? null };
}
