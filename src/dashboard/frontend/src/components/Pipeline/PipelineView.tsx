import { useMemo } from 'react';
import type { ReviewStatusSnapshot } from '@panctl/contracts';

import { useDashboardStore, selectAgentList, selectIssues } from '../../lib/store';
import { getPipelineIssuePhase, type PipelineIssuePhase } from '../../lib/pipeline-state';
import type { Agent, Issue } from '../../types';
import MetricStrip from '../primitives/MetricStrip';
import PhaseHeader from '../primitives/PhaseHeader';
import IssueRow, { type IssueRowPriority } from '../primitives/IssueRow';
import TopBar from '../primitives/TopBar';

const PHASES: PipelineIssuePhase[] = ['ship', 'review', 'work', 'plan', 'todo'];

const PRIORITY_MAP: Record<number, IssueRowPriority> = {
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
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

export function PipelineView() {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];
  const openIssue = useDashboardStore((state) => state.openIssue);

  const agentByIssueId = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) {
      if (agent.issueId && !map.has(agent.issueId)) {
        map.set(agent.issueId, agent);
      }
    }
    return map;
  }, [agents]);

  const groupedIssues = useMemo(() => {
    const groups: Record<PipelineIssuePhase, Issue[]> = {
      ship: [],
      review: [],
      work: [],
      plan: [],
      todo: [],
    };

    for (const issue of issues) {
      const agent = agentByIssueId.get(issue.identifier) ?? null;
      const reviewStatus = reviewStatusForIssue(reviewStatusByIssueId, issue);
      groups[getPipelineIssuePhase(issue, reviewStatus, agent)].push(issue);
    }

    return groups;
  }, [agentByIssueId, issues, reviewStatusByIssueId]);

  return (
    <section className="flex h-full w-full flex-col overflow-hidden bg-background" data-component="pipeline-view">
      <TopBar title="Pipeline" eyebrow="Unified operations" />
      <MetricStrip columns={5} tiles={[]} />
      <div className="flex-1 overflow-auto">
        {PHASES.map((phase) => (
          <section key={phase} data-component="pipeline-phase" data-phase={phase}>
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
