/**
 * PAN-2908 · C-CONVO — the peek (level 1 · glance).
 *
 * Hover any row/card (350ms intent delay) and a quick-look pops up: phase
 * dots, state, the last thing the agent said, review/gate status, and action
 * hints — without navigating or losing your place. Hovering the peek pins it;
 * Esc or leaving closes. Same data as every other surface (the store), no
 * new fetches.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDashboardStore, selectMemoryObservations, selectReviewStatus } from '../../lib/store';
import type { Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { derivePipelineState } from '../../lib/issuePipelineState';
import { phaseRailState } from '../../lib/simple/phases';
import { userFacingDisplay } from '../../lib/simple/userFacingState';
import { PhaseDots } from '../issue-detail/PhaseDots';
import { cn } from '../../lib/utils';

const INTENT_DELAY_MS = 350;

function lastSaid(observations: { narrative?: string; summary?: string; timestamp: string }[]): string | null {
  const latest = [...observations].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  const text = latest?.narrative || latest?.summary;
  return text ? text.slice(0, 140) : null;
}

function PeekCard({ issueId, x, y, onPin, pinned, onDock }: {
  issueId: string;
  x: number;
  y: number;
  onPin: (pinned: boolean) => void;
  pinned: boolean;
  onDock?: (issueId: string) => void;
}) {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const reviewStatus = useDashboardStore(selectReviewStatus(issueId));
  const observations = useDashboardStore(selectMemoryObservations(issueId));

  const model = useMemo(() => {
    const issue = ((issuesRaw as Issue[]) ?? []).find((i) => i.identifier.toLowerCase() === issueId.toLowerCase());
    if (!issue) return null;
    const agents = (Object.values(agentsById ?? {}) as AgentSnapshot[]).filter(
      (a) => a.issueId?.toLowerCase() === issue.identifier.toLowerCase(),
    );
    const primary = agents.find((a) => a.status === 'running' || a.status === 'starting') ?? agents[0];
    const pipelineState = derivePipelineState({
      reviewStatus: reviewStatus ?? null,
      agent: primary ?? null,
      hasPlan: issue.hasPlan === true,
      hasTasks: issue.hasTasks === true,
      issueCanonicalState: issue.state ?? issue.status ?? null,
      isMerged: reviewStatus?.mergeStatus === 'merged',
    });
    const rail = phaseRailState(pipelineState);
    const display = userFacingDisplay({ pipelineState, pendingInput: agents.some((a) => !!a.pendingAskUserQuestion || (a.pendingInputCount ?? 0) > 0), stuck: agents.some((a) => a.troubled) });
    return { issue, primary, rail, display };
  }, [issuesRaw, agentsById, issueId, reviewStatus]);

  if (!model) return null;
  const said = lastSaid(observations ?? []);
  const review = reviewStatus?.reviewStatus;
  const reviewLine = reviewStatus?.readyForMerge
    ? 'checks passed — ready to merge'
    : review === 'reviewing'
      ? 'being reviewed now'
      : review === 'passed'
        ? 'review passed'
        : review === 'failed' || review === 'blocked'
          ? 'review found problems'
          : null;

  return (
    <div
      data-component="issue-peek"
      className="fixed z-[90] w-[380px] overflow-hidden rounded-2xl border border-input bg-popover shadow-2xl"
      style={{ left: Math.min(x, window.innerWidth - 400), top: Math.min(y, window.innerHeight - 280) }}
      onMouseEnter={() => onPin(true)}
      onMouseLeave={() => onPin(false)}
    >
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">{issueId}</span>
        <span className="truncate text-xs font-medium">{model.issue.title}</span>
        <span className="ml-auto flex-none text-[10px] text-muted-foreground">{pinned ? 'pinned' : 'peek'}</span>
      </div>
      <div className="space-y-2 px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <PhaseDots rail={model.rail} />
          <span className="text-[12px] font-medium">{model.display.title}</span>
        </div>
        <div className="text-[12px] leading-snug text-muted-foreground">{model.display.sentence}</div>
        {said && (
          <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-[11.5px] leading-snug">
            <span className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-muted-foreground">last said</span>
            {said}
          </div>
        )}
        {reviewLine && <div className="text-[11px] text-muted-foreground">{reviewLine}</div>}
      </div>
      <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3.5 py-2 text-[10.5px] text-muted-foreground">
        <span><b className="font-medium text-foreground">click</b> open</span>
        {onDock && (
          <button
            type="button"
            className="text-info-foreground hover:underline"
            onClick={() => onDock(issueId)}
            data-peek-dock={issueId}
          >
            pop into dock
          </button>
        )}
        <span className="ml-auto">esc closes</span>
      </div>
    </div>
  );
}

export function IssuePeek({ issueId, children, onDock, className }: {
  issueId: string;
  children: ReactNode;
  onDock?: (issueId: string) => void;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setVisible(false); setPinned(false); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const show = visible || pinned;
  return (
    <div
      className={cn('contents', className)}
      onMouseEnter={(event) => {
        const { clientX, clientY } = event;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setPos({ x: clientX + 14, y: clientY + 12 });
          setVisible(true);
        }, INTENT_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        // brief grace so the pointer can travel into the peek to pin it
        setTimeout(() => { if (!pinned) setVisible(false); }, 140);
      }}
    >
      {children}
      {show && (
        <PeekCard
          issueId={issueId}
          x={pos.x}
          y={pos.y}
          pinned={pinned}
          onPin={(value) => { setPinned(value); if (!value) setVisible(false); }}
          onDock={onDock}
        />
      )}
    </div>
  );
}
