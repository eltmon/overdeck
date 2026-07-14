import type { PanIssueRecord } from './record.js';

/** Return an issue record at the same task state it had immediately after planning. */
export function clearTaskProgress(record: PanIssueRecord): PanIssueRecord {
  return {
    ...record,
    statusOverrides: {},
    tasks: { sequence: 0, claims: {}, claimHistory: [] },
  };
}
