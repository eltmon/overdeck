import { useMemo } from 'react';

import { useSharedTick } from '../../lib/useSharedTick';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { useDashboardStore, selectAgentList, selectIssues } from '../../lib/store';
import type { Agent, Issue } from '../../types';
import AgentCard, { type AgentCardRole } from '../primitives/AgentCard';
import type { VerbBadgeProps } from '../primitives/VerbBadge';

const ROLE_ORDER = {
  plan: 0,
  work: 1,
  review: 2,
  test: 3,
  ship: 4,
} satisfies Record<AgentCardRole, number>;

const ACTIVE_STATUSES = new Set<Agent['status']>(['healthy', 'warning', 'stuck', 'stopped', 'starting', 'running', 'failed']);

function agentRole(agent: Agent): AgentCardRole {
  return agent.role ?? 'work';
}

function issueKey(issueId: string | undefined) {
  return issueId?.toLowerCase() ?? '';
}

function issueProject(issue: Issue | undefined) {
  return issue?.project?.name ?? issue?.sourceRepo ?? issue?.source ?? 'Unassigned project';
}

function compactModel(model: string) {
  return model.replace(/^claude-/, '').replace(/-202\d{5,8}$/, '');
}

function formatDuration(ms: number) {
  const safeMs = Math.max(0, ms);
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function stuckHours(agent: Agent, now: Date) {
  const since = agent.firstFailureInRunAt ?? agent.lastFailureAt ?? agent.lastActivity ?? agent.startedAt;
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 3_600_000));
}

function verbBadgeForAgent(agent: Agent, now: Date): VerbBadgeProps {
  if (agent.status === 'stuck' || agent.troubled || agent.status === 'failed') {
    return { variant: 'STUCK · Nh', hours: stuckHours(agent, now) };
  }
  if (agent.hasPendingQuestion) return { variant: 'INPUT' };

  switch (agent.role) {
    case 'plan':
      return { variant: 'PLANNING' };
    case 'review':
    case 'test':
      return { variant: 'REVIEW RUNNING' };
    case 'ship':
      return { variant: 'SHIP RUNNING' };
    case 'work':
    default:
      return { variant: 'WORK RUNNING' };
  }
}

function isFleetAgent(agent: Agent) {
  return agent.status !== 'dead' && (Boolean(agent.role) || ACTIVE_STATUSES.has(agent.status));
}

export function FleetAgentsView() {
  const now = useSharedTick();
  const agents = useDashboardStore(selectAgentList) as Agent[];
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agentOutputById = useDashboardStore((state) => state.agentOutputById);
  const openIssue = useDashboardStore((state) => state.openIssue);

  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) {
      map.set(issue.identifier.toLowerCase(), issue);
      map.set(issue.id.toLowerCase(), issue);
    }
    return map;
  }, [issues]);

  const fleetAgents = useMemo(() => (
    agents
      .filter(isFleetAgent)
      .sort((a, b) => {
        const stuckDelta = Number(b.status === 'stuck' || b.troubled) - Number(a.status === 'stuck' || a.troubled);
        if (stuckDelta !== 0) return stuckDelta;
        const roleDelta = ROLE_ORDER[agentRole(a)] - ROLE_ORDER[agentRole(b)];
        if (roleDelta !== 0) return roleDelta;
        return (b.lastActivity ?? b.startedAt).localeCompare(a.lastActivity ?? a.startedAt);
      })
  ), [agents]);

  if (fleetAgents.length === 0) {
    return (
      <section data-component="fleet-agents-view" className="p-6">
        <div className="rounded-[18px] border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No running, stuck, or idle agents.
        </div>
      </section>
    );
  }

  return (
    <section data-component="fleet-agents-view" className="p-6">
      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
        {fleetAgents.map((agent) => {
          const issue = issuesById.get(issueKey(agent.issueId));
          const role = agentRole(agent);
          const output = agentOutputById[agent.id] ?? [];
          const stuck = agent.status === 'stuck' || agent.troubled || agent.status === 'failed';
          const lastHeard = agent.lastActivity ? formatRelativeTime(agent.lastActivity, now) : '—';
          const runtime = formatDuration(now.getTime() - new Date(agent.startedAt).getTime());

          return (
            <AgentCard
              key={agent.id}
              id={agent.id}
              name={agent.issueId ?? agent.id}
              role={role}
              issue={agent.issueId ? {
                id: agent.issueId,
                title: issue?.title ?? agent.issueId,
                project: issueProject(issue),
              } : undefined}
              meta={[
                { label: 'Model', value: compactModel(agent.model) },
                { label: 'Runtime', value: runtime },
                { label: 'Last heard', value: lastHeard },
              ]}
              streamLines={output.slice(-8)}
              verbBadge={verbBadgeForAgent(agent, now)}
              stuck={stuck}
              stuckMessage={agent.lastFailureReason ?? agent.error ?? 'Agent requires attention.'}
              onOpenIssue={agent.issueId ? () => openIssue(agent.issueId!, 'overview') : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
