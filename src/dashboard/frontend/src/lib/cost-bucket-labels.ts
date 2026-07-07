const COST_BUCKET_LABELS: Record<string, string> = {
  CONVERSATIONS: 'Conversations',
  FLYWHEEL: 'Flywheel orchestration',
  UNATTRIBUTED: 'No issue — unattributed',
  UNKNOWN: 'No issue — unattributed',
};

export function costBucketLabel(issueId: string): string {
  return COST_BUCKET_LABELS[issueId] ?? issueId;
}
