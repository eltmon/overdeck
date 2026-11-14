/**
 * Needs-you action cards on the Flywheel Status tab (PAN-5283 FR-8, D14).
 *
 * Each card shows the question, why it was raised (the first-raised tick
 * message's prose), since when, a jump to that message, and — only when a
 * structured source supplies one — a real control: the test-removal waiver,
 * a two-step Start, or Open <ID>. The whole card jumps to the message when it
 * has one (PAN-5275): inner controls stop the click so they keep their own
 * action, and a click that ends a text selection does not jump.
 */
import { useState, type MouseEvent, type ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';

import type { FlywheelInFlightRow, FlywheelLastTick } from '@overdeck/contracts';

import { formatAge } from '../../lib/flywheelApi';
import { buildNeedsYouCards, type NeedsYouCard } from '../../lib/flywheelNeedsYou';
import { needsYouSegments } from '../../lib/flywheelNeedsYouLinks';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { TestRemovalWaiverControl } from '../CommandDeck/SessionView/TestRemovalWaiverControl';
import { clockTime } from './FlywheelHealthStrip';

/** Shared link style for needs-you issue, PR and item-target links (PAN-5239 D6). */
export const NEEDS_YOU_LINK_CLASS =
  'cursor-pointer rounded-sm text-foreground underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const CONTROL_CLASS =
  'cursor-pointer border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:border-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** A click that ends a drag-selection inside the card is a selection, not a jump (PAN-5275). */
function endsSelectionWithin(card: HTMLElement): boolean {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && !!selection.anchorNode && card.contains(selection.anchorNode);
}

const stop = (e: MouseEvent) => e.stopPropagation();

function StartIssueButton({ issueId }: { issueId: string }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'starting' | 'started' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setPhase('starting');
    setError(null);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ issueId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Start failed (${res.status})`);
      }
      setPhase('started');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  };
  if (phase === 'started') return <span className="text-[11px] text-muted-foreground">Start requested</span>;
  return (
    <>
      <button
        type="button"
        data-testid="flywheel-needs-you-start"
        className={CONTROL_CLASS}
        disabled={phase === 'starting'}
        onClick={(e) => {
          e.stopPropagation();
          if (phase === 'confirm') void start();
          else setPhase('confirm');
        }}
      >
        {phase === 'confirm' ? 'Confirm start' : phase === 'starting' ? 'Starting…' : `Start ${issueId}`}
      </button>
      {error && <span className="text-[11px] text-destructive" role="alert">{error}</span>}
    </>
  );
}

function CardAction({ card, onNavigateIssue }: { card: NeedsYouCard; onNavigateIssue?: (issueId: string) => void }) {
  if (!card.issueId || !card.action) return null;
  const issueId = card.issueId;
  switch (card.action) {
    case 'waive-test-removal':
      return (
        // The waiver control holds its own inputs; none of its clicks may jump.
        <div className="w-full" onClick={stop} data-testid="flywheel-needs-you-waiver">
          <TestRemovalWaiverControl issueId={issueId} />
        </div>
      );
    case 'start-issue':
      return <StartIssueButton issueId={issueId} />;
    case 'answer-agent':
      return (
        <button
          type="button"
          data-testid="flywheel-needs-you-open"
          className={CONTROL_CLASS}
          onClick={(e) => {
            e.stopPropagation();
            onNavigateIssue?.(issueId);
          }}
        >
          Open {issueId}
        </button>
      );
  }
}

function Question({ card, inFlight, onNavigateIssue }: {
  card: NeedsYouCard;
  inFlight: readonly FlywheelInFlightRow[];
  onNavigateIssue?: (issueId: string) => void;
}): ReactNode {
  if (card.target) {
    return (
      <a href={card.target} target="_blank" rel="noreferrer noopener" className={NEEDS_YOU_LINK_CLASS} data-testid="flywheel-needs-you-link" onClick={stop}>
        {card.label}
      </a>
    );
  }
  return needsYouSegments(card.label, inFlight).map((segment, i) => {
    if (segment.kind === 'issue') {
      return (
        <button
          key={i}
          type="button"
          className={`font-mono ${NEEDS_YOU_LINK_CLASS}`}
          data-testid="flywheel-needs-you-issue"
          onClick={(e) => {
            e.stopPropagation();
            onNavigateIssue?.(segment.issueId);
          }}
        >
          {segment.text}
        </button>
      );
    }
    if (segment.kind === 'pr') {
      return (
        <a key={i} href={segment.url} target="_blank" rel="noreferrer noopener" className={`font-mono ${NEEDS_YOU_LINK_CLASS}`} data-testid="flywheel-needs-you-pr" onClick={stop}>
          {segment.text}
        </a>
      );
    }
    return <span key={i}>{segment.text}</span>;
  });
}

export function FlywheelNeedsYouCards({ tick, inFlight, nowMs, onNavigateIssue, onNeedsYouClick }: {
  tick: FlywheelLastTick | null | undefined;
  inFlight: readonly FlywheelInFlightRow[];
  nowMs: number;
  onNavigateIssue?: (issueId: string) => void;
  onNeedsYouClick?: (messageId: string) => void;
}) {
  const cards = buildNeedsYouCards(tick, inFlight);
  if (cards.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Needs you"
      data-testid="flywheel-needs-you"
      className="border-l-2 border-warning bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-sm text-foreground"
    >
      <span className="text-[11px] font-medium uppercase tracking-wider text-warning-foreground">Needs you · {cards.length}</span>
      <ul className="mt-1 space-y-2">
        {cards.map((card) => {
          const jumpId = card.messageId;
          return (
            <li
              key={card.key}
              data-testid="flywheel-needs-you-item"
              data-issue={card.issueId}
              className={
                jumpId
                  ? 'group -mx-1 cursor-pointer rounded-sm px-1 py-0.5 hover:bg-[color-mix(in_srgb,var(--warning)_14%,transparent)]'
                  : '-mx-1 px-1 py-0.5'
              }
              onClick={
                jumpId
                  ? (e: MouseEvent<HTMLLIElement>) => {
                      if (endsSelectionWithin(e.currentTarget)) return;
                      onNeedsYouClick?.(jumpId);
                    }
                  : undefined
              }
            >
              <span className="block min-w-0 break-words font-medium">
                <Question card={card} inFlight={inFlight} onNavigateIssue={onNavigateIssue} />
              </span>
              {card.context && (
                <span className="mt-0.5 block break-words text-xs text-muted-foreground" data-testid="flywheel-needs-you-why">
                  {card.context}
                </span>
              )}
              <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                {card.firstRaisedTick !== undefined && card.firstRaisedAt && (
                  <span data-testid="flywheel-needs-you-since" title={card.firstRaisedAt}>
                    tick {card.firstRaisedTick} · {clockTime(card.firstRaisedAt)} · {formatAge(card.firstRaisedAt, nowMs)}
                  </span>
                )}
                {jumpId && (
                  <button
                    type="button"
                    aria-label="Show where this was raised"
                    title="Open the conversation at the message that first raised this, or the question the flywheel is waiting on"
                    data-testid="flywheel-needs-you-jump"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground group-hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNeedsYouClick?.(jumpId);
                    }}
                  >
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                    show message
                  </button>
                )}
                <CardAction card={card} onNavigateIssue={onNavigateIssue} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
