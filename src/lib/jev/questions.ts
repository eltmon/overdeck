/**
 * The single home for Jev question texts, criteria and thresholds (PAN-4369). Consumer issues
 * add their question sets here so every change bumps one version number.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

/** Bump when any question text, criterion or threshold in this file changes (memo key component). */
export const QUESTION_SET_VERSION = 2;

/** Smoke question used by evals/jev-smoke.eval.ts. */
export const JEV_SMOKE_QUESTIONS = {
  asks_question: noul('Does the state end by asking the reader a question or requesting a decision?'),
} as const;
export const JEV_SMOKE_NOUL_THRESHOLD = 0.5;

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
