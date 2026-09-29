/**
 * Turn-end classification: labels why an agent's last message ended its turn (PAN-4371).
 * Observability only — advisory, never blocks or drives control flow.
 */
import { assess, type JevAssessOptions } from './client.js';
import {
  TURN_END_MIN_CONFIDENCE,
  TURN_END_NEEDS_ANSWER_THRESHOLD,
  TURN_END_QUESTIONS,
  TURN_END_STATE_MAX_CHARS,
  type TurnEndKind,
} from './questions.js';

export interface TurnEndAssessment {
  kind: TurnEndKind;
  confidence: number;
  needsAnswer: boolean;
  model: string;
}

export interface TurnEndInput {
  agentId: string;
  role: string;
  harness: string;
  lastAssistantText: string;
  messageId: string;
}

export type TurnEndOutcome =
  | { status: 'assessed'; assessment: TurnEndAssessment }
  | { status: 'unassessed'; reason: string };

/** Keeps the last TURN_END_STATE_MAX_CHARS characters — Jev loses accuracy on large, irrelevant state. */
export function buildTurnEndState(role: string, text: string): { role: string; last_message: string } {
  return { role, last_message: text.slice(-TURN_END_STATE_MAX_CHARS) };
}

/** Never throws: unavailable/failed both map to `unassessed`. */
export async function assessTurnEnd(input: TurnEndInput, opts: JevAssessOptions = {}): Promise<TurnEndOutcome> {
  if (input.lastAssistantText.trim().length === 0) {
    return { status: 'unassessed', reason: 'empty-message' };
  }

  const state = buildTurnEndState(input.role, input.lastAssistantText);
  const result = await assess('jevTurnEndAssessment', state, TURN_END_QUESTIONS, opts);

  if (result.status === 'unavailable') return { status: 'unassessed', reason: result.reason };
  if (result.status === 'failed') return { status: 'unassessed', reason: result.reason };

  return {
    status: 'assessed',
    assessment: {
      kind: result.answers.turn_end_kind.choice,
      confidence: result.answers.turn_end_kind.confidence,
      needsAnswer: result.answers.needs_operator_answer.noul >= TURN_END_NEEDS_ANSWER_THRESHOLD,
      model: result.model,
    },
  };
}

/** Applies TURN_END_MIN_CONFIDENCE — the only place the threshold is enforced. */
export function toTurnEndView(outcome: TurnEndOutcome): TurnEndAssessment | undefined {
  if (outcome.status !== 'assessed') return undefined;
  return outcome.assessment.confidence >= TURN_END_MIN_CONFIDENCE ? outcome.assessment : undefined;
}

const TURN_END_KIND_SUMMARY: Record<TurnEndKind, string> = {
  asks_operator: 'asked the operator',
  reports_complete: 'done',
  reports_blocked: 'blocked',
  progress_update: 'progress update',
  other: 'other',
};

export function formatTurnEndSummary(view: TurnEndAssessment): string {
  return `last message reads as: ${TURN_END_KIND_SUMMARY[view.kind]} (${view.confidence.toFixed(2)})`;
}
