/**
 * The single home for Jev question texts, criteria and thresholds (PAN-4369). Consumer issues
 * add their question sets here so every change bumps one version number.
 */
import { choice, noul } from '@typesafe-ai/sdk';

/** Bump when any question text, criterion or threshold in this file changes (memo key component). */
export const QUESTION_SET_VERSION = 2;

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
