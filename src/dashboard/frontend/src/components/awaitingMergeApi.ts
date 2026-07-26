/**
 * Merge-gate API helpers, moved verbatim out of AwaitingMergePage.tsx.
 *
 * PAN-1696: the page is a baselined god file that the file-size guard requires
 * to shrink, not grow. Hosting the merge-train section there needed three
 * lines, so these self-contained fetch wrappers moved here unchanged to pay
 * for them. No behavior change — pure relocation.
 */
import type { WorkspaceContainerStatus, WorkspacePendingOperation, WorkspaceStackHealth } from './CommandDeck/ZoneCOverviewTabs/queries';

export interface WorkspaceInfo {
  exists?: boolean;
  frontendUrl?: string;
  apiUrl?: string;
  mrUrl?: string;
  stackHealth?: WorkspaceStackHealth;
  containers?: Record<string, WorkspaceContainerStatus> | null;
  pendingOperation?: WorkspacePendingOperation | null;
}

export interface UatContext {
  acceptanceCriteria?: Array<{ id: string; title: string; status: string; itemId: string; itemTitle: string }>;
  deliverables?: Array<{ id: string; title: string; status: string; action?: string }>;
  proposal?: string | null;
  changedFiles?: Array<{ path: string; status: string; additions: number; deletions: number }>;
  changedFilesTotal?: number;
  changedFilesOmitted?: number;
  diffStat?: { stat: string; truncated: boolean } | null;
  source?: { plan?: 'vbrief' | 'none'; files?: 'git' | 'none' };
}

export async function fetchWorkspace(issueId: string): Promise<WorkspaceInfo> {
  const res = await fetch(`/api/workspaces/${issueId}`);
  if (!res.ok) return {};
  return res.json();
}

export async function fetchUatContext(issueId: string): Promise<UatContext> {
  const res = await fetch(`/api/workspaces/${issueId}/uat-context`);
  if (!res.ok) return {};
  return res.json();
}

export async function rebuildStack(issueId: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${issueId}/rebuild-stack`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Rebuild failed (${res.status})`);
  }
}

export async function forgeMerge(issueId: string): Promise<unknown> {
  const res = await fetch(`/api/issues/${issueId}/forge-merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Merge failed (${res.status})`);
  }
  return res.json();
}

export async function forgeApprove(issueId: string): Promise<unknown> {
  const res = await fetch(`/api/issues/${issueId}/forge-approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Approve failed (${res.status})`);
  }
  return res.json();
}

export async function mergeIssue(issueId: string): Promise<unknown> {
  const res = await fetch(`/api/issues/${issueId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Merge failed (${res.status})`);
  }
  return res.json();
}
