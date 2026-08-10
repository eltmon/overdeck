import { useEffect, useRef, useState } from 'react';
import { useDashboardStore, selectAgents } from '../../../lib/store';
import type { Agent } from '../../../types';
import { GodViewSidebar } from '../Sidebar';
import { BottomStrip } from './BottomStrip';
import { ConfluenceHelp } from './ConfluenceHelp';
import { HookBus } from './HookBus';
import { IssueRail } from './IssueRail';
import { OrbTooltip } from './OrbTooltip';
import { RiverCanvas, type RiverCanvasHandle } from './RiverCanvas';
import { useConfluenceChoreography, useSweepChoreography } from './useConfluenceChoreography';
import type { ConfluenceData, ConfluenceOrb } from './useConfluenceData';
import './confluence.css';

interface HoverState {
  orb: ConfluenceOrb;
  x: number;
  y: number;
  canvasWidth: number;
}

export function selectedConfluenceIssueId(pathname = window.location.pathname): string | null {
  const match = pathname.match(/^\/issues\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function navigateToConfluenceIssue(issueId: string): void {
  const path = `/issues/${encodeURIComponent(issueId)}`;
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

interface GodViewConfluenceProps {
  data: ConfluenceData;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
  onToggleFullscreen: () => void;
}

function hasModalOrTextFocus(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable || active.matches('input, textarea, select')) return true;
  return active.closest('[role="dialog"], [aria-modal="true"]') !== null;
}

export function GodViewConfluence({
  data,
  helpOpen,
  onHelpOpenChange,
  onToggleFullscreen,
}: GodViewConfluenceProps) {
  const effectsRef = useRef<RiverCanvasHandle>(null);
  const { orbs, hookStream, meta } = data;
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selectedId, setSelectedId] = useState(() => selectedConfluenceIssueId());
  // Operator-reopened D-3: orb/feed clicks open the in-canvas issue rail (the
  // mockup UX); the real issue page is the rail's explicit action button.
  const [railId, setRailId] = useState<string | null>(null);
  const railOrb = railId ? orbs.find((orb) => orb.id === railId) ?? null : null;
  useConfluenceChoreography(orbs, hookStream.entries, effectsRef);
  useSweepChoreography(effectsRef);

  useEffect(() => {
    window.__orbs = orbs;
    return () => {
      if (window.__orbs === orbs) delete window.__orbs;
    };
  }, [orbs]);

  useEffect(() => {
    const onPopState = () => setSelectedId(selectedConfluenceIssueId());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || hasModalOrTextFocus()) return;
      if (event.key === 'h' || event.key === '?') {
        event.preventDefault();
        onHelpOpenChange(!helpOpen);
      } else if (event.key === 'Escape' && helpOpen) {
        event.preventDefault();
        onHelpOpenChange(false);
      } else if (event.key === 'Escape' && railId) {
        event.preventDefault();
        setRailId(null);
      } else if (event.key === 'f') {
        event.preventDefault();
        onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, onHelpOpenChange, onToggleFullscreen, railId]);

  useEffect(() => {
    let resizeTimer: number | undefined;
    const onFullscreenChange = () => {
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => effectsRef.current?.resize(), 120);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
    };
  }, []);

  return (
    <div className="confluence-root">
      <div className="confluence-main">
        <HookBus entries={hookStream.entries} />

        <section className={`confluence-stage ${hover ? 'orb-hover' : ''}`}>
          <RiverCanvas
            ref={effectsRef}
            orbs={orbs}
            hookStream={hookStream}
            selectedId={railId ?? selectedId}
            conversations={meta.conversations}
            mergeQueue={meta.mergeQ}
            parkedTotal={meta.parkedTotal}
            onHover={(orb, point) => setHover(orb && point ? { orb, ...point } : null)}
            onSelect={(orb) => setRailId(orb ? orb.id : null)}
          />

          {railOrb && (
            <IssueRail
              orb={railOrb}
              agents={agents.filter((agent) => agent.issueId === railOrb.id)}
              entries={hookStream.entries.filter((entry) => entry.issueId === railOrb.id)}
              onClose={() => setRailId(null)}
              onOpenIssue={navigateToConfluenceIssue}
            />
          )}

          {hover && (
            <OrbTooltip
              orb={hover.orb}
              anchor={hover}
              hookRate={hookStream.entries.filter((entry) => entry.issueId === hover.orb.id).length}
              eventsFired={hookStream.entries.filter((entry) => entry.issueId === hover.orb.id).length}
            />
          )}

          <div className="confluence-tag">PIPELINE FLOW · <b>PLAN → WORK → REVIEW → TEST → VERIFY → MERGE</b> · frost = stale · shelf = yielded</div>
          <div className="confluence-hint"><b>h / ?</b> field guide · <b>hover</b> orb · <b>click</b> issue drawer · <b>f</b> fullscreen</div>
        </section>

        <GodViewSidebar
          agents={agents}
          velocity={meta.velocity}
          onIssueHover={(issueId) => effectsRef.current?.emitRing(issueId, '#ffffff')}
          onIssueSelect={(issueId) => setRailId(issueId)}
        />
      </div>

      <BottomStrip entries={hookStream.entries} roleCounts={meta.roleCounts} />

      {helpOpen && (
        <ConfluenceHelp
          eventsPerMin={hookStream.eventsPerMin}
          onClose={() => onHelpOpenChange(false)}
        />
      )}
      <div className="confluence-crt" aria-hidden="true" />
      <div className="confluence-vignette" aria-hidden="true" />
    </div>
  );
}
