/**
 * xBRIEF Acceptance Criteria Extraction & Validation
 *
 * Shared utilities for extracting, formatting, and validating acceptance
 * criteria from xBRIEF plan documents. Used by specialist prompts,
 * verification gates, and completion checks.
 */

import { Effect } from 'effect';
import { readWorkspacePlanSync, readWorkspacePlan, type XBriefReadError } from './io.js';
import { subItemsOf, type XBriefDocument, type XBriefItem, type XBriefItemStatus } from './types.js';

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
  status: XBriefItemStatus;
}

/** Result of checking whether all AC are completed. */
export interface ACCompletionResult {
  allCompleted: boolean;
  incomplete: AcceptanceCriterion[];
}

export interface ItemACStatus {
  itemId: string;
  itemTitle: string;
  completed: number;
  pending: number;
  total: number;
  criteria: AcceptanceCriterion[];
}

export interface XBriefACStatus {
  allCompleted: boolean;
  items: ItemACStatus[];
  totalCompleted: number;
  totalPending: number;
  totalCount: number;
}

export function getXBriefACStatus(workspacePath: string): XBriefACStatus | null {
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) return null;
  const allCriteria = extractACFromDocument(doc);
  if (allCriteria.length === 0) return null;
  const itemMap = new Map<string, ItemACStatus>();
  for (const ac of allCriteria) {
    const item = itemMap.get(ac.itemId) ?? {
      itemId: ac.itemId, itemTitle: ac.itemTitle, completed: 0, pending: 0, total: 0, criteria: [],
    };
    item.total++;
    item.criteria.push(ac);
    if (ac.status === 'completed' || ac.status === 'cancelled') item.completed++;
    else item.pending++;
    itemMap.set(ac.itemId, item);
  }
  const items = [...itemMap.values()];
  const totalCompleted = items.reduce((sum, item) => sum + item.completed, 0);
  const totalPending = items.reduce((sum, item) => sum + item.pending, 0);
  return { allCompleted: totalPending === 0, items, totalCompleted, totalPending, totalCount: totalCompleted + totalPending };
}

/**
 * Extract AC from an already-loaded document (avoids re-reading the file).
 */
function isDeferredOrCancelledItem(item: XBriefItem): boolean {
  const status = String(item.status);
  return status === 'cancelled'
    || status === 'deferred'
    || item.metadata?.deferred === true;
}

export function extractACFromDocument(doc: XBriefDocument): AcceptanceCriterion[] {
  const criteria: AcceptanceCriterion[] = [];

  for (const item of doc.plan.items) {
    if (isDeferredOrCancelledItem(item)) continue;
    for (const sub of subItemsOf(item)) {
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
 * ### Create xBRIEF acceptance criteria extraction module
 * - [x] extractAcceptanceCriteria reads the merged xBRIEF and returns AC child items
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
