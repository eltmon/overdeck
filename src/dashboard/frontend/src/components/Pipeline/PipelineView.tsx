import { useMemo, useRef, useState } from 'react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';

import { useDashboardStore, selectAgentList, selectIssues } from '../../lib/store';
import { getPipelineIssuePhase, type PipelineIssuePhase } from '../../lib/pipeline-state';
import { cn } from '../../lib/utils';
import type { Agent, Issue } from '../../types';
import MetricStrip from '../primitives/MetricStrip';
import PhaseHeader from '../primitives/PhaseHeader';
import IssueRow, { type IssueRowPriority } from '../primitives/IssueRow';
import TopBar from '../primitives/TopBar';

const PHASES: PipelineIssuePhase[] = ['ship', 'review', 'work', 'plan', 'todo'];
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

function reviewStatusForIssue(reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>, issue: Issue) {
  return reviewStatusByIssueId[issue.identifier] ?? reviewStatusByIssueId[issue.identifier.toUpperCase()];
}

function priorityForIssue(priority: number): IssueRowPriority {
  return PRIORITY_MAP[priority] ?? 'low';
}

function agentSub(agent: Agent) {
  return [agent.model, agent.status].filter(Boolean).join(' · ');
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

export function PipelineView() {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];
  const openIssue = useDashboardStore((state) => state.openIssue);
  const [filter, setFilter] = useState(readFilterState);
  const phaseRefs = useRef<Record<PipelineIssuePhase, HTMLElement | null>>({
    ship: null,
    review: null,
    work: null,
    plan: null,
    todo: null,
  });

  const agentByIssueId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      if (agent.issueId && !map.has(agent.issueId)) {
        map.set(agent.issueId, agent);
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
      work: [],
      plan: [],
      todo: [],
    };

    for (const issue of issues) {
      const projectOption = projectOptionForIssue(issue);
      if (filter.projects.length > 0 && (!projectOption || !filter.projects.includes(projectOption.id))) {
        continue;
      }

      const agent = agentByIssueId.get(issue.identifier) ?? null;
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

    return groups;
  }, [agentByIssueId, filter, issues, reviewStatusByIssueId]);

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
      <TopBar title="Pipeline" eyebrow="Unified operations" />
      <MetricStrip columns={5} tiles={[]} />
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
      <div className="flex-1 overflow-auto">
        {visiblePhases.map((phase) => (
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
              const agent = agentByIssueId.get(issue.identifier);
              return (
                <IssueRow
                  key={issue.identifier}
                  issueId={issue.identifier}
                  phase={phase}
                  priority={priorityForIssue(issue.priority)}
                  title={issue.title}
                  project={issue.project ? { name: issue.project.name } : undefined}
                  labels={issue.labels.slice(0, 3)}
                  agent={agent ? { name: agent.id, sub: agentSub(agent) } : undefined}
                  assignee={issue.assignee ? { name: issue.assignee.name } : undefined}
                  onOpen={openIssue}
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
