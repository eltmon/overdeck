/**
 * Status tab of the Flywheel rail (PAN-3964 FR-9). Renders the derived status
 * only — the last tick the loop printed, its freshness, the needs-you line,
 * and one row per feature workspace in the flywheel's project.
 */
import type { FlywheelDerivedStatus, FlywheelFreshness } from '@overdeck/contracts';

import { formatAge } from '../../lib/flywheelApi';
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

const ATTENTION_TONE: Record<string, Tone> = { 'needs-you': 'warning', stuck: 'destructive', 'api-error': 'destructive' };

/**
 * What the board is counting. A running loop's own tick list is the authority
 * on what it picked up; with no tick, the rows are just the workspace census
 * and the heading says so rather than implying the loop chose them.
 */
export function inFlightCountLabel(status: FlywheelDerivedStatus): string {
  return status.inFlightSource === 'tick'
    ? `${status.inFlight.filter((row) => row.inTick).length} in flight (loop)`
    : `${status.inFlight.length} feature workspaces`;
}

interface FlywheelStatusPaneProps {
  status: FlywheelDerivedStatus | undefined;
  unreachable: boolean;
  nowMs: number;
  onNavigateIssue?: (issueId: string) => void;
}

export function FlywheelStatusPane({ status, unreachable, nowMs, onNavigateIssue }: FlywheelStatusPaneProps) {
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
          {tick.needsYou && (
            <div className="border-l-2 border-warning bg-warning/[0.08] px-3 py-2 text-sm text-foreground" role="note" data-testid="flywheel-needs-you">
              <span className="mr-2 text-[11px] font-medium uppercase tracking-wider text-warning-foreground">Needs you</span>
              {tick.needsYou}
            </div>
          )}
        </section>
      )}

      <section aria-label="In-flight issues">
        <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {inFlightCountLabel(status)}
        </h3>
        {status.inFlight.length === 0 ? (
          <p className="text-xs text-muted-foreground">No feature workspaces in this project.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2 font-medium">Issue</th>
                <th className="py-1 pr-2 font-medium">State</th>
                <th className="py-1 pr-2 font-medium">PR</th>
                <th className="py-1 font-medium">Last journal</th>
              </tr>
            </thead>
            <tbody>
              {status.inFlight.map((row) => (
                <tr
                  key={row.issueId}
                  className="border-t border-border/60 align-top"
                  data-testid={`flywheel-inflight-${row.issueId}`}
                  data-attention={row.attention}
                >
                  <td className="py-1.5 pr-2">
                    <button
                      type="button"
                      className="whitespace-nowrap font-mono text-foreground hover:underline"
                      onClick={() => onNavigateIssue?.(row.issueId)}
                    >
                      {row.issueId}
                    </button>
                    {row.title && (
                      <span
                        className="block max-w-[18rem] truncate text-muted-foreground"
                        title={row.title}
                        data-testid={`flywheel-title-${row.issueId}`}
                      >
                        {row.title}
                      </span>
                    )}
                    {row.trackerUnknown && (
                      <span className="mt-0.5 block">
                        <StatusBadge tone="neutral" testId={`flywheel-tracker-unknown-${row.issueId}`}>tracker unknown</StatusBadge>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="text-muted-foreground">{row.state}</span>
                    {row.attention && (
                      <span className="ml-1.5"><StatusBadge tone={ATTENTION_TONE[row.attention] ?? 'neutral'}>{row.attention}</StatusBadge></span>
                    )}
                    {/* `working` with no live pane is what a stalled issue looks like. */}
                    {row.state === 'working' && row.liveAgents === 0 && (
                      <span className="ml-1.5"><StatusBadge tone="neutral" testId={`flywheel-no-agent-${row.issueId}`}>no agent</StatusBadge></span>
                    )}
                    {row.inTick && (
                      <span className="ml-1.5"><StatusBadge tone="info" testId={`flywheel-in-tick-${row.issueId}`}>flywheel</StatusBadge></span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    {row.pr ? (
                      <a href={row.pr.url} target="_blank" rel="noreferrer" className="hover:underline">
                        <span className="font-mono">#{row.pr.number}</span> · {row.pr.reviewState} · {row.pr.checks}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 text-muted-foreground">
                    {row.lastJournal ? (
                      <span title={row.lastJournal.at}>
                        <span className="font-mono">{row.lastJournal.type}</span> · {formatAge(row.lastJournal.at, nowMs)}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
