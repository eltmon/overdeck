/**
 * issueIndex — look an issue up by identifier in the store's `issuesRaw`
 * without a per-call scan. The map is rebuilt only when `issuesRaw` changes
 * identity, so many rows can call it inside store selectors.
 */

import type { Issue } from '../../types';

let indexSource: unknown = null;
let index = new Map<string, Issue>();

/** The issue whose identifier matches, case-insensitively, or undefined. */
export function issueByIdentifier(issuesRaw: unknown, identifier: string): Issue | undefined {
  if (issuesRaw !== indexSource) {
    indexSource = issuesRaw;
    index = new Map((Array.isArray(issuesRaw) ? issuesRaw as Issue[] : []).map((issue) => [issue.identifier.toLowerCase(), issue]));
  }
  return index.get(identifier.toLowerCase());
}
