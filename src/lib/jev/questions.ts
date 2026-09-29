/**
 * The single home for Jev question texts, criteria and thresholds (PAN-4369). Consumer issues
 * add their question sets here so every change bumps one version number.
 */
import { choice, noul, type Questions } from '@typesafe-ai/sdk';

/** Bump when any question text, criterion or threshold in this file changes (memo key component). */
export const QUESTION_SET_VERSION = 3;

/** Smoke question used by evals/jev-smoke.eval.ts. */
export const JEV_SMOKE_QUESTIONS = {
  asks_question: noul('Does the state end by asking the reader a question or requesting a decision?'),
} as const;
export const JEV_SMOKE_NOUL_THRESHOLD = 0.5;

export const TURN_END_KINDS = ['asks_operator', 'reports_complete', 'reports_blocked', 'progress_update', 'other'] as const;
export type TurnEndKind = (typeof TURN_END_KINDS)[number];
/** Below this Choice confidence the assessment is dropped and nothing is shown. */
export const TURN_END_MIN_CONFIDENCE = 0.7;
/** needs_operator_answer Noul at or above this reads as "needs an answer". */
export const TURN_END_NEEDS_ANSWER_THRESHOLD = 0.5;
/** Tail-trim of last_message: Jev loses accuracy on large, irrelevant state. */
export const TURN_END_STATE_MAX_CHARS = 6000;

export const TURN_END_QUESTIONS = {
  turn_end_kind: choice('Why did the agent stop at the end of `last_message`?', {
    asks_operator: 'The message ends by asking the operator a question or for a decision before it continues.',
    reports_complete: 'The message reports that the assigned work is finished.',
    reports_blocked: 'The message reports that the agent cannot continue because something outside it is failing or missing.',
    progress_update: 'The message reports partial progress and neither asks anything nor claims the work is finished.',
    other: 'None of the other options describes the end of the message.',
  }),
  needs_operator_answer: noul(
    'Does the end of `last_message` ask the operator a question or request a decision that must be answered before work continues?',
  ),
} as const;

/** Warn `ac-semantic-not-observable` when observable_<id> is below this (PAN-4372). */
export const JEV_AC_OBSERVABLE_MIN_NOUL = 0.5;
/** Warn `ac-semantic-compound` when compound_<id> is above this (PAN-4372). */
export const JEV_AC_COMPOUND_MAX_NOUL = 0.5;

/** Builds one observable/compound Noul pair per acceptance-criterion id, used by jev/acceptance-criteria.ts. */
export function acceptanceCriteriaQuestions(acIds: readonly string[]): Questions {
  const questions: Questions = {};
  for (const id of acIds) {
    questions[`observable_${id}`] = noul(
      `Does criteria[${JSON.stringify(id)}] describe a behavior a test or a person can observe, such as an output, stored state, UI change, exit code or emitted event?`,
    );
    questions[`compound_${id}`] = noul(
      `Does criteria[${JSON.stringify(id)}] describe more than one independent behavior?`,
    );
  }
  return questions;
}
