import { ActivityFeed } from './ActivityFeed';
import { CostDonut } from './CostDonut';
import { InfraGauges } from './InfraGauges';
import type { Agent } from '../../types';

interface SidebarProps {
  agents: Agent[];
  velocity?: { transitionsPerHour: number; byStage: Record<string, number> } | null;
  onIssueHover?: (issueId: string) => void;
  onIssueSelect?: (issueId: string) => void;
}

const STAGE_LETTERS: readonly [string, string][] = [
  ['P', 'plan'],
  ['W', 'work'],
  ['R', 'review'],
  ['T', 'test'],
  ['V', 'verify'],
  ['M', 'merge'],
];

export function GodViewSidebar({ agents, velocity, onIssueHover, onIssueSelect }: SidebarProps) {
  return (
    <div
      className="gv-glass flex flex-col gap-3 p-3 overflow-hidden shrink-0"
      style={{ width: 220, borderColor: 'rgba(0, 212, 255, 0.1)' }}
    >
      {/* Activity Feed */}
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
        <ActivityFeed onIssueHover={onIssueHover} onIssueSelect={onIssueSelect} />
      </div>

      <div className="w-full h-px" style={{ backgroundColor: 'var(--gv-border)' }} />

      {/* Pipeline velocity — real stage transitions in the last hour (PAN-3491) */}
      <div className="shrink-0">
        <h3
          className="text-xs font-bold uppercase tracking-widest px-1 mb-1"
          style={{ color: 'var(--gv-text-secondary)' }}
        >
          Flow / hour
        </h3>
        <div className="flex items-baseline gap-2 px-1">
          <span className="text-lg font-bold" style={{ color: 'var(--gv-blue)' }}>
            {velocity ? velocity.transitionsPerHour.toFixed(1) : '—'}
          </span>
          <span className="text-xs" style={{ color: 'var(--gv-text-secondary)' }}>
            {STAGE_LETTERS.map(([letter, stage]) => `${letter}${velocity?.byStage[stage] ?? '—'}`).join(' ')}
          </span>
        </div>
      </div>

      <div className="w-full h-px" style={{ backgroundColor: 'var(--gv-border)' }} />

      {/* Agent distribution donut */}
      <div className="shrink-0">
        <h3
          className="text-xs font-bold uppercase tracking-widest px-1 mb-2"
          style={{ color: 'var(--gv-text-secondary)' }}
        >
          Agents
        </h3>
        <CostDonut agents={agents} width={100} height={100} />
      </div>

      <div className="w-full h-px" style={{ backgroundColor: 'var(--gv-border)' }} />

      {/* Infrastructure gauges */}
      <div className="shrink-0">
        <InfraGauges />
      </div>
    </div>
  );
}
