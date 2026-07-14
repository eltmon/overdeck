import { ExternalLink } from 'lucide-react';
import { useWorkspaceQuery } from './ZoneCOverviewTabs/queries';
import { UatStackStatus, getUatStackSummary } from './UatStackStatus';

/**
 * UatEnvironmentPanel — the prominent "go UAT this feature" affordance shared
 * by the issue views (Console drawer overview + Cockpit mission-control
 * overview). Front and center: the clickable feature (frontend) URL the
 * operator opens to UAT the work, with the API URL beside it and the
 * container stack behind them (UatStackStatus). Reads the workspace endpoint
 * through useWorkspaceQuery so it shares the ['workspace', issueId] cache key
 * with the other views instead of adding a poll.
 */
export function UatEnvironmentPanel({ issueId, className = '' }: { issueId: string; className?: string }) {
  const ws = useWorkspaceQuery(issueId).data;
  if (!ws?.exists) return null;

  const summary = getUatStackSummary({ containers: ws.containers, stackHealth: ws.stackHealth });
  if (!ws.frontendUrl && !ws.apiUrl && !summary) return null;

  const displayUrl = ws.frontendUrl?.replace(/^https?:\/\//, '');

  return (
    <section
      data-section="uat-environment"
      data-testid="uat-environment-panel"
      className={`rounded-[var(--radius)] border border-border bg-card p-[14px] ${className}`}
    >
      <div className="mb-[8px] flex items-center gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          UAT environment
        </div>
        {ws.apiUrl && (
          <a
            href={ws.apiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-info-foreground hover:underline"
          >
            API <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {ws.frontendUrl && (
        <a
          href={ws.frontendUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open ${ws.frontendUrl} to UAT this feature`}
          className="mb-[10px] flex items-center gap-2 rounded-[var(--radius-sm)] border border-info/40 bg-info/10 px-3 py-2 text-[13px] font-medium text-info-foreground transition-colors hover:bg-info/20"
        >
          <span className="min-w-0 truncate font-mono">{displayUrl}</span>
          <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0" />
        </a>
      )}
      <UatStackStatus
        containers={ws.containers}
        stackHealth={ws.stackHealth}
        frontendUrl={ws.frontendUrl}
        apiUrl={ws.apiUrl}
        density="full"
      />
    </section>
  );
}
