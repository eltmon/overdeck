/**
 * Status tab of the Flywheel rail (PAN-3964 FR-9, PAN-5283 WI-16). Renders
 * the derived status only, top to bottom: the health strip, the last tick the
 * loop printed and its freshness, the Needs-you action cards, the lane board
 * of in-flight and shipped-today cards, and the shipped-today timeline.
 */
import type { FlywheelDerivedStatus, FlywheelFreshness } from '@overdeck/contracts';
import { needsYouTick, shippedCardCount } from '@overdeck/contracts';

import { formatAge } from '../../lib/flywheelApi';
import { FlywheelHealthStrip } from './FlywheelHealthStrip';
import { FlywheelLaneBoard } from './FlywheelLaneBoard';
import { FlywheelNeedsYouCards } from './FlywheelNeedsYouCards';
import { FlywheelShippedToday } from './FlywheelShippedToday';
import { EmptyState, StatusBadge, type Tone } from './primitives';

const FRESHNESS_TONE: Record<FlywheelFreshness, Tone> = {
  // A tick in the last minute: the machine is working.
  live: 'info',
  // Between ticks (≤ 20 min) is normal breathing — nothing to do.
  breathing: 'neutral',
  // Past the loop's 20-minute sweep contract: something is wrong.
  stalled: 'destructive',
};

export function freshnessLabel(freshness: FlywheelFreshness, at: string, nowMs: number): string {
  if (freshness === 'live') return 'live';
  if (freshness === 'breathing') return `last tick ${formatAge(at, nowMs)}`;
  return `stalled — last tick ${formatAge(at, nowMs)}`;
}

export function FreshnessBadge({ freshness, at, nowMs }: { freshness: FlywheelFreshness; at: string; nowMs: number }) {
  return (
    <StatusBadge tone={FRESHNESS_TONE[freshness]} testId="flywheel-freshness">
      {freshnessLabel(freshness, at, nowMs)}
    </StatusBadge>
  );
}

/**
 * The board heading and the page header (D17): every in-flight card, then the
 * Deploy and Done-today cards. The owner chip on each card says which ones the
 * loop drives.
 */
export function inFlightCountLabel(status: Pick<FlywheelDerivedStatus, 'inFlight' | 'shipped'>): string {
  return `${status.inFlight.length} in flight · ${shippedCardCount(status)} shipped today`;
}

interface FlywheelStatusPaneProps {
  status: FlywheelDerivedStatus | undefined;
  unreachable: boolean;
  nowMs: number;
  onNavigateIssue?: (issueId: string) => void;
  onNeedsYouClick?: (messageId: string) => void;
}

export function FlywheelStatusPane({ status, unreachable, nowMs, onNavigateIssue, onNeedsYouClick }: FlywheelStatusPaneProps) {
  if (unreachable && !status) {
    return <EmptyState title="Can't reach the server — retrying" detail="The flywheel's state is unknown, not gone. This pane retries every few seconds." />;
  }
  if (!status) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading flywheel status…</div>;
  }

  const conv = status.conversation;
  const tick = status.lastTick;

  return (
    <div className="space-y-4" data-testid="flywheel-status-pane">
      {unreachable && (
        <p className="text-xs text-destructive" role="status">Can&apos;t reach the server — retrying. Showing the last status.</p>
      )}

      {status.health && <FlywheelHealthStrip health={status.health} nowMs={nowMs} />}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Run</dt>
        <dd className="text-foreground" data-testid="flywheel-run-state">{status.run}</dd>
        {conv && (
          <>
            <dt className="text-muted-foreground">Conversation</dt>
            <dd className="font-mono text-foreground">{conv.name} · {conv.harness ?? '—'} · {conv.model ?? '—'}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Project</dt>
        <dd className="truncate font-mono text-foreground" title={status.projectRoot}>{status.projectRoot}</dd>
        {status.orderBook && (
          <>
            <dt className="text-muted-foreground">Order book</dt>
            <dd className="text-foreground" data-testid="flywheel-status-order-book">
              {status.orderBook.name} <span className="font-mono text-muted-foreground">({status.orderBook.id})</span> · {status.orderBook.landed}/{status.orderBook.total} landed
            </dd>
          </>
        )}
      </dl>

      {status.run === 'idle' ? (
        <EmptyState
          title={<>No flywheel running — Start it from the conversation pane&apos;s toolbar, or run <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">pan flywheel start</code></>}
          detail="Nothing is stored between runs: this pane fills in from the loop's tick markers once it starts."
        />
      ) : status.run === 'paused' ? (
        <EmptyState
          title="Paused — Resume to continue"
          detail="The conversation and its transcript are kept. Resume respawns it and re-sends /pan-flywheel."
        />
      ) : !tick ? (
        <EmptyState title="Running — waiting for the first tick" detail="The loop prints a flywheel-tick line at the end of every tick." />
      ) : null}

      {tick && (
        <section aria-label="Last tick" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground" data-testid="flywheel-last-tick">
              tick {tick.tick} · {tick.phase} · {tick.pick ? <span className="font-mono">{tick.pick}</span> : 'no pick'}
            </span>
            <span className="text-xs text-muted-foreground" title={tick.at}>{formatAge(tick.at, nowMs)}</span>
            {status.freshness && status.run === 'running' && <FreshnessBadge freshness={status.freshness} at={tick.at} nowMs={nowMs} />}
          </div>
        </section>
      )}

      {!tick && status.previousRun && (
        <p className="text-xs text-muted-foreground" data-testid="flywheel-previous-run">
          Previous run ended at tick {status.previousRun.lastTick.tick}
          {status.previousRun.stoppedCleanly ? ' after a clean stop' : ' without a clean stop'} ({formatAge(status.previousRun.lastTick.at, nowMs)}).
          {' '}Its open needs-you items stay listed until this run&apos;s first tick.
        </p>
      )}

      <FlywheelNeedsYouCards
        tick={needsYouTick(status)}
        inFlight={status.inFlight}
        nowMs={nowMs}
        onNavigateIssue={onNavigateIssue}
        onNeedsYouClick={onNeedsYouClick}
      />

      <section aria-label="In-flight issues">
        <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground" data-testid="flywheel-board-count">
          {inFlightCountLabel(status)}
        </h3>
        {status.inFlight.length === 0 && !status.shipped?.merges.length && (
          <p className="mb-2 text-xs text-muted-foreground">No feature workspaces in this project.</p>
        )}
        <FlywheelLaneBoard status={status} nowMs={nowMs} onNavigateIssue={onNavigateIssue} />
      </section>

      {status.shipped && <FlywheelShippedToday events={status.shipped.events} />}
    </div>
  );
}
