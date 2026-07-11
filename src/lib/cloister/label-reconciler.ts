import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { removeIssueLabel, addIssueLabel } from '../backlog/label-ops.js';
import { listProjectsSync, getIssuePrefix } from '../projects.js';
import { readIssueRecordForWorkspaceSync } from '../pan-dir/record.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execAsync = promisify(exec);
export const STALE_PIPELINE_LABELS = ['verifying-on-main', 'planning', 'in-progress', 'in-review', 'in-planning'] as const;

export interface LabelReconcileCandidate {
  issueId: string;
  issueClosed: boolean;
  labels: string[];
  recordTerminal: boolean;
  mergedWithoutInflight: boolean;
  closeOutComplete: boolean;
}

export interface LabelChange { issueId: string; op: 'add' | 'remove'; label: string }

export function planLabelReconciliation(candidate: LabelReconcileCandidate): LabelChange[] {
  const terminal = candidate.recordTerminal || candidate.issueClosed || candidate.mergedWithoutInflight;
  if (!terminal) return [];
  const changes: LabelChange[] = STALE_PIPELINE_LABELS
    .filter(label => candidate.labels.includes(label))
    .map(label => ({ issueId: candidate.issueId, op: 'remove', label }));
  if (!candidate.issueClosed && !candidate.closeOutComplete && !candidate.labels.includes('needs-close-out')) {
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

export async function collectLabelReconcileCandidates(): Promise<LabelReconcileCandidate[]> {
  const candidates: LabelReconcileCandidate[] = [];
  for (const { config } of listProjectsSync()) {
    const prefix = getIssuePrefix(config);
    if (!prefix || !config.path) continue;
    const resolution = resolveGitHubIssueSync(`${prefix}-1`);
    if (!resolution.isGitHub) continue;
    const { stdout } = await execAsync(`gh issue list --repo ${resolution.owner}/${resolution.repo} --state all --limit 1000 --json number,state,labels`);
    const rows = JSON.parse(stdout) as Array<{ number: number; state: string; labels: Array<{ name: string }> }>;
    for (const row of rows) {
      const issueId = `${prefix.toUpperCase()}-${row.number}`;
      const labels = row.labels.map(label => label.name);
      const record = readIssueRecordForWorkspaceSync(config.path, issueId);
      const closeOutComplete = Boolean(record?.closeOut?.closedAt);
      const recordTerminal = closeOutComplete || record?.pipeline?.mergeStatus === 'merged';
      const mergedWithoutInflight = labels.includes('merged') && !labels.some(label => ['planning', 'in-progress', 'in-review', 'in-planning'].includes(label));
      candidates.push({ issueId, issueClosed: row.state.toLowerCase() === 'closed', labels, recordTerminal, mergedWithoutInflight, closeOutComplete });
    }
  }
  return candidates;
}

export async function reconcilePipelineLabelsPatrol(): Promise<string[]> {
  const changes = await reconcilePipelineLabels(await collectLabelReconcileCandidates(), { maxIssues: 20 });
  return changes.map(change => `[labels] ${change.op} ${change.label} on ${change.issueId}`);
}
