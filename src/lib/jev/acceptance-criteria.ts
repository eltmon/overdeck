/**
 * Advisory Jev semantic review of xBRIEF acceptance criteria (PAN-4372).
 *
 * `reviewAcceptanceCriteria` sends at most one `assess('jevAcceptanceCriteriaReview', …)`
 * request per plan (two Nouls per AC: observable?, compound?) and turns low/high answers into
 * `warn`-severity `QualityIssue`s. The request discloses the id and title text of every
 * acceptance criterion of the plan's non-cancelled items — nothing else. This is advisory only:
 * callers MUST NOT treat any result here as an error or let it change a command's exit code.
 * Always goes through `assess()` — never call `createJevClient` directly, which would bypass the
 * feature gate, memo and cost recording.
 */
import type { ChoiceResponse, NoulResponse, Questions, ScoreResponse } from '@typesafe-ai/sdk';
import { subItemsOf, type XBriefDocument } from '../xbrief/types.js';
import { OBSERVABLE_TERMS, type QualityIssue } from '../xbrief/quality-lint.js';
import { assess, type JevAssessOptions, type JevFailureReason } from './client.js';
import type { JevUnavailableReason } from './config.js';
import { appendAcceptanceCriteriaEvalLog, type AcceptanceCriteriaEvalRow } from './eval-log.js';
import {
  JEV_AC_COMPOUND_MAX_NOUL,
  JEV_AC_OBSERVABLE_MIN_NOUL,
  QUESTION_SET_VERSION,
  acceptanceCriteriaQuestions,
} from './questions.js';

export interface ReviewedCriterion {
  itemId: string;
  acId: string;
  title: string;
}

export interface AcceptanceCriteriaRequest {
  criteria: ReviewedCriterion[];
  state: { criteria: Record<string, string> };
  questions: Questions;
}

export type AcceptanceCriteriaReview =
  | { status: 'answered'; issues: QualityIssue[]; model: string }
  | { status: 'unavailable'; reason: JevUnavailableReason; issues: [] }
  | { status: 'failed'; reason: JevFailureReason; issues: [] }
  | { status: 'skipped'; reason: 'no-acceptance-criteria'; issues: [] };

/** Pure: collects non-cancelled ACs (first id wins) and builds the request. Used by the eval too. */
export function buildAcceptanceCriteriaRequest(doc: XBriefDocument): AcceptanceCriteriaRequest {
  const criteria: ReviewedCriterion[] = [];
  const seenAcIds = new Set<string>();
  const stateCriteria: Record<string, string> = {};

  for (const item of doc.plan.items) {
    if (item.status === 'cancelled') continue;
    for (const subItem of subItemsOf(item)) {
      if (subItem.metadata?.kind !== 'acceptance_criterion') continue;
      if (seenAcIds.has(subItem.id)) continue;
      seenAcIds.add(subItem.id);
      criteria.push({ itemId: item.id, acId: subItem.id, title: subItem.title });
      stateCriteria[subItem.id] = subItem.title;
    }
  }

  return {
    criteria,
    state: { criteria: stateCriteria },
    questions: acceptanceCriteriaQuestions(criteria.map(c => c.acId)),
  };
}

function noulValue(answer: NoulResponse | ScoreResponse | ChoiceResponse | undefined): number | null {
  return answer?.type === 'noul' ? answer.noul : null;
}

function keywordVerdict(title: string): 'observable' | 'not-observable' {
  const lowered = title.toLowerCase();
  return OBSERVABLE_TERMS.some(term => lowered.includes(term)) ? 'observable' : 'not-observable';
}

export type ReviewAcceptanceCriteriaOptions = JevAssessOptions & {
  /** Shadow eval log home directory override, for tests (wired by the eval-log writer, PAN-4372 WI-2). */
  evalLogHome?: string;
  /** Clock override, for tests. */
  now?: () => Date;
};

/** Advisory-only: never throws, never returns an `error`-severity issue. */
export async function reviewAcceptanceCriteria(
  doc: XBriefDocument,
  options: ReviewAcceptanceCriteriaOptions = {},
): Promise<AcceptanceCriteriaReview> {
  const request = buildAcceptanceCriteriaRequest(doc);
  if (request.criteria.length === 0) {
    return { status: 'skipped', reason: 'no-acceptance-criteria', issues: [] };
  }

  const result = await assess('jevAcceptanceCriteriaReview', request.state, request.questions, options);
  if (result.status === 'unavailable') return { status: 'unavailable', reason: result.reason, issues: [] };
  if (result.status === 'failed') return { status: 'failed', reason: result.reason, issues: [] };

  const issues: QualityIssue[] = [];
  const evalRows: AcceptanceCriteriaEvalRow[] = [];
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  for (const criterion of request.criteria) {
    const observable = noulValue(result.answers[`observable_${criterion.acId}`]);
    if (observable !== null && observable < JEV_AC_OBSERVABLE_MIN_NOUL) {
      issues.push({
        itemId: criterion.itemId,
        rule: 'ac-semantic-not-observable',
        severity: 'warn',
        message: `Acceptance criterion ${criterion.acId} may not describe observable behavior (Jev noul ${observable.toFixed(2)}; advisory)`,
      });
    }

    const compound = noulValue(result.answers[`compound_${criterion.acId}`]);
    if (compound !== null && compound > JEV_AC_COMPOUND_MAX_NOUL) {
      issues.push({
        itemId: criterion.itemId,
        rule: 'ac-semantic-compound',
        severity: 'warn',
        message: `Acceptance criterion ${criterion.acId} may describe more than one behavior (Jev noul ${compound.toFixed(2)}; advisory)`,
      });
    }

    evalRows.push({
      timestamp,
      planId: doc.plan.id,
      acId: criterion.acId,
      questionSetVersion: QUESTION_SET_VERSION,
      model: result.model,
      keywordVerdict: keywordVerdict(criterion.title),
      jevNoul: { observable, compound },
    });
  }

  await appendAcceptanceCriteriaEvalLog(evalRows, { home: options.evalLogHome, now: options.now });

  return { status: 'answered', issues, model: result.model };
}
