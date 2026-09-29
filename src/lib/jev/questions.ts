/**
 * The single home for Jev question texts, criteria and thresholds (PAN-4369). Consumer issues
 * add their question sets here so every change bumps one version number.
 */
import { noul } from '@typesafe-ai/sdk';

/** Bump when any question text, criterion or threshold in this file changes (memo key component). */
export const QUESTION_SET_VERSION = 1;

/** Smoke question used by evals/jev-smoke.eval.ts. */
export const JEV_SMOKE_QUESTIONS = {
  asks_question: noul('Does the state end by asking the reader a question or requesting a decision?'),
} as const;
export const JEV_SMOKE_NOUL_THRESHOLD = 0.5;
