/**
 * AwaitingMergePage — single-purpose human merge gate.
 *
 * PAN-3917: the ready set is the forge's answer, not a stored flag. An issue
 * appears here when its derived state is `ready` — approved, checks green,
 * `mergeable` true — and offers two actions per row:
 *   1. Open the workspace's frontendUrl in a new tab so the user can UAT.
 *   2. POST to /api/issues/:id/merge once UAT passes.
 */
import { useMemo, useState } from 'react';
import { useQueries, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, ExternalLink, Loader2, CheckCircle, ShieldAlert, XCircle, GitPullRequest, ChevronDown, ChevronUp, ThumbsUp, TriangleAlert, Circle, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { capture, captureException } from '../lib/telemetry';
import { useDashboardStore, selectAwaitingMerge, selectBlockedFromMerge, selectOpenMergeRequests, selectIssues } from '../lib/store';
import { useConfirm } from './DialogProvider';
import { AutoMergeToggle } from './AutoMergeToggle';
import { MergePolicySection } from './merge-train/MergePolicySection';
import { MergeQueueCard } from './merge-train/MergeQueueCard';
import { MergeTrainSection } from './merge-train/MergeTrainSection';
import { UatStackStatus } from './CommandDeck/UatStackStatus';
import { fetchUatContext, fetchWorkspace, forgeApprove, forgeMerge, mergeIssue, rebuildStack, type UatContext, type WorkspaceInfo } from './awaitingMergeApi';
import type { WorkspaceContainerStatus, WorkspacePendingOperation } from './CommandDeck/ZoneCOverviewTabs/queries';
import type { DerivedIssueState, Issue } from '../types';

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

  // Priority: PAN (core substrate) first, then other projects, by issue id within each tier.
  const sortedAwaiting = useMemo(() => {
    const projectPriority = (id: string): number => {
      const prefix = id.toUpperCase().split('-')[0];
      if (prefix === 'PAN') return 0;
      if (prefix === 'KRUX') return 1;
      return 2; // MIN, AUR, MYN, etc.
    };
    return awaiting
      // The tracker owns cancellation — a canceled issue never merges.
      .filter((rs) => issuesById.get(rs.issueId.toLowerCase())?.state !== 'canceled')
      .sort((a, b) => {
        const pa = projectPriority(a.issueId);
        const pb = projectPriority(b.issueId);
        if (pa !== pb) return pa - pb;
        return a.issueId.localeCompare(b.issueId);
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

        <MergeTrainSection />

        <MergeQueueCard />

        <MergePolicySection />

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
                  apiUrl={ws?.apiUrl}
                  stackHealthy={ws?.stackHealth?.healthy}
                  stackHealth={ws?.stackHealth}
                  stackReason={ws?.stackHealth?.reasons?.[0]}
                  containers={ws?.containers}
                  pendingOperation={ws?.pendingOperation}
                  prUrl={rs.pr?.url ?? ws?.mrUrl}
                  onMerged={() => {
                    queryClient.invalidateQueries({ queryKey: ['workspace', rs.issueId] });
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
                These issues have an open PR the forge will not merge — red checks
                or a conflict. Fix it on the forge and the issue re-enters the queue.
              </p>
            </header>
            <ul className="space-y-3">
              {blocked.map((rs) => {
                const issue = issuesById.get(rs.issueId.toLowerCase());
                return (
                  <BlockedMergeRow
                    key={rs.issueId}
                    title={issue?.title ?? rs.issueId}
                    identifier={issue?.identifier ?? rs.issueId}
                    {...(issue?.url ? { trackerUrl: issue.url } : {})}
                    blockers={mergeBlockers(rs)}
                  />
                );
              })}
            </ul>
          </div>
        )}
        {/* Pipeline Override — PRs still in review, manual merge bypasses everything */}
        {openMergeRequests.length > 0 && (
          <PipelineOverrideSection
            openMergeRequests={openMergeRequests}
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
        Nothing is approved with green checks right now.
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
  apiUrl?: string;
  stackHealthy?: boolean;
  stackHealth?: WorkspaceInfo['stackHealth'];
  stackReason?: string;
  containers?: Record<string, WorkspaceContainerStatus> | null;
  pendingOperation?: WorkspacePendingOperation | null;
  prUrl?: string;
  uatContext?: UatContext;
  onMerged: () => void;
}

export function AwaitingMergeRow({
  issueId,
  identifier,
  title,
  description,
  trackerUrl,
  frontendUrl,
  apiUrl,
  stackHealthy,
  stackHealth,
  stackReason,
  containers,
  pendingOperation,
  prUrl,
  uatContext,
  onMerged,
}: RowProps) {
  const queryClient = useQueryClient();
  const mergeMutation = useMutation({
    mutationFn: () => mergeIssue(issueId),
    onSuccess: () => {
      capture('issue_merged', { merge_kind: 'pipeline' }); toast.success(`Merge started for ${identifier}`);
      onMerged();
    },
    onError: (err: Error) => {
      captureException(err, { action: 'merge' }); toast.error(`Merge failed for ${identifier}`, { description: err.message });
    },
  });

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildStack(issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      toast.success(`Rebuilding stack for ${identifier}`, { description: 'UAT environment status is now shown in this row, the issue tree, and the issue slide-out.' });
    },
    onError: (err: Error) => {
      toast.error(`Stack rebuild failed for ${identifier}`, { description: err.message });
    },
  });

  const isMerging = mergeMutation.isPending;
  const rebuildFailed = pendingOperation?.type === 'rebuild-stack' && pendingOperation.status === 'failed';
  const stackPending = rebuildMutation.isPending || (pendingOperation?.status === 'running' && ['containerize', 'start', 'rebuild-stack', 'start-stack', 'stop-stack', 'restart-stack', 'reap-workspace'].includes(pendingOperation.type));
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
            {isMerging && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Merge in progress
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-warning/[0.32] text-warning-foreground hover:bg-warning/[0.08] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          <AutoMergeToggle issueId={issueId} compact />
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

      {(stackPending || stackHealthy === false || containers) && (
        <div className="mt-3" data-testid={`merge-uat-stack-${identifier}`}>
          <UatStackStatus
            containers={containers}
            stackHealth={stackHealth}
            frontendUrl={frontendUrl}
            apiUrl={apiUrl}
            pending={stackPending}
            density="compact"
          />
          {rebuildFailed && pendingOperation?.error ? (
            <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
              Rebuild failed: {pendingOperation.error}
            </p>
          ) : null}
        </div>
      )}

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

        </div>
      )}
    </li>
  );
}

type MergeBlocker = { type: 'failing_checks' | 'merge_conflict'; summary: string };

/** What the forge says is stopping this PR. Derived from the PR, never stored. */
function mergeBlockers(derived: DerivedIssueState): MergeBlocker[] {
  const blockers: MergeBlocker[] = [];
  if (derived.pr?.checks === 'red') {
    blockers.push({ type: 'failing_checks', summary: 'checks are failing' });
  }
  if (derived.pr?.mergeable === false) {
    blockers.push({ type: 'merge_conflict', summary: 'branch cannot be merged cleanly' });
  }
  return blockers;
}

function blockerIcon(type: MergeBlocker['type']) {
  return type === 'failing_checks'
    ? <XCircle className="w-3 h-3" />
    : <GitPullRequest className="w-3 h-3" />;
}

interface BlockedRowProps {
  identifier: string;
  title: string;
  trackerUrl?: string;
  blockers: MergeBlocker[];
}

function BlockedMergeRow({
  identifier,
  title,
  trackerUrl,
  blockers,
}: BlockedRowProps) {
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
          </div>
          <p className="text-sm text-foreground truncate" title={title}>
            {title}
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {blockers.map((blocker) => (
              <span
                key={blocker.type}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1"
                title={blocker.summary}
              >
                {blockerIcon(blocker.type)}
                {blocker.type}: {blocker.summary}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

interface OpenMrRowProps {
  issueId: string;
  identifier: string;
  title: string;
  trackerUrl?: string;
  pr?: DerivedIssueState['pr'];
}

/**
 * One badge per thing the forge can tell us about the PR: its review decision,
 * its checks, and whether it merges cleanly. No stored pipeline steps.
 */
function prBadges(pr: DerivedIssueState['pr']) {
  if (!pr) return [];
  const reviewApproved = pr.reviewState === 'approved';
  const changesRequested = pr.reviewState === 'changes-requested';
  return [
    {
      key: 'review',
      label: 'review',
      tone: changesRequested ? 'bad' : reviewApproved ? 'good' : 'neutral',
    },
    {
      key: 'checks',
      label: 'checks',
      tone: pr.checks === 'red' ? 'bad' : pr.checks === 'green' ? 'good' : 'neutral',
    },
    {
      key: 'mergeable',
      label: 'mergeable',
      tone: pr.mergeable ? 'good' : 'bad',
    },
  ] as const;
}

function prBadge({ key, label, tone }: { key: string; label: string; tone: 'good' | 'bad' | 'neutral' }) {
  if (tone === 'good') {
    return (
      <span key={key} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success flex items-center gap-1">
        <CheckCircle className="w-3 h-3" />
        {label}
      </span>
    );
  }
  if (tone === 'bad') {
    return (
      <span key={key} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/15 text-destructive flex items-center gap-1">
        <XCircle className="w-3 h-3" />
        {label}
      </span>
    );
  }
  return (
    <span key={key} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent text-muted-foreground">
      {label}
    </span>
  );
}

function PipelineOverrideSection({
  openMergeRequests,
  issuesById,
}: {
  openMergeRequests: ReadonlyArray<DerivedIssueState>;
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
            <TriangleAlert className="w-5 h-5 text-warning-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Pipeline Override</h2>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-warning/[0.08] text-warning-foreground">
              {openMergeRequests.length}
            </span>
            <span className="ml-auto text-muted-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </span>
          </div>
          {!expanded && (
            <p className="text-sm text-muted-foreground">
              Open PRs the forge is not ready to merge. Click to expand override actions.
            </p>
          )}
        </header>
      </button>
      {expanded && (
        <>
          <div className="rounded-md border border-warning/[0.32] bg-warning/[0.08] p-3 mb-4 text-[12px] text-warning-foreground">
            These issues have open PRs that are not approved-and-green yet.
            Merging here bypasses Overdeck's rebase, verification, and cleanup steps.
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
                  pr={rs.pr}
                />
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function OpenMergeRequestRow({
  issueId,
  identifier,
  title,
  trackerUrl,
  pr,
}: OpenMrRowProps) {
  const confirm = useConfirm();
  const prUrl = pr?.url;
  const forgeName = prUrl?.includes('gitlab') ? 'GitLab' : 'GitHub';

  const approveMutation = useMutation({
    mutationFn: () => forgeApprove(issueId),
    onSuccess: () => {
      toast.success(`Approved ${identifier}`);
    },
    onError: (err: Error) => {
      toast.error(`Approve failed for ${identifier}`, { description: err.message });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: () => forgeMerge(issueId),
    onSuccess: () => {
      capture('force_merge_triggered', { forge: forgeName === 'GitLab' ? 'gitlab' : 'github' }); toast.success(`Force merge started for ${identifier}`);
    },
    onError: (err: Error) => {
      captureException(err, { action: 'force_merge' }); toast.error(`Force merge failed for ${identifier}`, { description: err.message });
    },
  });

  const handleApprove = async () => {
    const confirmed = await confirm({
      title: `Force Approve ${identifier}`,
      message: `This bypasses Overdeck's review pipeline and submits an approving review directly on ${forgeName}.\n\nThe automated review/test pipeline will continue running independently.`,
      confirmLabel: 'Force Approve',
    });
    if (confirmed) {
      approveMutation.mutate();
    }
  };

  const handleMerge = async () => {
    const confirmed = await confirm({
      title: `Force Merge ${identifier} (Skip Pipeline)`,
      message: `This will squash-merge directly via ${forgeName}, bypassing:\n\n• Rebasing onto main\n• Post-rebase verification (typecheck/lint/test)\n• Post-merge cleanup (labels, issue close, Docker teardown)\n\nYou'll need to handle cleanup manually. Use this only when the issue was handled outside the automated pipeline.`,
      confirmLabel: 'Force Merge',
      variant: 'destructive',
    });
    if (confirmed) {
      mergeMutation.mutate();
    }
  };

  return (
    <li className="border border-warning/[0.32] rounded-lg bg-card p-4 flex items-start gap-4">
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
          {pr && (
            <span className="text-[11px] text-muted-foreground font-mono">#{pr.number}</span>
          )}
        </div>
        <p className="text-sm text-foreground truncate" title={title}>
          {title}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {prBadges(pr).map(prBadge)}
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-warning/[0.32] text-warning-foreground hover:bg-warning/[0.08] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {approveMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="w-3.5 h-3.5" />
          )}
          Force Approve
        </button>
        <button
          onClick={handleMerge}
          disabled={mergeMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-warning text-warning-foreground hover:bg-warning/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mergeMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <GitMerge className="w-3.5 h-3.5" />
          )}
          Force Merge
        </button>
      </div>
    </li>
  );
}
