/**
 * God View — Real-time Agent Activity Command Center (PAN-341)
 *
 * A full-screen dark dashboard with:
 * - Animated top bar with system health and clock
 * - Confluence river with hook bus, telemetry, and agent sidebar
 */

import { useCallback, useRef, useState } from 'react';
import './theme.css';

import { GodViewTopBar } from './TopBar';
import { GodViewConfluence } from './confluence/GodViewConfluence';
import { useConfluenceData } from './confluence/useConfluenceData';
import { useGodViewSocket } from '../../hooks/useGodViewSocket';

export function GodViewPage() {
  useGodViewSocket();
  const data = useConfluenceData();
  const rootRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void root.requestFullscreen?.();
  }, []);

  return (
    <div ref={rootRef} className="god-view flex flex-col flex-1 min-h-0">
      <GodViewTopBar
        data={data}
        onHelpToggle={() => setHelpOpen((open) => !open)}
        onFullscreenToggle={toggleFullscreen}
      />
      <GodViewConfluence
        data={data}
        helpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}
