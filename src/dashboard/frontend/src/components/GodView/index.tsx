/**
 * God View — Real-time Agent Activity Command Center (PAN-341)
 *
 * A full-screen dark dashboard with:
 * - Animated top bar with system health and clock
 * - Retired scan area with right sidebar activity feed, agent donut, infra gauges
 */

import { useCallback, useRef, useState } from 'react';
import './theme.css';

import { GodViewTopBar } from './TopBar';
import { GodViewConfluence } from './confluence/GodViewConfluence';
import { useGodViewSocket } from '../../hooks/useGodViewSocket';
import { useDashboardStore, selectAgents } from '../../lib/store';
import type { Agent } from '../../types';

export function GodViewPage() {
  useGodViewSocket();

  const rootRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void root.requestFullscreen?.();
  }, []);

  return (
    <div ref={rootRef} className="god-view flex flex-col h-full">
      <GodViewTopBar
        agents={agents}
        onHelpToggle={() => setHelpOpen((open) => !open)}
        onFullscreenToggle={toggleFullscreen}
      />

      <GodViewConfluence
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}
