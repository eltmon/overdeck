import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useSharedTick } from '../../lib/useSharedTick';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { useDashboardStore, selectAgentList, selectIssues } from '../../lib/store';
import { cn } from '../../lib/utils';
import type { Agent, Issue } from '../../types';
import AgentCard, { type AgentCardRole } from '../primitives/AgentCard';
import MetricStrip from '../primitives/MetricStrip';
import type { VerbBadgeProps } from '../primitives/VerbBadge';

const ROLE_ORDER = {
  plan: 0,
  work: 1,
  review: 2,
  test: 3,
  ship: 4,
} satisfies Record<AgentCardRole, number>;

const ACTIVE_STATUSES = new Set<Agent['status']>(['healthy', 'warning', 'stuck', 'stopped', 'starting', 'running', 'failed']);
const PHASE_FILTERS = ['work', 'review', 'ship', 'plan', 'stuck'] as const;
type AgentPhaseFilter = typeof PHASE_FILTERS[number];

type AgentsFilterState = {
  phases: AgentPhaseFilter[];
  projects: string[];
  models: string[];
};

type FilterOption = {
  id: string;
  name: string;
};

type CostTrend = {
  totalCost?: number;
  totalTokens?: number;
};

type CostTrendsResponse = {
  trends?: CostTrend[];
};

async function fetchCostTrends(): Promise<CostTrendsResponse> {
  const res = await fetch('/api/costs/trends?days=1');
  if (!res.ok) return { trends: [] };
  return res.json();
}

function agentRole(agent: Agent): AgentCardRole {
  return agent.role ?? 'work';
}

function issueKey(issueId: string | undefined) {
  return issueId?.toLowerCase() ?? '';
}

function issueProject(issue: Issue | undefined) {
  return issue?.project?.name ?? issue?.sourceRepo ?? issue?.source ?? 'Unassigned project';
}

function issueProjectOption(issue: Issue | undefined): FilterOption {
  const name = issueProject(issue);
  return { id: issue?.project?.id ?? issue?.project?.name ?? issue?.sourceRepo ?? issue?.source ?? name, name };
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

function formatCost(value: number) {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(3)}`;
  return '$0';
}

function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
  return String(tokens);
}

function isRunningAgent(agent: Agent) {
  return agent.status !== 'stopped' && agent.status !== 'dead' && agent.status !== 'failed' && agent.status !== 'stuck';
}

function MetricIcon({ label }: { label: string }) {
  return <span aria-hidden="true">{label}</span>;
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

function agentPhase(agent: Agent): AgentPhaseFilter {
  if (agent.status === 'stuck' || agent.troubled || agent.status === 'failed') return 'stuck';
  const role = agentRole(agent);
  return role === 'test' ? 'review' : role;
}

function isFleetAgent(agent: Agent) {
  return agent.status !== 'dead' && (Boolean(agent.role) || ACTIVE_STATUSES.has(agent.status));
}

function parseList(value: string | null) {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

function readFilterState(): AgentsFilterState {
  if (typeof window === 'undefined') return { phases: [], projects: [], models: [] };

  const params = new URLSearchParams(window.location.search);
  const phases = parseList(params.get('phase')).filter((phase): phase is AgentPhaseFilter => PHASE_FILTERS.includes(phase as AgentPhaseFilter));
  return {
    phases,
    projects: parseList(params.get('projects')),
    models: parseList(params.get('models')),
  };
}

function replaceFilterUrl(filter: AgentsFilterState) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (filter.phases.length > 0) {
    url.searchParams.set('phase', filter.phases.join(','));
  } else {
    url.searchParams.delete('phase');
  }

  if (filter.projects.length > 0) {
    url.searchParams.set('projects', filter.projects.join(','));
  } else {
    url.searchParams.delete('projects');
  }

  if (filter.models.length > 0) {
    url.searchParams.set('models', filter.models.join(','));
  } else {
    url.searchParams.delete('models');
  }

  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((selected) => selected !== value) : [...values, value];
}

function filterSummary(selected: string[], options: FilterOption[], fallback: string) {
  if (selected.length === 0) return fallback;
  if (selected.length === 1) return options.find((option) => option.id === selected[0])?.name ?? selected[0];
  return `${selected.length} selected`;
}

function DropdownFilter({ label, selected, options, onToggle }: {
  label: string;
  selected: string[];
  options: FilterOption[];
  onToggle: (id: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <details className="group relative" data-component="agents-filter-dropdown">
      <summary className="flex cursor-pointer list-none items-center gap-[6px] rounded-[var(--radius-sm)] border border-border bg-card px-[10px] py-[6px] text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="max-w-[160px] truncate text-foreground">{filterSummary(selected, options, 'All')}</span>
      </summary>
      <div className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[220px] rounded-[14px] border border-border bg-popover p-[6px] shadow-lg">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label key={option.id} className="flex cursor-pointer items-center gap-[8px] rounded-[10px] px-[8px] py-[7px] text-[12px] text-popover-foreground hover:bg-accent">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={checked}
                onChange={() => onToggle(option.id)}
              />
              <span className="truncate">{option.name}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

export function FleetAgentsView() {
  const now = useSharedTick();
  const agents = useDashboardStore(selectAgentList) as Agent[];
  const issues = useDashboardStore(selectIssues) as Issue[];
  const agentOutputById = useDashboardStore((state) => state.agentOutputById);
  const openIssue = useDashboardStore((state) => state.openIssue);
  const [filter, setFilter] = useState(readFilterState);
  const { data: costTrends = { trends: [] } } = useQuery({
    queryKey: ['agents-cost-trends'],
    queryFn: fetchCostTrends,
    staleTime: 10_000,
  });

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

  const projectOptions = useMemo(() => {
    const map = new Map<string, FilterOption>();
    for (const agent of fleetAgents) {
      const issue = issuesById.get(issueKey(agent.issueId));
      const option = issueProjectOption(issue);
      if (!map.has(option.id)) map.set(option.id, option);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [fleetAgents, issuesById]);

  const modelOptions = useMemo(() => {
    const map = new Map<string, FilterOption>();
    for (const agent of fleetAgents) {
      if (!map.has(agent.model)) map.set(agent.model, { id: agent.model, name: compactModel(agent.model) });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [fleetAgents]);

  const filteredAgents = useMemo(() => fleetAgents.filter((agent) => {
    const issue = issuesById.get(issueKey(agent.issueId));
    if (filter.phases.length > 0 && !filter.phases.includes(agentPhase(agent))) return false;
    if (filter.projects.length > 0 && !filter.projects.includes(issueProjectOption(issue).id)) return false;
    if (filter.models.length > 0 && !filter.models.includes(agent.model)) return false;
    return true;
  }), [filter, fleetAgents, issuesById]);

  const metricTiles = useMemo(() => {
    const runningAgents = fleetAgents.filter(isRunningAgent);
    const stuckAgents = fleetAgents.filter((agent) => agent.status === 'stuck' || agent.troubled || agent.status === 'failed');
    const queuedAgents = fleetAgents.filter((agent) => agent.status === 'starting');
    const avgRuntime = runningAgents.length === 0
      ? 0
      : runningAgents.reduce((total, agent) => total + Math.max(0, now.getTime() - new Date(agent.startedAt).getTime()), 0) / runningAgents.length;
    const cost24h = costTrends.trends?.reduce((total, trend) => total + (trend.totalCost ?? 0), 0) ?? 0;
    const tokens24h = costTrends.trends?.reduce((total, trend) => total + (trend.totalTokens ?? 0), 0) ?? 0;

    return [
      { id: 'running', eyebrow: 'Running', value: runningAgents.length, sub: 'live agents', icon: <MetricIcon label="▶" />, signal: 'info' as const },
      { id: 'stuck', eyebrow: 'Stuck', value: stuckAgents.length, sub: 'needs attention', icon: <MetricIcon label="!" />, signal: 'destructive' as const },
      {
        id: 'cost',
        eyebrow: 'Cost 24h',
        value: formatCost(cost24h),
        sub: 'canonical /costs',
        icon: <MetricIcon label="$" />,
        signal: 'cost' as const,
        title: 'Open /costs for canonical 24h spend numbers',
      },
      { id: 'tokens', eyebrow: 'Tokens 24h', value: formatTokens(tokens24h), sub: 'cost events', icon: <MetricIcon label="#" />, signal: 'muted' as const },
      { id: 'runtime', eyebrow: 'Avg runtime', value: formatDuration(avgRuntime), sub: 'running agents', icon: <MetricIcon label="⏱" />, signal: 'review' as const },
      { id: 'queue', eyebrow: 'Queue', value: queuedAgents.length, sub: 'starting agents', icon: <MetricIcon label="…" />, signal: 'warning' as const },
    ];
  }, [costTrends.trends, fleetAgents, now]);

  function updateFilter(next: AgentsFilterState) {
    setFilter(next);
    replaceFilterUrl(next);
  }

  function togglePhase(phase: AgentPhaseFilter) {
    updateFilter({ ...filter, phases: toggleValue(filter.phases, phase) as AgentPhaseFilter[] });
  }

  function clearPhases() {
    updateFilter({ ...filter, phases: [] });
  }

  function toggleProject(projectId: string) {
    updateFilter({ ...filter, projects: toggleValue(filter.projects, projectId) });
  }

  function toggleModel(model: string) {
    updateFilter({ ...filter, models: toggleValue(filter.models, model) });
  }

  function openAgentIssue(issueId: string) {
    openIssue(issueId, 'overview');
    const url = new URL(window.location.href);
    url.hash = 'active-agent';
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

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
      <MetricStrip tiles={metricTiles} columns={6} variant="agents" className="mb-[14px]" />
      <div className="mb-[14px] flex flex-wrap items-center gap-[8px] rounded-[18px] border border-border bg-background/80 px-[12px] py-[10px]" data-component="agents-filter-row">
        <div className="flex items-center gap-[4px] rounded-[var(--radius-sm)] border border-border bg-card p-[2px]" aria-label="Agents phase filter">
          <button
            type="button"
            className={cn(
              'rounded-[calc(var(--radius-sm)-2px)] px-[9px] py-[5px] text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
              filter.phases.length === 0 && 'bg-accent text-foreground',
            )}
            aria-pressed={filter.phases.length === 0}
            onClick={clearPhases}
          >
            All
          </button>
          {PHASE_FILTERS.map((phase) => (
            <button
              key={phase}
              type="button"
              className={cn(
                'rounded-[calc(var(--radius-sm)-2px)] px-[9px] py-[5px] text-[11px] font-medium capitalize text-muted-foreground transition-colors hover:text-foreground',
                filter.phases.includes(phase) && 'bg-accent text-foreground',
              )}
              aria-pressed={filter.phases.includes(phase)}
              onClick={() => togglePhase(phase)}
            >
              {phase}
            </button>
          ))}
        </div>
        <DropdownFilter label="Project" selected={filter.projects} options={projectOptions} onToggle={toggleProject} />
        <DropdownFilter label="Model" selected={filter.models} options={modelOptions} onToggle={toggleModel} />
        <span className="ml-auto text-[11px] font-medium text-muted-foreground">{filteredAgents.length} / {fleetAgents.length} agents</span>
      </div>
      {filteredAgents.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No agents match the selected filters.
        </div>
      ) : (
        <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
          {filteredAgents.map((agent) => {
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
                onOpenIssue={agent.issueId ? () => openAgentIssue(agent.issueId!) : undefined}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
