import { useMemo, useRef, useState, useEffect } from 'react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';

import { useCostStream, type CostEvent } from '../../hooks/useCostStream';
import { useDashboardStore, selectAgents, selectIssues } from '../../lib/store';
import { getPipelineIssuePhase, isAgentRunningStatus, type PipelineIssuePhase } from '../../lib/pipeline-state';
import { useSharedTick } from '../../lib/useSharedTick';
import { cn } from '../../lib/utils';
import type { Agent, Issue } from '../../types';
import MetricStrip from '../primitives/MetricStrip';
import PhaseHeader from '../primitives/PhaseHeader';
import IssueRow, { type IssueRowPriority } from '../primitives/IssueRow';
import TopBar from '../primitives/TopBar';
import VerbBadge from '../primitives/VerbBadge';

const PHASES: PipelineIssuePhase[] = ['ship', 'review', 'verifying', 'work', 'plan', 'todo'];
const PHASE_FILTERS: Array<PipelineIssuePhase | 'all'> = ['all', ...PHASES];

const PRIORITY_MAP: Record<number, IssueRowPriority> = {
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

type PipelineFilterState = {
  phase: PipelineIssuePhase | 'all';
  projects: string[];
  blocked: boolean;
  noPr: boolean;
};

type ProjectOption = {
  id: string;
  name: string;
};

function costEventsTotal(eventsByIssue: Record<string, CostEvent[]>) {
  return Object.values(eventsByIssue).reduce(
    (total, events) => total + events.reduce((sum, event) => sum + event.cost, 0),
    0,
  );
}

function reviewStatusForIssue(reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>, issue: Issue) {
  return reviewStatusByIssueId[issue.identifier] ?? reviewStatusByIssueId[issue.identifier.toUpperCase()];
}

function priorityForIssue(priority: number): IssueRowPriority {
  return PRIORITY_MAP[priority] ?? 'low';
}

function agentSub(agent: Agent) {
  return [agent.model, agent.status].filter(Boolean).join(' · ');
}

function priorityRank(priority: number) {
  return 5 - priority;
}

function comparePipelineIssues(a: Issue, b: Issue) {
  const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function readFilterState(): PipelineFilterState {
  if (typeof window === 'undefined') {
    return { phase: 'all', projects: [], blocked: false, noPr: false };
  }

  const params = new URLSearchParams(window.location.search);
  const phaseParam = params.get('phase');
  const phase = PHASES.includes(phaseParam as PipelineIssuePhase) ? (phaseParam as PipelineIssuePhase) : 'all';
  const projects = params.get('projects')?.split(',').map((project) => project.trim()).filter(Boolean) ?? [];

  return {
    phase,
    projects,
    blocked: params.has('blocked'),
    noPr: params.has('noPr'),
  };
}

function replaceFilterUrl(filter: PipelineFilterState) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (filter.phase === 'all') {
    url.searchParams.delete('phase');
  } else {
    url.searchParams.set('phase', filter.phase);
  }

  if (filter.projects.length > 0) {
    url.searchParams.set('projects', filter.projects.join(','));
  } else {
    url.searchParams.delete('projects');
  }

  if (filter.blocked) {
    url.searchParams.set('blocked', '1');
  } else {
    url.searchParams.delete('blocked');
  }

  if (filter.noPr) {
    url.searchParams.set('noPr', '1');
  } else {
    url.searchParams.delete('noPr');
  }

  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function projectOptionForIssue(issue: Issue): ProjectOption | null {
  if (!issue.project) return null;
  return { id: issue.project.id || issue.project.name, name: issue.project.name };
}

function isBlockedFromMerge(reviewStatus?: ReviewStatusSnapshot | null) {
  return Boolean(
    reviewStatus &&
      (reviewStatus.blockerReasons?.length ?? 0) > 0 &&
      reviewStatus.mergeStatus !== 'merged' &&
      reviewStatus.reviewStatus === 'passed' &&
      (reviewStatus.testStatus === 'passed' || reviewStatus.testStatus === 'skipped'),
  );
}

function isOpenMergeRequest(reviewStatus?: ReviewStatusSnapshot | null) {
  return Boolean(reviewStatus?.prUrl && reviewStatus.readyForMerge !== true && reviewStatus.mergeStatus !== 'merged');
}

function filterMatchesShipModifier(filter: PipelineFilterState, reviewStatus?: ReviewStatusSnapshot | null) {
  if (filter.phase !== 'ship') return true;
  if (filter.blocked && !isBlockedFromMerge(reviewStatus)) return false;
  if (filter.noPr && !isOpenMergeRequest(reviewStatus)) return false;
  return true;
}

function isClosedIssue(issue: Issue) {
  const state = issue.state ?? issue.status;
  return issue.stateType === 'completed' || issue.stateType === 'canceled' || state === 'done' || state === 'canceled' || state === 'Canceled' || state === 'Closed' || state === 'Completed';
}

function isRunningAgent(agent: Agent) {
  return isAgentRunningStatus(agent.status);
}

function formatCost(value: number) {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value > 0) return `$${value.toFixed(3)}`;
  return '$0';
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const safeMs = Math.max(0, ms);
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function MetricIcon({ label }: { label: string }) {
  return <span aria-hidden="true">{label}</span>;
}

function verbBadgeForPhase(phase: PipelineIssuePhase) {
  if (phase === 'ship') return <VerbBadge variant="READY TO MERGE" />;
  if (phase === 'review') return <VerbBadge variant="REVIEW RUNNING" />;
  if (phase === 'verifying') return <VerbBadge variant="MERGED" />;
  if (phase === 'work') return <VerbBadge variant="WORK RUNNING" />;
  if (phase === 'plan') return <VerbBadge variant="PLANNING" />;
  return <VerbBadge variant="QUEUED FOR PLAN" />;
}

type PipelineViewProps = {
  onSearchOpen?: () => void;
  onTabChange?: (tab: string) => void;
};

export function PipelineView({ onSearchOpen, onTabChange }: PipelineViewProps = {}) {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const openIssue = useDashboardStore((state) => state.openIssue);
  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  const [filter, setFilter] = useState(readFilterState);
  const { eventsByIssue } = useCostStream({ limit: 500 });
  const now = useSharedTick(30000);
  const phaseRefs = useRef<Record<PipelineIssuePhase, HTMLElement | null>>({
    ship: null,
    review: null,
    verifying: null,
    work: null,
    plan: null,
    todo: null,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef<number>(0);

  useEffect(() => {
    if (drawerIssueId === null && savedScrollTop.current > 0) {
      const el = scrollContainerRef.current;
      if (el) {
        window.requestAnimationFrame(() => {
          el.scrollTop = savedScrollTop.current;
        });
      }
    }
  }, [drawerIssueId]);

  useEffect(() => {
    const handlePopState = () => setFilter(readFilterState());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const agentByIssueId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      const key = agent.issueId?.toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, agent);
      }
    }
    return map;
  }, [agents]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, ProjectOption>();
    for (const issue of issues) {
      const option = projectOptionForIssue(issue);
      if (option && !map.has(option.id)) {
        map.set(option.id, option);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  const groupedIssues = useMemo(() => {
    const groups: Record<PipelineIssuePhase, Issue[]> = {
      ship: [],
      review: [],
      verifying: [],
      work: [],
      plan: [],
      todo: [],
    };

    for (const issue of issues) {
      if (isClosedIssue(issue)) continue;

      const projectOption = projectOptionForIssue(issue);
      if (filter.projects.length > 0 && (!projectOption || !filter.projects.includes(projectOption.id))) {
        continue;
      }

      const agent = agentByIssueId.get(issue.identifier.toLowerCase()) ?? null;
      const reviewStatus = reviewStatusForIssue(reviewStatusByIssueId, issue);
      let phase = getPipelineIssuePhase(issue, reviewStatus, agent);

      if (filter.phase === 'ship' && (isBlockedFromMerge(reviewStatus) || isOpenMergeRequest(reviewStatus))) {
        phase = 'ship';
      }

      if (filter.phase !== 'all' && phase !== filter.phase) {
        continue;
      }

      if (!filterMatchesShipModifier(filter, reviewStatus)) {
        continue;
      }

      groups[phase].push(issue);
    }

    for (const phase of PHASES) {
      groups[phase].sort(comparePipelineIssues);
    }

    return groups;
  }, [agentByIssueId, filter, issues, reviewStatusByIssueId]);

  const metricTiles = useMemo(() => {
    const activeIssues = issues.filter((issue) => !isClosedIssue(issue)).length;
    const workRunning = agents.filter((agent) => agent.role === 'work' && isRunningAgent(agent)).length;
    const reviewIssueIds = new Set<string>();

    for (const agent of agents) {
      if ((agent.role === 'review' || agent.role === 'test') && isRunningAgent(agent) && agent.issueId) {
        reviewIssueIds.add(agent.issueId);
      }
    }

    for (const status of Object.values(reviewStatusByIssueId)) {
      if (
        status.reviewStatus === 'reviewing' ||
        status.testStatus === 'testing' ||
        status.verificationStatus === 'running'
      ) {
        reviewIssueIds.add(status.issueId);
      }
    }

    const readyToShip = Object.values(reviewStatusByIssueId).filter(
      (status) => status.readyForMerge === true && status.mergeStatus !== 'merged',
    ).length;
    const spend = costEventsTotal(eventsByIssue);

    return [
      { id: 'active', eyebrow: 'Active issues', value: activeIssues, sub: 'open pipeline', icon: <MetricIcon label="●" />, signal: 'info' as const },
      { id: 'work', eyebrow: 'Work running', value: workRunning, sub: 'work agents', icon: <MetricIcon label="▶" />, signal: 'info' as const },
      { id: 'review', eyebrow: 'Review running', value: reviewIssueIds.size, sub: 'review gates', icon: <MetricIcon label="◆" />, signal: 'review' as const },
      { id: 'ship', eyebrow: 'Ship', value: readyToShip, sub: 'ready to merge', icon: <MetricIcon label="↑" />, signal: 'success' as const },
      { id: 'spend', eyebrow: 'Spend', value: formatCost(spend), sub: '24h spend', icon: <MetricIcon label="$" />, signal: 'cost' as const },
    ];
  }, [agents, eventsByIssue, issues, reviewStatusByIssueId]);

  const visiblePhases = filter.phase === 'all' ? PHASES : [filter.phase];

  function updateFilter(next: PipelineFilterState, scrollToPhase?: PipelineIssuePhase) {
    setFilter(next);
    replaceFilterUrl(next);
    if (scrollToPhase) {
      window.requestAnimationFrame(() => phaseRefs.current[scrollToPhase]?.scrollIntoView?.({ block: 'start' }));
    }
  }

  function selectPhase(phase: PipelineIssuePhase | 'all') {
    const next = { ...filter, phase };
    updateFilter(next, phase === 'all' ? undefined : phase);
  }

  function toggleProject(projectId: string) {
    const projects = filter.projects.includes(projectId)
      ? filter.projects.filter((selected) => selected !== projectId)
      : [...filter.projects, projectId];
    updateFilter({ ...filter, projects });
  }

  function toggleShipModifier(modifier: 'blocked' | 'noPr') {
    updateFilter({ ...filter, phase: 'ship', [modifier]: !filter[modifier] }, 'ship');
  }

  return (
    <section className="flex h-full w-full flex-col overflow-hidden bg-background" data-component="pipeline-view">
      <TopBar
        title="Pipeline"
        breadcrumb="Unified operations"
        search={
          onSearchOpen ? (
            <button
              type="button"
              data-component="pipeline-search-trigger"
              onClick={onSearchOpen}
              className="flex h-[32px] w-full min-w-[280px] items-center gap-[8px] rounded-[var(--radius-lg)] border border-border bg-card px-[10px] text-[12px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              Search issues, agents, branches…
            </button>
          ) : undefined
        }
        segmentedControl={
          onTabChange ? (
            <div
              data-component="pipeline-segmented-control"
              className="flex items-center gap-[2px] rounded-[var(--radius-lg)] border border-border bg-card p-[2px]"
            >
              {(['List', 'Board', 'Analytics'] as const).map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={label === 'List'}
                  onClick={() => {
                    if (label === 'Board') onTabChange('kanban');
                    else if (label === 'Analytics') onTabChange('metrics');
                  }}
                  className={cn(
                    'rounded-[calc(var(--radius-lg)-2px)] px-[10px] py-[5px] text-[12px] font-medium leading-none text-muted-foreground transition-colors hover:text-foreground',
                    label === 'List' && 'bg-accent text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : undefined
        }
        actions={
          onSearchOpen ? (
            <button
              type="button"
              data-component="pipeline-start-agent"
              onClick={onSearchOpen}
              className="flex h-[32px] items-center gap-[6px] rounded-[var(--radius-lg)] bg-primary px-[14px] text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <span aria-hidden="true">▶</span>
              Start agent
            </button>
          ) : undefined
        }
      />
      <MetricStrip columns={5} tiles={metricTiles} />
      <div className="flex shrink-0 flex-wrap items-center gap-[8px] border-b border-border bg-background px-[22px] py-[10px]" data-component="pipeline-filter-row">
        <div className="flex items-center gap-[4px] rounded-[var(--radius-sm)] border border-border bg-card p-[2px]" aria-label="Pipeline phase filter">
          {PHASE_FILTERS.map((phase) => (
            <button
              key={phase}
              type="button"
              className={cn(
                'rounded-[calc(var(--radius-sm)-2px)] px-[9px] py-[5px] text-[11px] font-medium capitalize text-muted-foreground transition-colors hover:text-foreground',
                filter.phase === phase && 'bg-accent text-foreground',
              )}
              aria-pressed={filter.phase === phase}
              onClick={() => selectPhase(phase)}
            >
              {phase}
            </button>
          ))}
        </div>
        {projectOptions.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-[6px]" aria-label="Pipeline project filter">
            {projectOptions.map((project) => {
              const selected = filter.projects.includes(project.id);
              return (
                <button
                  key={project.id}
                  type="button"
                  className={cn(
                    'rounded-full border border-border px-[9px] py-[5px] text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                    selected && 'border-primary/50 bg-primary/10 text-foreground',
                  )}
                  aria-pressed={selected}
                  onClick={() => toggleProject(project.id)}
                >
                  {project.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-[6px]" aria-label="Pipeline merge modifiers">
          <button
            type="button"
            className={cn(
              'rounded-[var(--radius-sm)] border border-border px-[9px] py-[5px] text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
              filter.phase === 'ship' && filter.blocked && 'border-warning/50 bg-warning/10 text-foreground',
            )}
            aria-pressed={filter.phase === 'ship' && filter.blocked}
            onClick={() => toggleShipModifier('blocked')}
          >
            Blocked
          </button>
          <button
            type="button"
            className={cn(
              'rounded-[var(--radius-sm)] border border-border px-[9px] py-[5px] text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
              filter.phase === 'ship' && filter.noPr && 'border-info/50 bg-info/10 text-foreground',
            )}
            aria-pressed={filter.phase === 'ship' && filter.noPr}
            onClick={() => toggleShipModifier('noPr')}
          >
            No PR
          </button>
        </div>
      </div>
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        {visiblePhases.every((phase) => groupedIssues[phase].length === 0) ? (
          <div
            data-component="pipeline-empty-state"
            className="mx-[22px] mt-[24px] rounded-[18px] border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground"
          >
            No issues match the selected filters.
          </div>
        ) : visiblePhases.map((phase) => (
          <section
            key={phase}
            ref={(element) => {
              phaseRefs.current[phase] = element;
            }}
            data-component="pipeline-phase"
            data-phase={phase}
          >
            <PhaseHeader phase={phase} count={groupedIssues[phase].length} />
            {groupedIssues[phase].map((issue) => {
              const agent = agentByIssueId.get(issue.identifier.toLowerCase());
              const costEvents = eventsByIssue[issue.identifier];
              const costSum = costEvents?.reduce((sum, event) => sum + event.cost, 0) ?? 0;
              const ledger = {
                runtime: agent?.startedAt
                  ? formatDuration(now.getTime() - new Date(agent.startedAt).getTime())
                  : undefined,
                cost: costSum > 0 ? formatCost(costSum) : undefined,
              };
              return (
                <IssueRow
                  key={issue.identifier}
                  issueId={issue.identifier}
                  phase={phase}
                  priority={priorityForIssue(issue.priority)}
                  title={issue.title}
                  project={issue.project ? { name: issue.project.name } : undefined}
                  labels={issue.labels.slice(0, 3)}
                  verbBadge={verbBadgeForPhase(phase)}
                  agent={agent ? { name: agent.id, sub: agentSub(agent) } : undefined}
                  ledger={ledger}
                  assignee={issue.assignee ? { name: issue.assignee.name } : undefined}
                  onOpen={(id) => { savedScrollTop.current = scrollContainerRef.current?.scrollTop ?? 0; openIssue(id); }}
                />
              );
            })}
          </section>
        ))}
        <div className="h-[72px]" data-component="pipeline-footer-empty" />
      </div>
    </section>
  );
}
