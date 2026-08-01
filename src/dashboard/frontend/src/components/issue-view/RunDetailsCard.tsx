import { PanOpenInPicker } from '../PanOpenInPicker';
import type { IssueViewModel } from './types';

function formatStarted(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RunDetailsCard({ model }: { model: IssueViewModel }) {
  const agent = model.agents.find((candidate) => candidate.active) ?? model.agents[0] ?? null;
  const workspacePath = model.resources.workspace?.path ?? null;

  return (
    <section data-testid="run-details-card" className="rounded-[var(--radius)] border border-border bg-card p-3">
      <h3 className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Run details</h3>
      {agent ? (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
          <dt className="text-muted-foreground">Role</dt>
          <dd className="truncate text-foreground">{agent.role ?? agent.label}</dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="truncate font-mono text-foreground">{agent.model || 'unknown'}</dd>
          <dt className="text-muted-foreground">Harness</dt>
          <dd className="truncate font-mono text-foreground">{agent.harness ?? 'unknown'}</dd>
          <dt className="text-muted-foreground">Started</dt>
          <dd className="truncate text-foreground">
            <time dateTime={agent.startedAt}>{formatStarted(agent.startedAt)}</time>
          </dd>
          <dt className="text-muted-foreground">Workspace</dt>
          <dd className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate font-mono text-foreground" title={workspacePath ?? undefined}>
              {workspacePath ?? 'Unavailable'}
            </span>
            {workspacePath ? <PanOpenInPicker openInCwd={workspacePath} compact /> : null}
          </dd>
        </dl>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">No agent run recorded yet.</p>
      )}
    </section>
  );
}
