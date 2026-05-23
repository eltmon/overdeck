import type { ReactNode } from 'react';
import type { FlywheelAgent, FlywheelStatus, FlywheelSubstrateBug, FlywheelSuggestion } from '@panctl/contracts';
import { AgentCard as ResourceAgentCard } from '../ResourceCard';
import { IssueRow, MetricStrip, MetricTile } from '../shared/statusPrimitives';
import type { Agent } from '../../types';
import { cn } from '../../lib/utils';

interface FlywheelStatusDetailsProps {
  status: FlywheelStatus;
  onNavigateAgent?: (agentId: string) => void;
  onNavigateIssue?: (issueId: string) => void;
}

type AgentStatus = Agent['status'];
type AgentRole = NonNullable<Agent['role']>;

const BUG_STATUS_CLASS: Record<FlywheelSubstrateBug['status'], string> = {
  fixed: 'bg-success/15 text-success border-success/30',
  filed: 'bg-primary/15 text-primary border-primary/30',
  workaround: 'bg-warning/15 text-warning border-warning/30',
};

const SUGGESTION_PRIORITY_CLASS: Record<FlywheelSuggestion['priority'], string> = {
  urgent: 'bg-destructive/15 text-destructive border-destructive/30',
  high: 'bg-warning/15 text-warning border-warning/30',
  medium: 'bg-primary/15 text-primary border-primary/30',
  low: 'bg-muted text-muted-foreground border-border',
};

const SUGGESTION_PRIORITY_ORDER: Record<FlywheelSuggestion['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const AGENT_STATUS_MAP: Record<FlywheelAgent['status'], AgentStatus> = {
  starting: 'starting',
  running: 'running',
  waiting: 'warning',
  idle: 'healthy',
  stopped: 'stopped',
  error: 'failed',
};

const ROLE_VALUES = new Set<AgentRole>(['plan', 'work', 'review', 'test', 'ship', 'flywheel']);

function formatMemory(mb: number): string {
  if (!Number.isFinite(mb)) return '—';
  if (Math.abs(mb) >= 1024) return `${(mb / 1024).toFixed(1)} GiB`;
  return `${Math.round(mb)} MiB`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function safeHttpUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeRole(role: string | undefined): AgentRole | undefined {
  return role && ROLE_VALUES.has(role as AgentRole) ? role as AgentRole : undefined;
}

export function adaptFlywheelAgent(agent: FlywheelAgent, lastTickAt: string): Agent {
  return {
    id: agent.id,
    issueId: agent.issueId ?? agent.label,
    runtime: 'claude-code',
    model: agent.model ?? 'unknown',
    status: AGENT_STATUS_MAP[agent.status],
    startedAt: lastTickAt,
    lastActivity: lastTickAt,
    consecutiveFailures: agent.status === 'error' ? 1 : 0,
    killCount: 0,
    role: normalizeRole(agent.role),
  };
}

function StatusBadge({ status }: { status: FlywheelSubstrateBug['status'] }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', BUG_STATUS_CLASS[status])}>
      {status}
    </span>
  );
}

function SuggestionPriorityBadge({ priority }: { priority: FlywheelSuggestion['priority'] }) {
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', SUGGESTION_PRIORITY_CLASS[priority])}>
      {priority}
    </span>
  );
}

function sortSuggestions(suggestions: ReadonlyArray<FlywheelSuggestion>): FlywheelSuggestion[] {
  return suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((left, right) => {
      const priorityDiff = SUGGESTION_PRIORITY_ORDER[left.suggestion.priority] - SUGGESTION_PRIORITY_ORDER[right.suggestion.priority];
      return priorityDiff === 0 ? left.index - right.index : priorityDiff;
    })
    .map(({ suggestion }) => suggestion);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function FlywheelStatusDetails({ status, onNavigateAgent, onNavigateIssue }: FlywheelStatusDetailsProps) {
  const ramAvailableMb = Math.max(status.system.ramTotalMb - status.system.ramUsedMb, 0);
  const swapAvailableMb = Math.max(status.system.swapTotalMb - status.system.swapUsedMb, 0);
  const navigateAgent = onNavigateAgent ?? (() => undefined);
  const navigateIssue = onNavigateIssue ?? (() => undefined);
  const sortedSuggestions = sortSuggestions(status.suggestions);

  return (
    <div className="space-y-4" aria-label="Flywheel status details">
      <Section title="Suggestions">
        {sortedSuggestions.length > 0 ? (
          <div className="space-y-3">
            {sortedSuggestions.map((suggestion, index) => {
              const issueId = suggestion.issueId;
              return (
                <div key={`${suggestion.priority}-${suggestion.action}-${issueId ?? 'system'}-${index}`} data-testid="flywheel-suggestion" className="rounded-md border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <SuggestionPriorityBadge priority={suggestion.priority} />
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {suggestion.action}
                    </span>
                    {issueId && (
                      <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => navigateIssue(issueId)}>
                        {issueId}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-foreground">{suggestion.rationale}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No suggestions yet — orchestrator will emit on next tick.</p>
        )}
      </Section>

      <MetricStrip>
        <MetricTile label="Bugs Fixed" value={status.headline.bugsFixed} tone="success" />
        <MetricTile
          label="SWARM Items"
          value={`${status.headline.swarmItemsMerged}/${status.headline.swarmItemsTotal}`}
          subtext="merged"
          tone="info"
        />
        <MetricTile label="PRs Merged" value={status.headline.prsMerged} tone="success" />
        <MetricTile label="Awaiting UAT" value={status.headline.awaitingUat} tone={status.headline.awaitingUat > 0 ? 'warning' : 'default'} />
      </MetricStrip>

      <Section title="Active Pipeline">
        {status.activePipeline.length > 0 ? (
          <div className="space-y-3">
            {status.activePipeline.map((item) => <IssueRow key={`${item.issueId}-${item.verb}`} item={item} />)}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active pipeline items.</p>
        )}
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <div className="space-y-4">
          <Section title="Substrate Bugs Filed and Fixed">
          {status.substrateBugs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="pb-2 pr-3 font-medium">Issue</th>
                    <th className="pb-2 pr-3 font-medium">Title</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium">Commit</th>
                  </tr>
                </thead>
                <tbody>
                  {status.substrateBugs.map((bug) => {
                    const commitUrl = safeHttpUrl(bug.url);
                    return (
                      <tr key={`${bug.issueId}-${bug.title}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs text-primary">{bug.issueId}</td>
                        <td className="py-2 pr-3 text-foreground">{bug.title}</td>
                        <td className="py-2 pr-3"><StatusBadge status={bug.status} /></td>
                        <td className="py-2 font-mono text-xs">
                          {bug.commitSha ? (
                            commitUrl ? (
                              <a className="text-primary hover:underline" href={commitUrl} target="_blank" rel="noreferrer">
                                {shortSha(bug.commitSha)}
                              </a>
                            ) : (
                              <span className="text-foreground">{shortSha(bug.commitSha)}</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No substrate bugs filed or fixed yet.</p>
          )}
        </Section>

        <Section title="Currently Running Agents">
          {status.agents.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {status.agents.map((agent) => (
                <div key={agent.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-foreground" title={agent.label}>{agent.label}</span>
                    {typeof agent.ctxPercent === 'number' && Number.isFinite(agent.ctxPercent) && (
                      <span className="shrink-0 text-muted-foreground">{Math.round(agent.ctxPercent)}% ctx</span>
                    )}
                  </div>
                  <ResourceAgentCard agent={adaptFlywheelAgent(agent, status.lastTickAt)} onNavigate={navigateAgent} />
                  {agent.currentAction && <p className="text-xs text-muted-foreground">{agent.currentAction}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No running Flywheel agents.</p>
          )}
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="System">
          <dl className="grid gap-3 text-sm">
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">RAM</dt>
              <dd className="mt-1 font-medium text-foreground">{formatMemory(status.system.ramUsedMb)} used / {formatMemory(ramAvailableMb)} available</dd>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Swap</dt>
              <dd className="mt-1 font-medium text-foreground">{formatMemory(status.system.swapUsedMb)} used / {formatMemory(swapAvailableMb)} available</dd>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Agents</dt>
              <dd className="mt-1 font-medium text-foreground">{status.system.agentsActive} / {status.system.agentsCap} active</dd>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Main HEAD</dt>
              <dd className="mt-1 font-mono text-sm font-medium text-foreground">{shortSha(status.system.mainHead)}</dd>
            </div>
          </dl>
        </Section>

        <Section title="Open Questions for the Next Tick">
          {status.openQuestions.length > 0 ? (
            <ul className="list-disc space-y-2 pl-5 text-sm text-foreground">
              {status.openQuestions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No open questions for the next tick.</p>
          )}
        </Section>
      </div>
    </div>
  </div>
  );
}
