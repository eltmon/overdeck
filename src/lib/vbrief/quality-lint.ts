import type { VBriefDocument, VBriefItem, VBriefSubItem } from './types.js';

export interface QualityIssue {
  itemId: string | null;
  rule: string;
  message: string;
  severity: 'error' | 'warn';
}

export const PLACEHOLDER_AC_PATTERNS = ['acceptance criteria for', 'copy from parent', 'copy from specification', 'placeholder', 'refine from parent', 'tbd', 'to be defined', 'to refine', 'todo'];
export const DOCS_ONLY_AC_PATTERNS = ['docs updated', 'documentation updated', 'readme updated', 'update docs', 'update documentation', 'update readme'];
export const VAGUE_AC_PATTERNS = ['displays a message', 'handles errors', 'is implemented', 'is updated', 'passes tests', 'shows a message', 'updates the ui', 'works as expected', 'make it work', 'implement the feature', 'change the code', 'update the code'];
export const OBSERVABLE_TERMS = ['blocks', 'creates', 'deletes', 'displays', 'emits', 'fails', 'persists', 'records', 'redirects', 'rejects', 'renders', 'returns', 'saves', 'shows', 'stores', 'updates', 'validates', 'exits', 'prints', 'logs', 'throws', 'spawns', 'opens', 'closes', 'sends', 'receives', 'resolves', 'refuses', 'marks', 'syncs', 'commits', 'pushes', 'when ', 'given ', 'then '];

const BANNED_AC_PATTERNS = [
  ...PLACEHOLDER_AC_PATTERNS,
  ...DOCS_ONLY_AC_PATTERNS,
  ...VAGUE_AC_PATTERNS,
];

function issue(itemId: string | null, rule: string, message: string): QualityIssue {
  return { itemId, rule, message, severity: 'error' };
}

function acceptanceCriteria(item: VBriefItem): VBriefSubItem[] {
  return (item.subItems ?? []).filter(subItem => subItem.metadata?.kind === 'acceptance_criterion');
}

function hasAcJustification(item: VBriefItem): boolean {
  const value = item.metadata?.acJustification;
  return typeof value === 'string' && value.trim().length > 0;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function lintItem(item: VBriefItem): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const acs = acceptanceCriteria(item);

  if (acs.length === 0) {
    issues.push(issue(item.id, 'ac-missing', `Item ${item.id} has no acceptance criteria`));
  } else if (!hasAcJustification(item) && (acs.length < 2 || acs.length > 5)) {
    issues.push(issue(item.id, 'ac-count', `Item ${item.id} has ${acs.length} acceptance criterion; expected 2-5 or metadata.acJustification`));
  }

  for (const ac of acs) {
    const title = ac.title.toLowerCase();
    const banned = BANNED_AC_PATTERNS.find(pattern => title.includes(pattern));
    if (banned) {
      issues.push(issue(item.id, 'ac-banned-phrase', `Acceptance criterion ${ac.id} contains banned phrase "${banned}"`));
    }
    if (!OBSERVABLE_TERMS.some(term => title.includes(term))) {
      issues.push(issue(item.id, 'ac-not-observable', `Acceptance criterion ${ac.id} does not name observable behavior`));
    }
  }

  const action = item.narrative?.Action?.trim() ?? '';
  if (!action || wordCount(action) < 8) {
    issues.push(issue(item.id, 'action-too-thin', `Item ${item.id} narrative.Action must contain at least 8 words`));
  }

  return issues;
}

export function lintPlanQuality(doc: VBriefDocument): QualityIssue[] {
  return doc.plan.items.flatMap(item => item.status === 'cancelled' ? [] : lintItem(item));
}
