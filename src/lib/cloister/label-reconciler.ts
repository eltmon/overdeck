
export const STALE_PIPELINE_LABELS = ['verifying-on-main', 'planning', 'in-progress', 'in-review', 'in-planning'] as const;

export interface LabelReconcileCandidate {
  issueId: string;
  issueClosed: boolean;
  labels: string[];
  /** The issue carries `merged` and no in-flight phase label. */
  mergedWithoutInflight: boolean;
}

export interface LabelChange { issueId: string; op: 'add' | 'remove'; label: string }
