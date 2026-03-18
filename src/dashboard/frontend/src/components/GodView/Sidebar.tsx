import { ActivityFeed } from './ActivityFeed';
import { CostDonut } from './CostDonut';
import { InfraGauges } from './InfraGauges';
import type { Agent } from '../../types';

interface SidebarProps {
  agents: Agent[];
}

export function GodViewSidebar({ agents }: SidebarProps) {
  return (
    <div
      className="gv-glass flex flex-col gap-3 p-3 overflow-hidden shrink-0"
      style={{ width: 220, borderColor: 'rgba(0, 212, 255, 0.1)' }}
    >
      {/* Activity Feed */}
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
        <ActivityFeed />
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
