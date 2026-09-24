/**
 * The Flywheel page at /flywheel (PAN-3964 FR-8), restored as a derived view.
 *
 * Nothing on this page reads a stored run record: the header and the Status
 * tab come from `GET /api/flywheel/status` (the same deriver `pan flywheel
 * status` prints), State and Stats from the loop's `.pan/flywheel/` files and
 * the tracker, and the right column is the `conv-flywheel` conversation
 * itself. A failed status fetch reads as "can't reach the server", never idle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';

import { FlywheelConversationPane } from '../components/flywheel/FlywheelConversationPane';
import { FlywheelOrderBookCard } from '../components/flywheel/FlywheelOrderBookCard';
import { FlywheelStatePane } from '../components/flywheel/FlywheelStatePane';
import { FlywheelStatsPanel } from '../components/flywheel/FlywheelStatsPanel';
import { FlywheelStatusPane, FreshnessBadge } from '../components/flywheel/FlywheelStatusPane';
import { PendingAutoMergesCard } from '../components/flywheel/PendingAutoMergesCard';
import { RailCard, StatusBadge, ToggleSwitch } from '../components/flywheel/primitives';
import { useFlywheelStatus, useMergeTrainConfig, useMergeTrainConfigMutation } from '../lib/flywheelApi';

type RailTab = 'status' | 'state' | 'stats';

export const FLYWHEEL_SPLIT_STORAGE_KEY = 'overdeck.ui.flywheelSplitWidth';
const SPLIT_MIN_LEFT = 360;
const SPLIT_MIN_RIGHT = 360;
const SPLIT_DEFAULT_LEFT = 560;

const AUTO_PICKUP_TITLE = 'Off: the loop picks up only backlog items the operator released. On: every ready, planned backlog item is pickable.';
const REQUIRE_UAT_TITLE = 'On: a PR may not merge until UAT has passed. Off: eligible merges may be scheduled through the auto-merge cooldown.';

function readStoredSplit(): number {
  try {
    const parsed = Number(window.localStorage.getItem(FLYWHEEL_SPLIT_STORAGE_KEY));
    return Number.isFinite(parsed) && parsed >= SPLIT_MIN_LEFT ? parsed : SPLIT_DEFAULT_LEFT;
  } catch {
    return SPLIT_DEFAULT_LEFT;
  }
}

interface FlywheelPageProps {
  onOpenSettings?: () => void;
  onNavigateIssue?: (issueId: string) => void;
}

export function FlywheelPage({ onOpenSettings, onNavigateIssue }: FlywheelPageProps) {
  const statusQuery = useFlywheelStatus();
  const status = statusQuery.data;
  const unreachable = statusQuery.isError;
  const configQuery = useMergeTrainConfig();
  const configMutation = useMergeTrainConfigMutation();
  const config = configQuery.data;

  const [tab, setTab] = useState<RailTab>('status');
  const [leftWidth, setLeftWidth] = useState<number>(readStoredSplit);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const leftWidthRef = useRef(leftWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(interval);
  }, []);

  const setLeftWidthClamped = useCallback((next: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width || window.innerWidth;
    const maxLeft = Math.max(SPLIT_MIN_LEFT, containerWidth - SPLIT_MIN_RIGHT);
    const clamped = Math.round(Math.min(maxLeft, Math.max(SPLIT_MIN_LEFT, next)));
    leftWidthRef.current = clamped;
    setLeftWidth(clamped);
    try {
      window.localStorage.setItem(FLYWHEEL_SPLIT_STORAGE_KEY, String(clamped));
    } catch {
      // Storage is a convenience; the split still works for this view.
    }
  }, []);

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidthRef.current;
    const onMove = (move: PointerEvent) => setLeftWidthClamped(startWidth + (move.clientX - startX));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [setLeftWidthClamped]);

  const runChip = unreachable && !status
    ? <StatusBadge tone="destructive" testId="flywheel-run-chip">unreachable</StatusBadge>
    : status?.run === 'running'
      ? <StatusBadge tone="info" testId="flywheel-run-chip">running{status.lastTick ? ` · tick ${status.lastTick.tick}` : ''}</StatusBadge>
      : status?.run === 'paused'
        ? <StatusBadge tone="warning" testId="flywheel-run-chip">paused</StatusBadge>
        : status
          ? <StatusBadge tone="neutral" testId="flywheel-run-chip">idle</StatusBadge>
          : null;

  return (
    <div ref={containerRef} aria-label="Flywheel page" className="flex h-full w-full flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-2.5">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-sm font-medium text-foreground">Flywheel</h1>
          <p className="text-[11px] text-muted-foreground">The /pan-flywheel loop, derived live from its conversation</p>
        </div>
        {runChip}
        {status?.run === 'running' && status.freshness && status.lastTick && (
          <FreshnessBadge freshness={status.freshness} at={status.lastTick.at} nowMs={nowMs} />
        )}
        {status && (
          <span className="text-[11px] text-muted-foreground" data-testid="flywheel-inflight-count">
            <span className="font-mono text-foreground">{status.inFlight.length}</span> in flight
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <ToggleSwitch
            label="Auto-pickup"
            checked={config?.auto_pickup_backlog ?? false}
            disabled={!config || configMutation.isPending}
            title={AUTO_PICKUP_TITLE}
            onChange={(next) => configMutation.mutate({ auto_pickup_backlog: next })}
          />
          <ToggleSwitch
            label="Require UAT"
            checked={config?.require_uat_before_merge ?? true}
            disabled={!config || configMutation.isPending}
            title={REQUIRE_UAT_TITLE}
            onChange={(next) => configMutation.mutate({ require_uat_before_merge: next })}
          />
          <a
            href="/awaiting-merge"
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
            title="The merge train is configured on the Awaiting Merge page"
            data-testid="flywheel-merge-train-chip"
          >
            Merge train: {config ? (config.merge_train_enabled ? 'on' : 'off') : '—'}
          </a>
        </div>
      </header>
      {configMutation.error && (
        <div className="border-b border-border px-5 py-1.5 text-xs text-destructive" role="alert">{configMutation.error.message}</div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          className="flex shrink-0 flex-col overflow-y-auto border-r border-border"
          style={{ width: `${leftWidth}px`, minWidth: `${SPLIT_MIN_LEFT}px` }}
          aria-label="Flywheel control rail"
        >
          <PendingAutoMergesCard onNavigateIssue={onNavigateIssue} />
          <FlywheelOrderBookCard bookId={status?.orderBook?.id ?? null} />
          <RailCard
            label="Flywheel"
            ariaLabel="Flywheel run status"
            actions={(
              <div className="flex rounded-md border border-border p-0.5 text-[11px]" role="tablist" aria-label="Flywheel rail tabs">
                {(['status', 'state', 'stats'] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`rounded-sm px-2.5 py-1 capitalize ${tab === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
          >
            <div role="tabpanel" aria-label={`Flywheel ${tab}`}>
              {tab === 'status' && (
                <FlywheelStatusPane status={status} unreachable={unreachable} nowMs={nowMs} onNavigateIssue={onNavigateIssue} />
              )}
              {tab === 'state' && <FlywheelStatePane />}
              {tab === 'stats' && <FlywheelStatsPanel />}
            </div>
          </RailCard>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize flywheel panes"
          className="w-1.5 shrink-0 cursor-col-resize bg-border/40 hover:bg-primary/40"
          onPointerDown={handleResizePointerDown}
        />

        <div className="min-w-0 flex-1 overflow-hidden" aria-label="Flywheel conversation column">
          <FlywheelConversationPane onOpenSettings={onOpenSettings} />
        </div>
      </div>
    </div>
  );
}
