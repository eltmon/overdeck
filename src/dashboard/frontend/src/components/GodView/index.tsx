/**
 * God View — Real-time Agent Activity Command Center (PAN-341)
 *
 * A full-screen dark dashboard with:
 * - Animated top bar with system health and clock
 * - Confluence river with hook bus, telemetry, and agent sidebar
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleFullscreen();
      } else if (event.key === 'h' || event.key === '?') {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  return (
    <div ref={rootRef} className="god-view flex flex-col h-full">
      <GodViewTopBar
        data={data}
        onHelp={() => setHelpOpen(true)}
        onFullscreen={toggleFullscreen}
      />
      <GodViewConfluence
        data={data}
        helpOpen={helpOpen}
        onHelpChange={setHelpOpen}
      />
    </div>
  );
}
