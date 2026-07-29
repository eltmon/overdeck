import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScrollText, X } from 'lucide-react';
import { useWorkspacePlanQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';
import { useDashboardStore } from '../../lib/store';
import { XBriefViewer } from './XBriefViewer';
import type { XBriefDocument, XBriefInspectionPolicy } from './types';

export function XBriefFullscreen() {
  const issueId = useDashboardStore((state) => state.xbriefViewerIssueId);
  const closeXbriefViewer = useDashboardStore((state) => state.closeXbriefViewer);
  const dialogRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const queryKey = ['workspace-plan', issueId];
  const { data, isLoading, isError } = useWorkspacePlanQuery(issueId ?? '', {
    enabled: issueId !== null,
  });
  const updateInspectionPolicy = useMutation({
    mutationFn: async (inspectionPolicy: XBriefInspectionPolicy) => {
      if (!issueId) throw new Error('No xBRIEF issue selected');
      const response = await fetch(`/api/workspaces/${issueId}/plan/inspection-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inspectionPolicy }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return response.json() as Promise<XBriefDocument>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  useEffect(() => {
    if (!issueId) return;
    dialogRef.current?.focus();
  }, [issueId]);

  useEffect(() => {
    if (!issueId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeXbriefViewer();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeXbriefViewer, issueId]);

  if (!issueId) return null;

  return (
    <div className="fixed inset-0 z-[110] flex p-3 sm:p-5">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeXbriefViewer}
        data-testid="xbrief-fullscreen-scrim"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="xbrief-fullscreen-title"
        tabIndex={-1}
        className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <ScrollText className="h-5 w-5 shrink-0 text-signal-review" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="xbrief-fullscreen-title" className="font-medium text-foreground">
                Full-screen xBRIEF
              </h2>
              <div className="truncate font-mono text-xs text-muted-foreground">{issueId}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={closeXbriefViewer}
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close full-screen xBRIEF viewer"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Loading plan…
            </div>
          )}
          {isError && (
            <div className="flex flex-1 items-center justify-center text-sm text-destructive">
              Failed to load plan.
            </div>
          )}
          {!isLoading && !isError && (
            <XBriefViewer
              doc={data ?? null}
              onInspectionPolicyChange={(policy) => updateInspectionPolicy.mutate(policy)}
              isUpdatingInspectionPolicy={updateInspectionPolicy.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
