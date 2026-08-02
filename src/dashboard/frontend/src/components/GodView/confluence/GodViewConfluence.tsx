import { useEffect, useMemo, useRef, useState } from 'react';
import { HOOK_INVENTORY } from '@overdeck/contracts';
import { useDashboardStore, selectAgents } from '../../../lib/store';
import type { Agent } from '../../../types';
import { GodViewSidebar } from '../Sidebar';
import { RiverCanvas, type RiverEffectsApi } from './RiverCanvas';
import { useConfluenceData, type ConfluenceOrb } from './useConfluenceData';
import './confluence.css';

interface HoverState {
  orb: ConfluenceOrb;
  x: number;
  y: number;
}

export function GodViewConfluence() {
  const rootRef = useRef<HTMLDivElement>(null);
  const effectsRef = useRef<RiverEffectsApi>(null);
  const { orbs, hookStream, meta } = useConfluenceData();
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const selected = useMemo(() => orbs.find((orb) => orb.id === selectedId) ?? null, [orbs, selectedId]);
  const hookCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of hookStream.entries) counts.set(entry.hookName, (counts.get(entry.hookName) ?? 0) + 1);
    return counts;
  }, [hookStream.entries]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void rootRef.current?.requestFullscreen();
      } else if (event.key === 'h' || event.key === '?') {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (event.key === 'Escape') {
        setHelpOpen(false);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div ref={rootRef} className="confluence-root">
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
          <div className="confluence-hint"><b>h / ?</b> field guide · <b>hover</b> orb · <b>click</b> issue rail · <b>f</b> fullscreen</div>
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
        <div className="confluence-help" role="dialog" aria-modal="true" aria-label="Confluence field guide">
          <div>
            <header><strong>CONFLUENCE FIELD GUIDE</strong><button type="button" onClick={() => setHelpOpen(false)}>×</button></header>
            <p>The river moves issues from PLAN through MERGE. Heat and motion follow live hook traffic; frost means an agent has gone quiet.</p>
            <p>Amber shelf orbs are deliberately paused. Pink wrecks are failed merges. Review satellites show the four specialist verdicts and synthesis parent.</p>
          </div>
        </div>
      )}
      <div className="confluence-crt" aria-hidden="true" />
      <div className="confluence-vignette" aria-hidden="true" />
    </div>
  );
}
