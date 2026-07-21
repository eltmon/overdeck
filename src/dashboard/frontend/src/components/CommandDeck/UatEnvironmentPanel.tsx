import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useWorkspaceQuery } from './ZoneCOverviewTabs/queries';
import { UatStackStatus, getUatStackSummary } from './UatStackStatus';
import { resolveUatActions, type UatAction } from './uat-actions';
import { createUatActionHandler } from './ProjectTree/uat-action-handlers';

/**
 * UatEnvironmentPanel — the prominent "go UAT this feature" affordance shared
 * by the issue views (Console drawer overview + Cockpit mission-control
 * overview). Front and center: the clickable feature (frontend) URL the
 * operator opens to UAT the work, with the API URL beside it, the container
 * stack behind them (UatStackStatus), and the state-appropriate stack actions
 * (Start when stopped, Rebuild/Logs when unhealthy — same resolver the rail
 * uses). Reads the workspace endpoint through useWorkspaceQuery so it shares
 * the ['workspace', issueId] cache key with the other views instead of adding
 * a poll.
 */
function actionButtonClass(action: UatAction): string {
  if (action.tone === 'primary')
    return 'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info-foreground transition-colors hover:bg-info/20';
  if (action.tone === 'danger')
    return 'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive transition-colors hover:bg-destructive/10';
  return 'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent';
}

export function UatEnvironmentPanel({ issueId, className = '' }: { issueId: string; className?: string }) {
  const ws = useWorkspaceQuery(issueId).data;
  const queryClient = useQueryClient();
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  if (!ws?.exists) return null;

  const summary = getUatStackSummary({ containers: ws.containers, stackHealth: ws.stackHealth });
  if (!ws.frontendUrl && !ws.apiUrl && !summary) return null;

  const displayUrl = ws.frontendUrl?.replace(/^https?:\/\//, '');
  // The URL links render permanently below; the inline slots are for stack ops.
  const stackActions = summary
    ? resolveUatActions(summary.state).inline.filter((a) => a.id !== 'open-uat' && a.id !== 'open-api')
    : [];
  const runAction = async (action: UatAction) => {
    setPendingActionId(action.id);
    try {
      await createUatActionHandler({ issueId, workspace: ws, queryClient })(action);
    } finally {
      setPendingActionId(null);
    }
  };

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
        <div className="ml-auto flex items-center gap-1.5">
          {stackActions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={pendingActionId !== null}
              data-testid={`uat-panel-action-${action.id}`}
              className={actionButtonClass(action)}
              onClick={() => void runAction(action)}
            >
              {pendingActionId === action.id && <Loader2 className="h-3 w-3 animate-spin" />}
              {action.label}
            </button>
          ))}
          {ws.apiUrl && (
            <a
              href={ws.apiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-info-foreground hover:underline"
            >
              API <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
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
