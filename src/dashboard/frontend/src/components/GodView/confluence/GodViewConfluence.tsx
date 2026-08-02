import { useEffect, useMemo, useRef, useState } from 'react';
import { HOOK_INVENTORY } from '@overdeck/contracts';
import { useDashboardStore, selectAgents } from '../../../lib/store';
import type { Agent } from '../../../types';
import { GodViewSidebar } from '../Sidebar';
import { ConfluenceHelp } from './ConfluenceHelp';
import { OrbTooltip } from './OrbTooltip';
import { RiverCanvas, type RiverCanvasHandle } from './RiverCanvas';
import { useConfluenceChoreography } from './useConfluenceChoreography';
import type { ConfluenceData, ConfluenceOrb } from './useConfluenceData';
import './confluence.css';

interface HoverState {
  orb: ConfluenceOrb;
  x: number;
  y: number;
  canvasWidth: number;
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
  useConfluenceChoreography(orbs, hookStream.entries, effectsRef);

  const hookCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of hookStream.entries) counts.set(entry.hookName, (counts.get(entry.hookName) ?? 0) + 1);
    return counts;
  }, [hookStream.entries]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || hasModalOrTextFocus()) return;
      if (event.key === 'h' || event.key === '?') {
        event.preventDefault();
        onHelpOpenChange(!helpOpen);
      } else if (event.key === 'Escape' && helpOpen) {
        event.preventDefault();
        onHelpOpenChange(false);
      } else if (event.key === 'f') {
        event.preventDefault();
        onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, onHelpOpenChange, onToggleFullscreen]);

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
        <aside className="confluence-hookbus gv-glass" aria-label="Hook bus">
          <h3>HOOK BUS <em>· harness</em></h3>
          <div className="confluence-hook-scroll">
            {HOOK_INVENTORY.map((hook) => {
              const count = hookCounts.get(hook.name) ?? 0;
              return (
                <div key={hook.name} className={`confluence-hook ${hook.wired ? 'wired' : 'unwired'} ${count ? 'hot' : ''}`}>
                  <span className="led" />
                  <span className="name">{hook.name}</span>
                  <span className="count">{hook.wired ? count : '—'}</span>
                </div>
              );
            })}
          </div>
          <p>LEDs fire on live hook events. <b>Dotted</b> hooks are dark fiber awaiting a producer.</p>
        </aside>

        <section className={`confluence-stage ${hover ? 'orb-hover' : ''}`}>
          <RiverCanvas
            ref={effectsRef}
            orbs={orbs}
            hookStream={hookStream}
            conversations={meta.conversations}
            mergeQueue={meta.mergeQ}
            onHover={(orb, point) => setHover(orb && point ? { orb, ...point } : null)}
            onSelect={(orb) => {
              if (orb) navigateToConfluenceIssue(orb.id);
            }}
          />

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

        <GodViewSidebar agents={agents} />
      </div>

      <footer className="confluence-bottom">
        <div className="confluence-trace gv-glass">
          <span>HOOK TELEMETRY · <b>{hookStream.eventsPerMin} events / last 60 s</b></span>
        </div>
        <div className="confluence-roles gv-glass">
          {Object.entries(meta.roleCounts).map(([role, count]) => <span key={role}><i data-role={role} />{role}<b>{count}</b></span>)}
        </div>
      </footer>

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
