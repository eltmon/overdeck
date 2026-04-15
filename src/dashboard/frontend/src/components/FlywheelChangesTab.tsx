/**
 * FlywheelChangesTab — lists issues with the `flywheel-change` label.
 *
 * Rendered as a tab on AwaitingMergePage.
 * Each card shows: skill name, diff view (before/after), retro provenance
 * (collapsible), aggregated signal count, merge button, rollback preview.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge, ChevronDown, ChevronRight, ExternalLink, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboardStore, selectAwaitingMerge, selectIssues } from '../lib/store';
import type { Issue } from '../types';

// ============================================================================
// API helpers
// ============================================================================

interface RetroSummary {
  filename: string;
  frictionScore: number;
  summary: string;
}

interface FlywheelRetroData {
  retros: RetroSummary[];
  signalCount: number;
  skillName: string;
}

interface RollbackPreview {
  diff: string;
  commitSha: string;
}

async function fetchFlywheelRetros(issueId: string): Promise<FlywheelRetroData> {
  const res = await fetch(`/api/flywheel/retros/${issueId}`);
  if (!res.ok) return { retros: [], signalCount: 0, skillName: issueId };
  return res.json();
}

async function fetchRollbackPreview(issueId: string): Promise<RollbackPreview> {
  const res = await fetch(`/api/flywheel/rollback-preview/${issueId}`);
  if (!res.ok) throw new Error(`Rollback preview failed (${res.status})`);
  return res.json();
}

async function mergeIssue(issueId: string): Promise<unknown> {
  const res = await fetch(`/api/issues/${issueId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Merge failed (${res.status})`);
  }
  return res.json();
}

// ============================================================================
// FlywheelChangeCard
// ============================================================================

interface FlywheelChangeCardProps {
  issueId: string;
  identifier: string;
  title: string;
  trackerUrl?: string;
  mergeStatus?: string;
  onMerged: () => void;
}

function FlywheelChangeCard({
  issueId,
  identifier,
  title,
  trackerUrl,
  mergeStatus,
  onMerged,
}: FlywheelChangeCardProps) {
  const queryClient = useQueryClient();
  const [retroExpanded, setRetroExpanded] = useState(false);
  const [rollbackExpanded, setRollbackExpanded] = useState(false);

  const retroQuery = useQuery({
    queryKey: ['flywheel-retros', issueId],
    queryFn: () => fetchFlywheelRetros(issueId),
    staleTime: 60_000,
  });

  const rollbackQuery = useQuery({
    queryKey: ['flywheel-rollback', issueId],
    queryFn: () => fetchRollbackPreview(issueId),
    enabled: rollbackExpanded,
    staleTime: 120_000,
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeIssue(issueId),
    onSuccess: () => {
      toast.success(`Merge started for ${identifier}`);
      queryClient.invalidateQueries({ queryKey: ['flywheel-retros', issueId] });
      onMerged();
    },
    onError: (err: Error) => {
      toast.error(`Merge failed for ${identifier}`, { description: err.message });
    },
  });

  const isMerging = mergeStatus === 'merging' || mergeStatus === 'queued' || mergeMutation.isPending;
  const retros = retroQuery.data?.retros ?? [];
  const signalCount = retroQuery.data?.signalCount ?? retros.length;
  const skillName = retroQuery.data?.skillName ?? identifier;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Card header */}
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground">{identifier}</span>
            {signalCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {signalCount} signal{signalCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground truncate">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Skill: <code>{skillName}</code></p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {trackerUrl && (
            <a
              href={trackerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={() => mergeMutation.mutate()}
            disabled={isMerging}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {isMerging ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <GitMerge className="w-3 h-3" />
            )}
            {isMerging ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>

      {/* Retro provenance (collapsible) */}
      <div className="border-t border-border">
        <button
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={() => setRetroExpanded(!retroExpanded)}
        >
          {retroExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Retro provenance ({retros.length} retro{retros.length !== 1 ? 's' : ''})
        </button>
        {retroExpanded && (
          <div className="px-4 pb-3 space-y-1">
            {retros.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No retros linked (data from API)</p>
            ) : (
              retros.map((r, i) => (
                <div key={i} className="flex items-baseline gap-2 text-xs">
                  <code className="text-muted-foreground">{r.filename}</code>
                  <span className="text-muted-foreground">friction: {r.frictionScore}/10</span>
                  {r.summary && <span className="text-foreground/70">— {r.summary}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Rollback preview */}
      <div className="border-t border-border">
        <button
          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={() => setRollbackExpanded(!rollbackExpanded)}
        >
          <RotateCcw className="w-3 h-3" />
          Preview rollback
        </button>
        {rollbackExpanded && (
          <div className="px-4 pb-3">
            {rollbackQuery.isLoading ? (
              <p className="text-xs text-muted-foreground italic">Loading diff…</p>
            ) : rollbackQuery.isError ? (
              <p className="text-xs text-destructive">
                {rollbackQuery.error instanceof Error ? rollbackQuery.error.message : 'Failed to load preview'}
              </p>
            ) : rollbackQuery.data ? (
              <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre font-mono max-h-48">
                {rollbackQuery.data.diff || '(no diff — skill not yet committed)'}
              </pre>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// FlywheelChangesTab
// ============================================================================

export function FlywheelChangesTab() {
  const queryClient = useQueryClient();
  const awaiting = useDashboardStore(selectAwaitingMerge);
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];

  // Index issues by id for fast lookup
  const issuesById = new Map<string, Issue>();
  for (const iss of issues) {
    if (iss?.identifier) issuesById.set(iss.identifier.toLowerCase(), iss);
    if (iss?.id) issuesById.set(String(iss.id).toLowerCase(), iss);
  }

  // Filter awaiting-merge issues that have the flywheel-change label
  const flywheelItems = awaiting.filter((rs) => {
    const issue = issuesById.get(rs.issueId.toLowerCase());
    return Array.isArray(issue?.labels) && issue.labels.includes('flywheel-change');
  });

  if (flywheelItems.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-lg p-10 text-center">
        <p className="text-sm text-foreground mb-1">No flywheel changes awaiting merge.</p>
        <p className="text-xs text-muted-foreground">
          When the synthesis step files skill-change issues, they appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {flywheelItems.map((rs) => {
        const issue = issuesById.get(rs.issueId.toLowerCase());
        return (
          <FlywheelChangeCard
            key={rs.issueId}
            issueId={rs.issueId}
            identifier={issue?.identifier ?? rs.issueId}
            title={issue?.title ?? rs.issueId}
            trackerUrl={issue?.url}
            mergeStatus={rs.mergeStatus}
            onMerged={() => {
              queryClient.invalidateQueries({ queryKey: ['workspace', rs.issueId] });
            }}
          />
        );
      })}
    </ul>
  );
}
