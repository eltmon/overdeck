/**
 * AwaitingMergePage — single-purpose human merge gate.
 *
 * Lists every issue with `readyForMerge: true` and offers two actions per row:
 *   1. Open the workspace's frontendUrl in a new tab so the user can UAT.
 *   2. POST to /api/issues/:id/merge once UAT passes.
 *
 * This is the only page the user needs to look at while `/pan-flywheel` runs.
 * See docs/flywheel-brief.md and docs/FLYWHEEL.md.
 */

import { useMemo, useState } from 'react';
import { useQueries, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, ExternalLink, Loader2, CheckCircle, AlertTriangle, ShieldAlert, XCircle, GitPullRequest, MessageSquare, FilePenLine, PenLine, ChevronDown, ChevronUp, ThumbsUp, TriangleAlert, Circle, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardStore, selectAwaitingMerge, selectBlockedFromMerge, selectOpenMergeRequests, selectIssues } from '../lib/store';
import { useConfirm } from './DialogProvider';
import { AutoMergeToggle } from './AutoMergeToggle';
import type { Issue } from '../types';

interface WorkspaceInfo {
  exists?: boolean;
  frontendUrl?: string;
  mrUrl?: string;
  stackHealth?: { healthy?: boolean; reasons?: string[] };
}

interface UatContext {
  acceptanceCriteria?: Array<{ id: string; title: string; status: string; itemId: string; itemTitle: string }>;
  deliverables?: Array<{ id: string; title: string; status: string; action?: string }>;
  proposal?: string | null;
  changedFiles?: Array<{ path: string; status: string; additions: number; deletions: number }>;
  changedFilesTotal?: number;
  changedFilesOmitted?: number;
  diffStat?: { stat: string; truncated: boolean } | null;
  source?: { plan?: 'vbrief' | 'none'; files?: 'git' | 'none' };
}

async function fetchWorkspace(issueId: string): Promise<WorkspaceInfo> {
  const res = await fetch(`/api/workspaces/${issueId}`);
  if (!res.ok) return {};
  return res.json();
}

async function fetchUatContext(issueId: string): Promise<UatContext> {
  const res = await fetch(`/api/workspaces/${issueId}/uat-context`);
  if (!res.ok) return {};
  return res.json();
}

async function rebuildStack(issueId: string): Promise<void> {
  const res = await fetch(`/api/workspaces/${issueId}/rebuild-stack`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Rebuild failed (${res.status})`);
  }
}

async function forgeMerge(issueId: string): Promise<unknown> {
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

function isVerifyingIssue(issue?: Issue): boolean {
  const state = (issue?.state ?? issue?.status ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return state === 'verifying' || state === 'verifying_on_main';
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
        if (issue?.state === 'canceled') return false;
        if (isVerifyingIssue(issue)) return false;
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
  const visibleOpenMergeRequests = useMemo(
    () => openMergeRequests.filter((rs) => !isVerifyingIssue(issuesById.get(rs.issueId.toLowerCase()))),
    [openMergeRequests, issuesById],
  );

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
                  description={issue?.description}
                  identifier={issue?.identifier ?? rs.issueId}
                  trackerUrl={issue?.url}
                  frontendUrl={ws?.frontendUrl}
                  stackHealthy={ws?.stackHealth?.healthy}
                  stackReason={ws?.stackHealth?.reasons?.[0]}
                  prUrl={rs.prUrl ?? ws?.mrUrl}
                  updatedAt={rs.updatedAt}
                  mergeStatus={rs.mergeStatus}
                  mergeStep={rs.mergeStep}
                  mergeNotes={rs.mergeNotes}
                  autoMerge={rs.autoMerge}
                  uatNotes={rs.uatNotes}
                  onMerged={() => {
                    queryClient.invalidateQueries({ queryKey: ['workspace', rs.issueId] });
                    queryClient.invalidateQueries({ queryKey: ['review-status', rs.issueId] });
                    queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
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
        {/* Pipeline Override — PRs still in pipeline, manual merge bypasses everything */}
        {visibleOpenMergeRequests.length > 0 && (
          <PipelineOverrideSection
            openMergeRequests={visibleOpenMergeRequests}
            issuesById={issuesById}
          />
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
  description?: string;
  trackerUrl?: string;
  frontendUrl?: string;
  stackHealthy?: boolean;
  stackReason?: string;
  prUrl?: string;
  updatedAt?: string;
  mergeStatus?: string;
  mergeStep?: string;
  mergeNotes?: string;
  autoMerge?: boolean;
  uatContext?: UatContext;
  uatNotes?: string;
  onMerged: () => void;
}

const MERGE_STEPS = [
  { key: 'queued', label: 'Queued in merge queue' },
  { key: 'validating-pr', label: 'Validating PR state' },
  { key: 'rebasing', label: 'Rebasing onto main' },
  { key: 'stripping-planning', label: 'Stripping .planning/ artifacts' },
  { key: 'verifying', label: 'Post-rebase verification' },
  { key: 'reporting-statuses', label: 'Reporting commit statuses' },
  { key: 'squash-merging', label: 'Squash merge via forge' },
  { key: 'post-merge-cleanup', label: 'Post-merge cleanup' },
] as const;

function MergeStepTracker({ mergeStep, mergeStatus, mergeNotes }: { mergeStep?: string; mergeStatus?: string; mergeNotes?: string }) {
  if (!mergeStep && mergeStatus !== 'merging' && mergeStatus !== 'verifying' && mergeStatus !== 'queued') return null;

  const currentIdx = MERGE_STEPS.findIndex(s => s.key === mergeStep);
  const isFailed = mergeStatus === 'failed';

  return (
    <div className="mt-3 pl-1 border-l-2 border-primary/20 ml-1">
      <div className="space-y-1.5 pl-3">
        {MERGE_STEPS.map((step, idx) => {
          let icon: React.ReactNode;
          let textClass: string;

          if (isFailed && idx === currentIdx) {
            icon = <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
            textClass = 'text-destructive';
          } else if (idx < currentIdx || (mergeStatus === 'merged' && currentIdx === -1)) {
            icon = <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />;
            textClass = 'text-muted-foreground';
          } else if (idx === currentIdx) {
            icon = <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />;
            textClass = 'text-foreground font-medium';
          } else {
            icon = <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />;
            textClass = 'text-muted-foreground/60';
          }

          return (
            <div key={step.key} className="flex items-center gap-2">
              {icon}
              <span className={`text-[11px] ${textClass}`}>{step.label}</span>
            </div>
          );
        })}
      </div>
      {isFailed && mergeNotes && (
        <p className="text-[11px] text-destructive mt-2 pl-3">{mergeNotes}</p>
      )}
    </div>
  );
}

export function AwaitingMergeRow({
  issueId,
  identifier,
  title,
  description,
  trackerUrl,
  frontendUrl,
  stackHealthy,
  stackReason,
  prUrl,
  updatedAt,
  mergeStatus,
  mergeStep,
  mergeNotes,
  autoMerge,
  uatContext,
  uatNotes,
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

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildStack(issueId),
    onSuccess: () => {
      toast.success(`Rebuilding stack for ${identifier}`, { description: 'Watch the activity feed; the UAT link works once it is healthy.' });
    },
    onError: (err: Error) => {
      toast.error(`Stack rebuild failed for ${identifier}`, { description: err.message });
    },
  });

  const isMerging = mergeStatus === 'merging' || mergeStatus === 'queued' || mergeStatus === 'verifying' || mergeMutation.isPending;
  const isFailed = mergeStatus === 'failed';
  const [uatExpanded, setUatExpanded] = useState(false);
  const fetchedUatContext = useQuery({
    queryKey: ['uat-context', issueId],
    queryFn: () => fetchUatContext(issueId),
    enabled: uatExpanded && !uatContext,
    staleTime: 5 * 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
  const effectiveUatContext = uatContext ?? fetchedUatContext.data;
  const acceptanceCriteria = effectiveUatContext?.acceptanceCriteria?.filter((criterion) => criterion.title.trim()) ?? [];
  const deliverables = effectiveUatContext?.deliverables?.filter((deliverable) => deliverable.title.trim()) ?? [];
  const changedFiles = effectiveUatContext?.changedFiles ?? [];
  const changedFilesOmitted = effectiveUatContext?.changedFilesOmitted ?? Math.max(0, (effectiveUatContext?.changedFilesTotal ?? 0) - changedFiles.length);
  const proposal = effectiveUatContext?.proposal?.trim();
  const fallbackChecklistText = description?.trim() || title;
  const showUatLoading = Boolean(fetchedUatContext.isLoading && !fetchedUatContext.isError && !uatContext);

  return (
    <li className="border border-border rounded-lg bg-card p-4" data-testid={`merge-row-${identifier}`}>
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
            {isFailed && (
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1"
                title="A previous merge attempt failed"
              >
                <AlertTriangle className="w-3 h-3" />
                Last merge failed
              </span>
            )}
            {isMerging && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Merge in progress
              </span>
            )}
            {updatedAt && !isMerging && (
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
          {stackHealthy === false ? (
            // Stack is down — a UAT link would just 404. Offer a rebuild instead.
            <button
              type="button"
              onClick={() => rebuildMutation.mutate()}
              disabled={rebuildMutation.isPending}
              title={stackReason ? `Workspace stack is down: ${stackReason}` : 'Workspace stack is down — rebuild it to UAT'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rebuildMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
              {rebuildMutation.isPending ? 'Rebuilding…' : 'Rebuild to UAT'}
            </button>
          ) : frontendUrl ? (
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
          <AutoMergeToggle issueId={issueId} autoMerge={autoMerge} compact />
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
            {isMerging ? 'Merging��' : 'Merge'}
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setUatExpanded((expanded) => !expanded)}
        className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`merge-uat-toggle-${identifier}`}
      >
        {uatExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        What to test / Expected changes
      </button>

      {uatExpanded && (
        <div className="mt-3 rounded-md border border-border/70 bg-muted/20 p-3" data-testid={`merge-uat-context-${identifier}`}>
          <div className="flex items-center gap-2 mb-2">
            <ThumbsUp className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-xs font-semibold text-foreground">What to test (UAT)</h3>
          </div>
          {showUatLoading && (
            <p className="text-[11px] text-muted-foreground mb-2">Loading UAT context…</p>
          )}
          {acceptanceCriteria.length > 0 ? (
            <ul className="space-y-1.5">
              {acceptanceCriteria.map((criterion) => (
                <li key={criterion.id} className="flex items-start gap-2 text-xs text-foreground">
                  <Circle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <span>
                    <span>{criterion.title}</span>
                    {criterion.itemTitle && (
                      <span className="ml-1 text-[11px] text-muted-foreground">({criterion.itemTitle})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-foreground whitespace-pre-wrap">{fallbackChecklistText}</p>
          )}

          <div className="mt-4 border-t border-border/60 pt-3">
            <h3 className="text-xs font-semibold text-foreground mb-2">Expected changes</h3>
            {deliverables.length > 0 ? (
              <ul className="space-y-1.5 mb-3">
                {deliverables.map((deliverable) => (
                  <li key={deliverable.id} className="text-xs text-foreground">
                    <span className="font-medium">{deliverable.title}</span>
                    {deliverable.action && (
                      <span className="block text-[11px] text-muted-foreground mt-0.5">{deliverable.action}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : proposal ? (
              <p className="text-xs text-foreground whitespace-pre-wrap mb-3">{proposal}</p>
            ) : (
              <p className="text-xs text-muted-foreground mb-3">No deliverables available.</p>
            )}

            <div className="space-y-1.5">
              {changedFiles.length > 0 ? (
                <>
                  {changedFiles.map((file) => (
                    <div key={`${file.status}:${file.path}`} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="font-mono px-1 py-0.5 rounded bg-accent text-foreground">{file.status}</span>
                      <span className="font-mono text-foreground truncate">{file.path}</span>
                      <span className="ml-auto font-mono text-success">+{file.additions}</span>
                      <span className="font-mono text-destructive">-{file.deletions}</span>
                    </div>
                  ))}
                  {changedFilesOmitted > 0 && (
                    <p className="text-[11px] text-muted-foreground">+{changedFilesOmitted} more files</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No file changes available.</p>
              )}
            </div>
          </div>

          {uatNotes?.trim() && (
            <div className="mt-3 rounded border border-primary/20 bg-primary/5 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-primary mb-1">Reviewer UAT notes</p>
              <p className="text-xs text-foreground whitespace-pre-wrap">{uatNotes.trim()}</p>
            </div>
          )}
        </div>
      )}

      {/* Inline merge step tracker — visible when merge is in progress or just failed */}
      {(isMerging || isFailed) && (
        <MergeStepTracker mergeStep={mergeStep} mergeStatus={mergeStatus} mergeNotes={mergeNotes} />
      )}
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

function PipelineOverrideSection({
  openMergeRequests,
  issuesById,
}: {
  openMergeRequests: ReadonlyArray<{ issueId: string; prUrl?: string; reviewStatus?: string; testStatus?: string; verificationStatus?: string; updatedAt?: string }>;
  issuesById: Map<string, Issue>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <header className="mb-4">
          <div className="flex items-center gap-3 mb-1">
            <TriangleAlert className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-foreground">Pipeline Override</h2>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              {openMergeRequests.length}
            </span>
            <span className="ml-auto text-muted-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </div>
          {!expanded && (
            <p className="text-sm text-muted-foreground">
              PRs still going through the review/test pipeline. Click to expand override actions.
            </p>
          )}
        </header>
      </button>
      {expanded && (
        <>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 mb-4 text-[12px] text-amber-700 dark:text-amber-300">
            These issues have open PRs but haven't completed the review/test pipeline.
            Merging here bypasses Panopticon's rebase, verification, and cleanup steps.
          </div>
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
          </u