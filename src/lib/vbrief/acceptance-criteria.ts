/**
 * vBRIEF Acceptance Criteria Extraction & Validation
 *
 * Shared utilities for extracting, formatting, and validating acceptance
 * criteria from vBRIEF plan documents. Used by specialist prompts,
 * verification gates, and completion checks.
 */

import { readWorkspacePlan } from './io.js';
import type { VBriefDocument, VBriefItem, VBriefItemStatus, VBriefSubItem } from './types.js';

/** A single acceptance criterion with its parent task context. */
export interface AcceptanceCriterion {
  /** Parent item ID (e.g., "create-ac-module") */
  itemId: string;
  /** Parent item title */
  itemTitle: string;
  /** Sub-item ID (e.g., "create-ac-module.extract-fn") */
  subItemId: string;
  /** AC description */
  title: string;
  /** Current status */
  status: VBriefItemStatus;
}

/** Result of checking whether all AC are completed. */
export interface ACCompletionResult {
  allCompleted: boolean;
  incomplete: AcceptanceCriterion[];
}

/**
 * Extract all acceptance criteria from a vBRIEF plan.
 *
 * Reads plan.vbrief.json from the workspace and returns all subItems
 * where metadata.kind === 'acceptance_criterion', enriched with parent
 * task context.
 *
 * @returns Array of acceptance criteria, or empty array if no plan exists
 *          or no AC are found (legacy workspace compatibility).
 */
export function extractAcceptanceCriteria(workspacePath: string): AcceptanceCriterion[] {
  const doc = readWorkspacePlan(workspacePath);
  if (!doc) return [];
  return extractACFromDocument(doc);
}

/**
 * Extract AC from an already-loaded document (avoids re-reading the file).
 */
function isDeferredOrCancelledItem(item: VBriefItem): boolean {
  const status = String(item.status);
  return status === 'cancelled'
    || status === 'deferred'
    || item.metadata?.deferred === true;
}

export function extractACFromDocument(doc: VBriefDocument): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];

  for (const item of doc.plan.items) {
    if (isDeferredOrCancelledItem(item)) continue;
    if (!item.subItems) continue;
    for (const sub of item.subItems) {
      if (sub.metadata?.kind === 'acceptance_criterion') {
        criteria.push({
          itemId: item.id,
          itemTitle: item.title,
          subItemId: sub.id,
          title: sub.title,
          status: sub.status,
        });
      }
    }
  }

  return criteria;
}

/**
 * Format acceptance criteria as a markdown checklist grouped by parent task.
 *
 * Output example:
 * ```
 * ### Create vBRIEF acceptance criteria extraction module
 * - [x] extractAcceptanceCriteria reads plan.vbrief.json and returns AC subItems
 * - [ ] formatAcceptanceCriteria produces markdown checklist grouped by parent task
 * ```
 *
 * @returns Formatted markdown string, or empty string if no criteria.
 */
export function formatAcceptanceCriteria(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return '';

  // Group by parent item
  const groups = new Map<string, { title: string; items: AcceptanceCriterion[] }>();
  for (const ac of criteria) {
    let group = groups.get(ac.itemId);
    if (!group) {
      group = { title: ac.itemTitle, items: [] };
      groups.set(ac.itemId, group);
    }
    group.items.push(ac);
  }

  const lines: string[] = [];
  for (const group of Array.from(groups.values())) {
    lines.push(`### ${group.title}`);
    for (const ac of group.items) {
      const check = ac.status === 'completed' ? 'x' : ' ';
      lines.push(`- [${check}] ${ac.title}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Check whether all acceptance criteria in a workspace plan are completed.
 *
 * @returns { allCompleted: true, incomplete: [] } when all AC are done or
 *          no plan/AC exist (legacy workspace compatibility).
 */
export function checkAllCriteriaCompleted(workspacePath: string): ACCompletionResult {
  const criteria = extractAcceptanceCriteria(workspacePath);
  if (criteria.length === 0) return { allCompleted: true, incomplete: [] };

  const incomplete = criteria.filter(
    ac => ac.status !== 'completed' && ac.status !== 'cancelled'
  );

  return { allCompleted: incomplete.length === 0, incomplete };
}
