/**
 * AwaitingMergePage — single-purpose human merge gate.
 *
 * Lists every issue with `readyForMerge: true` and offers two actions per row:
 *   1. Open the workspace's frontendUrl in a new tab so the user can UAT.
 *   2. POST to /api/issues/:id/merge once UAT passes.
 *
 * This is the only page the user needs to look at while `/all-up` runs the
 * Fix-All flywheel. See FIX-ALL-PRD.md.
 */

import { useMemo, useState } from 'react';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge, ExternalLink, Loader2, CheckCircle, AlertTriangle, ShieldAlert, XCircle, GitPullRequest, MessageSquare, FilePenLine, PenLine, ChevronDown, ChevronUp, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardStore, selectAwaitingMerge, selectBlockedFromMerge, selectOpenMergeRequests, selectIssues } from '../lib/store';
import { useConfirm } from './DialogProvider';
import type { Issue } from '../types';

interface WorkspaceInfo {
  exists?: boolean;
  frontendUrl?: string;
  mrUrl?: string;
}

async function fetchWorkspace(issueId: string): Promise<WorkspaceInfo> {
  const res = await fetch(`/api/workspaces/${issueId}`);
  if (!res.ok) return {};
  return res.json();
}

async function forgeApprove(issueId: string): Promise<unknown> {
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

async function mergeIssue(issueId: string): Promise<unknown> {
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

export function AwaitingMergePage() {
  const queryClient = useQueryClient();
  const awaiting = useDashboardStore(selectAwaitingMerge);
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];

  // Index issues by id (case-insensitive) for quick lookup
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const i of issues) {
      if (i?.identifier) map.set(i.identifier.toLowerCase(), i);
      if (i?.id) map.set(String(i.id).toLowerCase(), i);
    }
    return map;
  }, [issues]);

  // Priority: PAN (core substrate) first, then other projects, oldest-ready within each tier.
  // Filter cancelled issues — they should never appear in the merge queue.
  const sortedAwaiting = useMemo(() => {
    const projectPriority = (id: string): number => {
      const prefix = id.toUpperCase().split('-')[0];
      if (prefix === 'PAN') return 0;
      if (prefix === 'KRUX') return 1;
      return 2; // MIN, AUR, MYN, etc.
    };
    return awaiting
      .filter((rs) => {
        const issue = issuesById.get(rs.issueId.toLowerCase());
        // Filter out issues the tracker has marked as cancelled/wontfix.
        if (issue?.state === 'canceled' || issue?.state === 'cancelled') return false;
        // Filter out issues that are 'done' with a failed merge OR a 'merged' tracker label —
        // they were completed outside Panopticon (PR merged manually on GitHub).
        // Only keep 'done' issues whose Panopticon mergeStatus is still non-failed with no
        // 'merged' label (the PR is genuinely open and waiting for a merge click).
        if (issue?.state === 'done') {
          if (rs.mergeStatus === 'failed' || issue?.mergeStatus === 'failed') return false;
          if (Array.isArray(issue?.labels) && issue.labels.includes('merged')) return false;
        }
        // PAN-905: explicit defense-in-depth — exclude anything with GitHub-native blockers.
        if ((rs.blockerReasons?.length ?? 0) > 0) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = projectPriority(a.issueId);
        const pb = projectPriority(b.issueId);
        if (pa !== pb) return pa - pb;
        // Within the same priority tier: oldest-ready first (FIFO)
        return (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
      });
  }, [awaiting, issuesById]);

  const blocked = useDashboardStore(selectBlockedFromMerge);
  const openMergeRequests = useDashboardStore(selectOpenMergeRequests);

  // One workspace fetch per ready issue (parallel via useQueries)
  const workspaceQueries = useQueries({
    queries: sortedAwaiting.map((rs) => ({
      queryKey: ['workspace', rs.issueId],
      queryFn: () => fetchWorkspace(rs.issueId),
      staleTime: 30_000,
    })),
  });

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto p-6">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <GitMerge className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">
              Awaiting Merge
            </h1>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-accent text-muted-foreground">
              {sortedAwaiting.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Issues that have passed review and test and are waiting for a human
            UAT + merge click. Open the frontend link to verify, then merge.
          </p>
        </header>

        {sortedAwaiting.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-3">
            {sortedAwaiting.map((rs, idx) => {
              const issue = issuesById.get(rs.issueId.toLowerCase());
              const ws = workspaceQueries[idx]?.data;
              return (
                <AwaitingMergeRow
                  key={rs.issueId}
                  issueId={rs.issueId}
                  title={issue?.title ?? rs.issueId}
                  identifier={issue?.identifier ?? rs.issueId}
                  trackerUrl={issue?.url}
                  frontendUrl={ws?.frontendUrl}
                  prUrl={rs.prUrl ?? ws?.mrUrl}
                  updatedAt={rs.updatedAt}
                  mergeStatus={rs.mergeStatus}
                  onMerged={() => {
                    queryClient.invalidateQueries({
                      queryKey: ['workspace', rs.issueId],
                    });
                  }}
                />
              );
            })}
          </ul>
        )}

        {/* Blocked from merge */}
        {blocked.length > 0 && (
          <div className="mt-10">
            <header className="mb-4">
              <div className="flex items-center gap-3 mb-1">
                <ShieldAlert className="w-5 h-5 text-destructive" />
                <h2 className="text-lg font-semibold text-foreground">Blocked from Merge</h2>
                <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                  {blocked.length}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                These issues were ready to merge but GitHub is blocking them.
                Resolve the blocker on GitHub and the issue will re-enter the queue automatically.
              </p>
            </header>
            <ul className="space-y-3">
              {blocked.map((rs) => {
                const issue = issuesById.get(rs.issueId.toLowerCase());
                return (
                  <BlockedMergeRow
                    key={rs.issueId}
                    issueId={rs.issueId}
                    title={issue?.title ?? rs.issueId}
                    identifier={issue?.identifier ?? rs.issueId}
                    trackerUrl={issue?.url}
                    blockerReasons={rs.blockerReasons ?? []}
                    updatedAt={rs.updatedAt}
                  />
                );
              })}
            </ul>
          </div>
        )}
        {/* Open merge requests (not yet ready for merge) */}
        {openMergeRequests.length > 0 && (
          <div className="mt-10">
            <header className="mb-4">
              <div className="flex items-center gap-3 mb-1">
                <GitPullRequest className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold text-foreground">Open Merge Requests</h2>
                <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-accent text-muted-foreground">
                  {openMergeRequests.length}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                PRs/MRs that have been created but are still going through review and testing.
                Approve or review them early on GitHub/GitLab.
              </p>
            </header>
            <ul className="space-y-3">
              {openMergeRequests.map((rs) => {
                const issue = issuesById.get(rs.issueId.toLowerCase());
                return (
                  <OpenMergeRequestRow
                    key={rs.issueId}
                    issueId={rs.issueId}
                    identifier={issue?.identifier ?? rs.issueId}
                    title={issue?.title ?? rs.issueId}
                    trackerUrl={issue?.url}
                    prUrl={rs.prUrl}
                    reviewStatus={rs.reviewStatus}
                    testStatus={rs.testStatus}
                    verificationStatus={rs.verificationStatus}
                    updatedAt={rs.updatedAt}
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-border rounded-lg p-10 text-center">
      <CheckCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
      <p className="text-sm text-foreground mb-1">Nothing awaiting merge.</p>
      <p className="text-xs text-muted-foreground">
        The flywheel is idling — kick off more work or run <code>/all-up</code>.
      </p>
    </div>
  );
}

interface RowProps {
  issueId: string;
  identifier: string;
  title: string;
  trackerUrl?: string;
  frontendUrl?: string;
  prUrl?: string;
  updatedAt?: string;
  mergeStatus?: string;
  onMerged: () => void;
}

function AwaitingMergeRow({
  issueId,
  identifier,
  title,
  trackerUrl,
  frontendUrl,
  prUrl,
  updatedAt,
  mergeStatus,
  onMerged,
}: RowProps) {
  const mergeMutation = useMutation({
    mutationFn: () => mergeIssue(issueId),
    onSuccess: () => {
      toast.success(`Merge started for ${identifier}`);
      onMerged();
    },
    onError: (err: Error) => {
      toast.error(`Merge failed for ${identifier}`, { description: err.message });
    },
  });

  const isMerging = mergeStatus === 'merging' || mergeStatus === 'queued' || mergeMutation.isPending;
  const isFailed = mergeStatus === 'failed';

  return (
    <li className="border border-border rounded-lg bg-card p-4 flex items-start gap-4" data-testid={`merge-row-${identifier}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {trackerUrl ? (
            <a
              href={trackerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground hover:underline"
            >
              {identifier}
            </a>
          ) : (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground">
              {identifier}
            </span>
          )}
          {isFailed && (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1"
              title="A previous merge attempt failed"
            >
              <AlertTriangle className="w-3 h-3" />
              Last merge failed
            </span>
          )}
          {updatedAt && (
            <span className="text-[11px] text-muted-foreground">
              ready {formatRelative(updatedAt)}
            </span>
          )}
        </div>
        <p className="text-sm text-foreground truncate" title={title}>
          {title}
        </p>
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline mt-1 inline-block"
            data-testid={`merge-pr-link-${identifier}`}
          >
            View PR ↗
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {frontendUrl ? (
          <a
            href={frontendUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border text-foreground hover:bg-accent transition-colors"
            title="Open the workspace frontend for UAT"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            UAT
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border text-muted-foreground/60 cursor-not-allowed"
            title="No frontend URL — workspace info unavailable"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            UAT
          </span>
        )}
        <button
          onClick={() => mergeMutation.mutate()}
          disabled={isMerging}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid={`merge-btn-${identifier}`}
        >
          {isMerging ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <GitMerge className="w-3.5 h-3.5" />
          )}
          {isMerging ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </li>
  );
}

function blockerIcon(type: string) {
  switch (type) {
    case 'failing_checks':
      return <XCircle className="w-3 h-3" />;
    case 'merge_conflict':
      return <GitPullRequest className="w-3 h-3" />;
    case 'unresolved_conversations':
      return <MessageSquare className="w-3 h-3" />;
    case 'changes_requested':
      return <FilePenLine className="w-3 h-3" />;
    case 'draft_pr':
      return <PenLine className="w-3 h-3" />;
    case 'not_mergeable':
      return <AlertTriangle className="w-3 h-3" />;
    default:
      return <ShieldAlert className="w-3 h-3" />;
  }
}

interface BlockedRowProps {
  issueId: string;
  identifier: string;
  title: string;
  trackerUrl?: string;
  blockerReasons: ReadonlyArray<{ type: string; summary: string; details?: string; detectedAt: string }>;
  updatedAt?: string;
}

function BlockedMergeRow({
  identifier,
  title,
  trackerUrl,
  blockerReasons,
  updatedAt,
}: BlockedRowProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border border-destructive/30 rounded-lg bg-card p-4 opacity-80">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {trackerUrl ? (
              <a
                href={trackerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground hover:underline"
              >
                {identifier}
              </a>
            ) : (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground">
                {identifier}
              </span>
            )}
            {updatedAt && (
              <span className="text-[11px] text-muted-foreground">
                ready {formatRelative(updatedAt)}
              </span>
            )}
          </div>
          <p className="text-sm text-foreground truncate" title={title}>
            {title}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {blockerReasons.map((br) => (
              <span
                key={br.type}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1"
                title={br.details ?? br.summary}
              >
                {blockerIcon(br.type)}
                {br.type}: {br.summary}
              </span>
            ))}
          </div>
        </div>
      </div>
      {blockerReasons.some((br) => br.details) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {expanded && (
        <div className="mt-2 space-y-1">
          {blockerReasons
            .filter((br) => br.details)
            .map((br) => (
              <p key={br.type} className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{br.type}:</span>{' '}
                {br.details}
              </p>
            ))}
        </div>
      )}
    </li>
  );
}

interface OpenMrRowProps {
  issueId: string;
  identifier: string;
  title: string;
  trackerUrl?: string;
  prUrl?: string;
  reviewStatus?: string;
  testStatus?: string;
  verificationStatus?: string;
  updatedAt?: string;
}

function pipelineStepBadge(label: string, status?: string) {
  if (!status || status === 'pending') {
    return (
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
        {label}
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {label}
      </span>
    );
  }
  if (status === 'passed' || status === 'skipped') {
    return (
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success flex items-center gap-1">
        <CheckCircle className="w-3 h-3" />
        {label}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1">
        <XCircle className="w-3 h-3" />
        {label}
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
      {label}
    </span>
  );
}

function OpenMergeRequestRow({
  issueId,
  identifier,
  title,
  trackerUrl,
  prUrl,
  reviewStatus,
  testStatus,
  verificationStatus,
  updatedAt,
}: OpenMrRowProps) {
  const confirm = useConfirm();
  const approveMutation = useMutation({
    mutationFn: () => forgeApprove(issueId),
    onSuccess: () => {
      toast.success(`Approved ${identifier}`);
    },
    onError: (err: Error) => {
      toast.error(`Approve failed for ${identifier}`, { description: err.message });
    },
  });

  const handleApprove = async () => {
    const forgeName = prUrl?.includes('gitlab') ? 'GitLab' : 'GitHub';
    const confirmed = await confirm({
      title: `Approve ${identifier}`,
      message: `This will submit an approving review on ${forgeName} for all open PRs/MRs associated with ${identifier}.\n\nThe Panopticon review and test pipeline will continue running independently — this just records your human approval on the forge.`,
      confirmLabel: 'Approve',
    });
    if (confirmed) {
      approveMutation.mutate();
    }
  };

  return (
    <li className="border border-border rounded-lg bg-card p-4 flex items-start gap-4 opacity-80">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {trackerUrl ? (
            <a
              href={trackerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground hover:underline"
            >
              {identifier}
            </a>
          ) : (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-accent text-foreground">
              {identifier}
            </span>
          )}
          {updatedAt && (
            <span className="text-[11px] text-muted-foreground">
              opened {formatRelative(updatedAt)}
            </span>
          )}
        </div>
        <p className="text-sm text-foreground truncate" title={title}>
          {title}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {pipelineStepBadge('review', reviewStatus)}
          {pipelineStepBadge('test', testStatus)}
          {pipelineStepBadge('verify', verificationStatus)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border text-foreground hover:bg-accent transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View PR
          </a>
        )}
        <button
          onClick={handleApprove}
          disabled={approveMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {approveMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="w-3.5 h-3.5" />
          )}
          Approve
        </button>
      </div>
    </li>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
