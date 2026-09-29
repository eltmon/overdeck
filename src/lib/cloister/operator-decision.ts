/**
 * PAN-4383: the operator-decision channel.
 *
 * A work agent blocked on a question only the operator can answer runs
 * `pan ask`, which appends `operator.decision-requested` to the issue's
 * pipeline journal. Needs-you, derived attention, God View and the parked
 * resolver all derive the open decision from the journal on read. Nothing
 * stores "open".
 *
 * Clearing rule: the most recent `operator.decision-requested` entry is open
 * until a later `operator.decision-answered` or `operator.decision-withdrawn`
 * entry carries the same `questionId`, or a later `verification.started`
 * entry shows `pan done` ran. A newer request supersedes an older one.
 *
 * Every read and write here follows the journal contract: a failure logs and
 * returns `null` or `false`, and never throws into the caller.
 *
 * This module must not import `../agent-enrichment.js` (import cycle). It
 * returns a structurally typed pending question instead.
 */
import { randomUUID } from 'node:crypto';

import { getAgentState } from '../agents/agent-state-read.js';
import {
  appendPipelineEntry,
  readPipelineJournal,
  type PipelineJournalEntry,
} from './pipeline-journal.js';

export const OPERATOR_DECISION_TOOL_ID_PREFIX = 'operator-decision:';

const ANSWER_MAX_CHARS = 2000;

export interface OperatorDecision {
  questionId: string;
  issueId: string;
  agentId: string;
  question: string;
  options: string[];
  context?: string;
  askedAt: string;
}

export type OperatorDecisionAnswerVia = 'dashboard-answer' | 'dashboard-message' | 'pan-tell';

export function isOperatorDecisionToolId(toolId: string | undefined | null): boolean {
  return typeof toolId === 'string' && toolId.startsWith(OPERATOR_DECISION_TOOL_ID_PREFIX);
}

function decisionFromRequest(entry: PipelineJournalEntry): OperatorDecision | null {
  const data = entry.data;
  if (!data) return null;
  const { questionId, agentId, question, options, context } = data;
  if (typeof questionId !== 'string' || typeof question !== 'string') return null;
  if (!Array.isArray(options) || !options.every((o) => typeof o === 'string')) return null;
  return {
    questionId,
    issueId: entry.issueId,
    agentId: typeof agentId === 'string' ? agentId : '',
    question,
    options: options as string[],
    ...(typeof context === 'string' ? { context } : {}),
    askedAt: entry.at,
  };
}

/** The open decision in `entries` (oldest first), or `null`. Pure. */
export function deriveOpenOperatorDecision(
  entries: readonly PipelineJournalEntry[],
): OperatorDecision | null {
  let open: OperatorDecision | null = null;
  for (const entry of entries) {
    switch (entry.type) {
      case 'operator.decision-requested': {
        const decision = decisionFromRequest(entry);
        if (decision) open = decision;
        break;
      }
      case 'operator.decision-answered':
      case 'operator.decision-withdrawn':
        if (open && typeof entry.data?.questionId === 'string' && entry.data.questionId === open.questionId) {
          open = null;
        }
        break;
      case 'verification.started':
        open = null;
        break;
      default:
        break;
    }
  }
  return open;
}

export function readOpenOperatorDecision(workspacePath: string): OperatorDecision | null {
  try {
    return deriveOpenOperatorDecision(readPipelineJournal(workspacePath));
  } catch (err) {
    console.warn(
      `[operator-decision] Could not read the open decision in ${workspacePath}: `
      + `${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export function requestOperatorDecision(
  workspacePath: string,
  input: { issueId: string; agentId: string; question: string; options: string[]; context?: string },
): OperatorDecision {
  const questionId = `od-${randomUUID().slice(0, 8)}`;
  const entry = appendPipelineEntry(workspacePath, {
    type: 'operator.decision-requested',
    issueId: input.issueId,
    source: 'pan-ask',
    data: {
      questionId,
      agentId: input.agentId,
      question: input.question,
      options: input.options,
      ...(input.context !== undefined ? { context: input.context } : {}),
    },
  });
  return {
    questionId,
    issueId: input.issueId,
    agentId: input.agentId,
    question: input.question,
    options: input.options,
    ...(input.context !== undefined ? { context: input.context } : {}),
    askedAt: entry.at,
  };
}

export function answerOperatorDecision(
  workspacePath: string,
  decision: OperatorDecision,
  answer: string,
  via: OperatorDecisionAnswerVia,
): void {
  appendPipelineEntry(workspacePath, {
    type: 'operator.decision-answered',
    issueId: decision.issueId,
    source: via,
    data: {
      questionId: decision.questionId,
      agentId: decision.agentId,
      answer: answer.slice(0, ANSWER_MAX_CHARS),
      via,
    },
  });
}

export function withdrawOperatorDecision(workspacePath: string, decision: OperatorDecision): void {
  appendPipelineEntry(workspacePath, {
    type: 'operator.decision-withdrawn',
    issueId: decision.issueId,
    source: 'pan-ask',
    data: { questionId: decision.questionId, agentId: decision.agentId },
  });
}

/**
 * The decision in the shape the enrichment's pending AskUserQuestion uses, so
 * the existing Needs-you panel, dialog, TTS and notification render it.
 */
export function operatorDecisionAsPendingQuestion(d: OperatorDecision): {
  toolId: string;
  timestamp: string;
  questions: Array<{
    question: string;
    header: string;
    multiSelect: boolean;
    options: Array<{ label: string; description: string }>;
  }>;
} {
  return {
    toolId: `${OPERATOR_DECISION_TOOL_ID_PREFIX}${d.questionId}`,
    timestamp: d.askedAt,
    questions: [{
      question: d.context ? `${d.question}\n\n${d.context}` : d.question,
      header: 'Decision',
      multiSelect: false,
      options: d.options.map((label) => ({ label, description: '' })),
    }],
  };
}

/**
 * Decision 4: a delivered operator message to the asking agent answers its
 * open decision. Returns true only when it appended the answered entry.
 */
export function closeOpenDecisionOnOperatorMessage(
  agentId: string,
  message: string,
  via: OperatorDecisionAnswerVia,
): boolean {
  try {
    const normalizedId = agentId.toLowerCase();
    const workspace = getAgentState(normalizedId)?.workspace;
    if (!workspace) return false;
    const decision = readOpenOperatorDecision(workspace);
    if (!decision || decision.agentId.toLowerCase() !== normalizedId) return false;
    answerOperatorDecision(workspace, decision, message, via);
    return true;
  } catch (err) {
    console.warn(
      `[operator-decision] Could not close the open decision for ${agentId}: `
      + `${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
