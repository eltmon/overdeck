import {
  readIssueRecordForWorkspaceSync,
  writeIssueRecordForWorkspaceSync,
  type PanIssueRecord,
} from '../pan-dir/record.js';

export function createMinimalIssueRecord(issueId: string): PanIssueRecord {
  const now = new Date().toISOString();
  return {
    issueId,
    schemaVersion: 2,
    created: now,
    updated: now,
    feedback: [],
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: now,
    },
    closeOut: {
      usage: {
        byStage: {},
        totals: {},
      },
      merges: [],
      ranOn: '',
    },
  };
}

export function writeSwarmFinalizedAt(workspacePath: string, issueId: string, finalizedAt: string): void {
  const normalizedIssueId = issueId.toUpperCase();
  const record = readIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId)
    ?? createMinimalIssueRecord(normalizedIssueId);
  writeIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId, {
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      finalizedAt,
    },
  });
}
