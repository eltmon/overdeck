import { useMemo, useRef, useState } from 'react';
import { HOOK_INVENTORY } from '@overdeck/contracts';
import { useDashboardStore, selectAgents } from '../../../lib/store';
import type { Agent } from '../../../types';
import { GodViewSidebar } from '../Sidebar';
import { OrbTooltip } from './OrbTooltip';
import { RiverCanvas, type RiverEffectsApi } from './RiverCanvas';
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
  onHelpChange: (open: boolean) => void;
}

export function GodViewConfluence({ data, helpOpen, onHelpChange }: GodViewConfluenceProps) {
  const effectsRef = useRef<RiverEffectsApi>(null);
  const { orbs, hookStream, meta } = data;
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const [hover, setHover] = useState<HoverState | null>(null);
  useConfluenceChoreography(orbs, hookStream.entries, effectsRef);

  const hookCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of hookStream.entries) counts.set(entry.hookName, (counts.get(entry.hookName) ?? 0) + 1);
    return counts;
  }, [hookStream.entries]);

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
            <header><strong>CONFLUENCE FIELD GUIDE</strong><button type="button" onClick={() => onHelpChange(false)}>×</button></header>
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
