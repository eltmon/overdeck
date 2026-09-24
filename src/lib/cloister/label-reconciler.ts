import { removeIssueLabel, addIssueLabel } from '../backlog/label-ops.js';

export const STALE_PIPELINE_LABELS = ['verifying-on-main', 'planning', 'in-progress', 'in-review', 'in-planning'] as const;

export interface LabelReconcileCandidate {
  issueId: string;
  issueClosed: boolean;
  labels: string[];
  /** The issue carries `merged` and no in-flight phase label. */
  mergedWithoutInflight: boolean;
}

export interface LabelChange { issueId: string; op: 'add' | 'remove'; label: string }

/**
 * PAN-3917: terminality is the tracker's own word — the issue is closed, or it
 * carries `merged` with no in-flight phase label. The old third source, a
 * per-issue record's `closedOut` and merge verdict, is gone; close-out completion is
 * the closed issue itself.
 */
export function planLabelReconciliation(candidate: LabelReconcileCandidate): LabelChange[] {
  const terminal = candidate.issueClosed || candidate.mergedWithoutInflight;
  if (!terminal) return [];
  const changes: LabelChange[] = STALE_PIPELINE_LABELS
    .filter(label => candidate.labels.includes(label))
    .map(label => ({ issueId: candidate.issueId, op: 'remove', label }));
  if (!candidate.issueClosed && !candidate.labels.includes('needs-close-out')) {
    changes.push({ issueId: candidate.issueId, op: 'add', label: 'needs-close-out' });
  }
  return changes;
}

export async function reconcilePipelineLabels(
  candidates: LabelReconcileCandidate[],
  options: { dryRun?: boolean; maxIssues?: number } = {},
  edit: (change: LabelChange) => Promise<void> = change => change.op === 'add' ? addIssueLabel(change.issueId, change.label) : removeIssueLabel(change.issueId, change.label),
): Promise<LabelChange[]> {
  const changes = candidates.slice(0, options.maxIssues ?? candidates.length).flatMap(planLabelReconciliation);
  if (!options.dryRun) for (const change of changes) await edit(change);
  return changes;
}
