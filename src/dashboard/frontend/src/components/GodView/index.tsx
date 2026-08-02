/**
 * God View — Real-time Agent Activity Command Center (PAN-341)
 *
 * A full-screen dark dashboard with:
 * - Animated top bar with system health and clock
 * - Retired scan area with right sidebar activity feed, agent donut, infra gauges
 */

import './theme.css';

import { GodViewTopBar } from './TopBar';
import { GodViewConfluence } from './confluence/GodViewConfluence';
import { useGodViewSocket } from '../../hooks/useGodViewSocket';
import { useDashboardStore, selectAgents } from '../../lib/store';
import type { Agent } from '../../types';

export function GodViewPage() {
  useGodViewSocket();

  const agents = useDashboardStore(selectAgents) as unknown as Agent[];

  return (
    <div className="god-view flex flex-col h-full">
      <GodViewTopBar agents={agents} />

      <GodViewConfluence />
    </div>
  );
}
