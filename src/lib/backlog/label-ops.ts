import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { PARKED_LABEL, VETOED_LABEL, BLOCKS_MAIN_LABEL, READY_LABEL, RELEASED_LABEL, OBJECTION_LABEL } from './pickup.js';

const execAsync = promisify(exec);

export { PARKED_LABEL, VETOED_LABEL, BLOCKS_MAIN_LABEL, READY_LABEL, RELEASED_LABEL, OBJECTION_LABEL };

/**
 * Add or remove a GitHub label on an issue. Non-GitHub issues are silently
 * skipped; the `|| true` keeps a missing-label / already-applied no-op non-fatal.
 */
async function editIssueLabel(issueId: string, op: 'add' | 'remove', label: string): Promise<void> {
  const resolution = resolveGitHubIssueSync(issueId);
  if (!resolution.isGitHub) return;
  const { owner, repo, number } = resolution;
  const flag = op === 'add' ? '--add-label' : '--remove-label';
  await execAsync(`gh issue edit ${number} --repo ${owner}/${repo} ${flag} "${label}" 2>/dev/null || true`);
}

export const addIssueLabel = (issueId: string, label: string): Promise<void> => editIssueLabel(issueId, 'add', label);
export const removeIssueLabel = (issueId: string, label: string): Promise<void> => editIssueLabel(issueId, 'remove', label);

// PAN-2006 pipeline-state labels.
export const applyIssueParkedLabel = (id: string): Promise<void> => addIssueLabel(id, PARKED_LABEL);
export const removeIssueParkedLabel = (id: string): Promise<void> => removeIssueLabel(id, PARKED_LABEL);
export const applyIssueVetoedLabel = (id: string): Promise<void> => addIssueLabel(id, VETOED_LABEL);
export const removeIssueVetoedLabel = (id: string): Promise<void> => removeIssueLabel(id, VETOED_LABEL);
export const applyIssueBlocksMainLabel = (id: string): Promise<void> => addIssueLabel(id, BLOCKS_MAIN_LABEL);
export const removeIssueBlocksMainLabel = (id: string): Promise<void> => removeIssueLabel(id, BLOCKS_MAIN_LABEL);
export const applyIssueReadyLabel = (id: string): Promise<void> => addIssueLabel(id, READY_LABEL);
export const removeIssueReadyLabel = (id: string): Promise<void> => removeIssueLabel(id, READY_LABEL);

// PAN-2059 pickup-gate labels.
export const applyIssueReleasedLabel = (id: string): Promise<void> => addIssueLabel(id, RELEASED_LABEL);
export const removeIssueReleasedLabel = (id: string): Promise<void> => removeIssueLabel(id, RELEASED_LABEL);
export const applyIssueObjectionLabel = (id: string): Promise<void> => addIssueLabel(id, OBJECTION_LABEL);
export const removeIssueObjectionLabel = (id: string): Promise<void> => removeIssueLabel(id, OBJECTION_LABEL);
