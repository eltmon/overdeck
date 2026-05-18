import { useMemo } from 'react';
import { Workflow } from 'lucide-react';
import { useDashboardStore, selectIssues, selectAgentList } from '../../lib/store';
import { getIssuePhase } from '../../lib/pipeline-state';
import type { Issue } from '../../types';
import type { ReviewStatusSnapshot, AgentSnapshot } from '@panctl/contracts';
import PhaseHeader from '../primitives/PhaseHeader';

const PHASE_ORDER: Array<'todo' | 'plan' | 'work' | 'review' | 'ship'> = [
  'todo',
  'plan',
  'work',
  'review',
  'ship',
];

const PHASE_LABELS: Record<(typeof PHASE_ORDER)[number], string> = {
  todo: 'Todo',
  plan: 'Plan',
  work: 'Work',
  review: 'Review',
  ship: 'Ship',
};

export function PipelineView() {
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];
  const agents = useDashboardStore(selectAgentList) as unknown as AgentSnapshot[];
  const reviewStatusByIssueId = useDashboardStore((s) => s.reviewStatusByIssueId);

  const grouped = useMemo(() => {
    const buckets: Record<(typeof PHASE_ORDER)[number], Issue[]> = {
      todo: [],
      plan: [],
      work: [],
      review: [],
      ship: [],
    };

    for (const issue of issues) {
      const reviewStatus = reviewStatusByIssueId[issue.identifier] as
        | ReviewStatusSnapshot
        | undefined;
      const phase = getIssuePhase(
        {
          identifier: issue.identifier,
          state: issue.state,
          hasPlan: issue.hasPlan,
          planningComplete: issue.planningComplete,
        },
        reviewStatus,
        agents,
      );

      if (phase === 'done') continue;
      if (buckets[phase]) {
        buckets[phase].push(issue);
      }
    }

    return buckets;
  }, [issues, reviewStatusByIssueId, agents]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* TopBar — 52px */}
      <div
        className="flex items-center gap-3 px-4 shrink-0 border-b border-border"
        style={{ height: 52 }}
      >
        <Workflow className="w-5 h-5 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Pipeline</span>
      </div>

      {/* MetricStrip placeholder — wired in p2 */}
      <div className="shrink-0" />

      {/* Phase groups — IssueRow lists wired in p3 */}
      <div className="flex-1 overflow-auto">
        {PHASE_ORDER.map((phase) => {
          const count = grouped[phase].length;
          if (count === 0) return null;
          return (
            <div key={phase}>
              <PhaseHeader
                phase={phase}
                count={count}
                title={PHASE_LABELS[phase]}
                variant="pipeline"
              />
              <div className="h-px bg-border" />
            </div>
          );
        })}
      </div>

      {/* Footer-empty zone */}
      <div className="shrink-0 h-px bg-border" />
    </div>
  );
}
