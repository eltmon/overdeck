/**
 * God View — Real-time Agent Activity Command Center (PAN-341)
 *
 * A full-screen dark dashboard with:
 * - Animated top bar with system health and clock
 * - Retired scan area with right sidebar activity feed, agent donut, infra gauges
 */

import './theme.css';

import { GodViewTopBar } from './TopBar';
import { GodViewSidebar } from './Sidebar';
import { useGodViewSocket } from '../../hooks/useGodViewSocket';
import { useDashboardStore, selectAgents } from '../../lib/store';
import type { Agent } from '../../types';

export function GodViewPage() {
  useGodViewSocket();

  const agents = useDashboardStore(selectAgents) as unknown as Agent[];

  return (
    <div className="god-view flex flex-col h-full">
      <GodViewTopBar agents={agents} />

      <div className="flex flex-1 gap-3 px-3 pb-3 pt-2 min-h-0 overflow-hidden">
        <div className="flex flex-1 min-w-0 min-h-0 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-sm text-white/50">
          Agent scan moved to the Agents fleet view.
        </div>

        <GodViewSidebar agents={agents} />
      </div>
    </div>
  );
}
