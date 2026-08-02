import { useEffect, useMemo, useRef, useState } from 'react';
import { HOOK_INVENTORY } from '@overdeck/contracts';
import { useDashboardStore, selectAgents } from '../../../lib/store';
import type { Agent } from '../../../types';
import { GodViewSidebar } from '../Sidebar';
import { ConfluenceHelp } from './ConfluenceHelp';
import { RiverCanvas, type RiverCanvasHandle } from './RiverCanvas';
import { useConfluenceChoreography } from './useConfluenceChoreography';
import { useConfluenceData, type ConfluenceOrb } from './useConfluenceData';
import './confluence.css';

interface HoverState {
  orb: ConfluenceOrb;
  x: number;
  y: number;
}

interface GodViewConfluenceProps {
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

export function GodViewConfluence({ helpOpen, onHelpOpenChange, onToggleFullscreen }: GodViewConfluenceProps) {
  const effectsRef = useRef<RiverCanvasHandle>(null);
  const { orbs, hookStream, meta } = useConfluenceData();
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => orbs.find((orb) => orb.id === selectedId) ?? null, [orbs, selectedId]);
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
      } else if (event.key === 'Escape' && (helpOpen || selectedId !== null)) {
        event.preventDefault();
        onHelpOpenChange(false);
        setSelectedId(null);
      } else if (event.key === 'f') {
        event.preventDefault();
        onToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, onHelpOpenChange, onToggleFullscreen, selectedId]);

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
            selectedId={selectedId}
            conversations={meta.conversations}
            mergeQueue={meta.mergeQ}
            onHover={(orb, point) => setHover(orb && point ? { orb, ...point } : null)}
            onSelect={(orb) => setSelectedId(orb?.id ?? null)}
          />

          {hover && (
            <div className="confluence-tooltip" style={{ left: hover.x + 16, top: hover.y + 16 }} role="tooltip">
              <strong>{hover.orb.id}</strong>
              <span>{hover.orb.title}</span>
              <div><b>{hover.orb.stage}</b><b>{hover.orb.role}</b><b>{hover.orb.model ?? 'model —'}</b></div>
              <small>Click to open the issue rail</small>
            </div>
          )}

          <aside className={`confluence-issue-rail ${selected ? 'open' : ''}`} aria-hidden={!selected}>
            {selected && (
              <>
                <header><strong>{selected.id}</strong><button type="button" onClick={() => setSelectedId(null)} aria-label="Close issue rail">×</button></header>
                <p>{selected.title}</p>
                <div className="confluence-rail-chips"><span>{selected.stage}</span><span>{selected.role}</span><span>{selected.state}</span></div>
                <dl><div><dt>Model</dt><dd>{selected.model ?? '—'}</dd></div><div><dt>Spend</dt><dd>${selected.spend.toFixed(2)}</dd></div></dl>
              </>
            )}
          </aside>

          <div className="confluence-tag">PIPELINE FLOW · <b>PLAN → WORK → REVIEW → TEST → VERIFY → MERGE</b> · frost = stale · shelf = yielded</div>
          <div className="confluence-hint"><b>h / ?</b> field guide · <b>hover</b> orb detail · <b>click</b> issue rail · <b>f</b> fullscreen</div>
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

      {helpOpen && <ConfluenceHelp eventsPerMin={hookStream.eventsPerMin} onClose={() => onHelpOpenChange(false)} />}
      <div className="confluence-crt" aria-hidden="true" />
      <div className="confluence-vignette" aria-hidden="true" />
    </div>
  );
}
