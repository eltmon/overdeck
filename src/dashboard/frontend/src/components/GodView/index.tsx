/**
 * God View — Real-time Agent Activity Command Center (PAN-341)
 *
 * A full-screen dark dashboard with:
 * - Animated top bar with system health and clock
 * - Agent grid with glassmorphism cards, canvas terminal previews, connection lines
 * - Right sidebar with activity feed, agent donut, infra gauges
 * - Click-through focus view overlay with full agent details
 */

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import './theme.css';

import { GodViewTopBar } from './TopBar';
import { AgentGrid } from './AgentGrid';
import { GodViewSidebar } from './Sidebar';
import { AgentFocusView } from './FocusView';
import { useGodViewSocket } from '../../hooks/useGodViewSocket';
import { useDashboardStore, selectAgentList } from '../../lib/store';
import type { Agent } from '../../types';

export function GodViewPage() {
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);

  // Connect to God View socket events
  useGodViewSocket();

  // Agents from Zustand store (event-sourced — no polling)
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

  const focusedAgent = focusedAgentId ? agents.find((a) => a.id === focusedAgentId) : null;

  return (
    <div className="god-view flex flex-col h-full">
      {/* Top bar */}
      <GodViewTopBar agents={agents} />

      {/* Main content: grid + sidebar */}
      <div className="flex flex-1 gap-3 px-3 pb-3 pt-2 min-h-0 overflow-hidden">
        {/* Agent grid (75% width) */}
        <div className="flex flex-1 min-w-0 min-h-0">
          <AgentGrid
            agents={agents}
            onSelectAgent={(id) => setFocusedAgentId(id)}
          />
        </div>

        {/* Right sidebar (25% width, ~220px fixed) */}
        <GodViewSidebar agents={agents} />
      </div>

      {/* Focus overlay */}
      <AnimatePresence>
        {focusedAgent && (
          <AgentFocusView
            agent={focusedAgent}
            onClose={() => setFocusedAgentId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
