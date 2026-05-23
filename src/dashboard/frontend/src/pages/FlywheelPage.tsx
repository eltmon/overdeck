import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlywheelStatus } from '@panctl/contracts';
import { FlywheelConversationPane } from '../components/flywheel/FlywheelConversationPane';
import { FlywheelStatePane } from '../components/flywheel/FlywheelStatePane';
import { FlywheelStatusDetails } from '../components/flywheel/FlywheelStatusDetails';
import { subscribeFlywheelStatus } from '../lib/wsTransport';

interface FlywheelPageProps {
  onOpenSettings?: () => void;
  onNavigateAgent?: (agentId: string) => void;
  onNavigateIssue?: (issueId: string) => void;
}

type FlywheelLeftTab = 'status' | 'state';

const SPLIT_STORAGE_KEY = 'panopticon.ui.flywheelSplitWidth';
const SPLIT_MIN_LEFT = 360;
const SPLIT_MIN_RIGHT = 360;
const SPLIT_DEFAULT_LEFT = 720;

function getStoredSplitWidth(): number {
  const stored = localStorage.getItem(SPLIT_STORAGE_KEY);
  if (!stored) return SPLIT_DEFAULT_LEFT;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed >= SPLIT_MIN_LEFT ? parsed : SPLIT_DEFAULT_LEFT;
}

async function fetchCurrentFlywheelStatus(): Promise<FlywheelStatus | null> {
  const res = await fetch('/api/flywheel/current');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<FlywheelStatus | null>;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatFreshnessAge(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds <= 90) return `${totalSeconds}s`;
  return `${Math.max(1, Math.floor(totalSeconds / 60))}m`;
}

function getLastTickFreshness(lastTickAt: string, nowMs: number): { label: string; className: string } {
  const lastTickMs = new Date(lastTickAt).getTime();
  const ageMs = Number.isFinite(lastTickMs) ? Math.max(0, nowMs - lastTickMs) : Number.POSITIVE_INFINITY;
  if (ageMs <= 30_000) {
    return { label: 'live', className: 'border-success/30 bg-success/15 text-success' };
  }
  if (ageMs <= 90_000) {
    return { label: `last tick ${formatFreshnessAge(ageMs)} ago`, className: 'border-warning/30 bg-warning/15 text-warning' };
  }
  return { label: `stalled — last tick ${formatFreshnessAge(ageMs)} ago`, className: 'border-destructive/30 bg-destructive/15 text-destructive' };
}

export function FlywheelPage({ onOpenSettings, onNavigateAgent, onNavigateIssue }: FlywheelPageProps) {
  const [status, setStatus] = useState<FlywheelStatus | null>(null);
  const [activeTab, setActiveTab] = useState<FlywheelLeftTab>('status');
  const [leftWidth, setLeftWidth] = useState<number>(getStoredSplitWidth);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const leftWidthRef = useRef(leftWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const setLeftWidthClamped = useCallback((next: number) => {
    const container = containerRef.current;
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth;
    const maxLeft = Math.max(SPLIT_MIN_LEFT, containerWidth - SPLIT_MIN_RIGHT);
    const clamped = Math.round(Math.min(maxLeft, Math.max(SPLIT_MIN_LEFT, next)));
    leftWidthRef.current = clamped;
    setLeftWidth(clamped);
    localStorage.setItem(SPLIT_STORAGE_KEY, String(clamped));
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = leftWidthRef.current;
      const onMove = (me: PointerEvent) => {
        setLeftWidthClamped(startWidth + (me.clientX - startX));
      };
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
    },
    [setLeftWidthClamped],
  );

  useEffect(() => {
    const onResize = () => setLeftWidthClamped(leftWidthRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setLeftWidthClamped]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshCurrentStatus = async () => {
      try {
        const current = await fetchCurrentFlywheelStatus();
        if (!cancelled) setStatus(current);
      } catch {
        // The RPC subscription remains authoritative while the dashboard restarts.
      }
    };
    void refreshCurrentStatus();
    const interval = window.setInterval(() => {
      void refreshCurrentStatus();
    }, 5000);
    const unsubscribe = subscribeFlywheelStatus((next) => {
      setStatus(next);
    });
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const freshness = status ? getLastTickFreshness(status.lastTickAt, nowMs) : null;

  return (
    <div
      ref={containerRef}
      aria-label="Flywheel page"
      className="flex h-full w-full overflow-hidden bg-background"
    >
      <section
        className="relative shrink-0 overflow-y-auto border-r border-border"
        style={{ width: `${leftWidth}px`, minWidth: `${SPLIT_MIN_LEFT}px` }}
        aria-label="Flywheel status pane"
      >
        <header className="sticky top-0 z-10 border-b border-border bg-card/60 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Fix-All Flywheel</h1>
              <p className="mt-1 text-sm text-muted-foreground">Autonomous pipeline sweep across active Panopticon work.</p>
              <a
                href="https://github.com/eltmon/panopticon-cli/blob/main/docs/FLYWHEEL.md"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
              >
                Flywheel docs
              </a>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={status ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-muted-foreground'} />
                {status ? 'Live run' : 'Idle'}
              </div>
              <div className="mt-1 font-mono text-sm text-foreground">{status?.runId ?? 'No run'}</div>
            </div>
          </div>
          {status && activeTab === 'status' && (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Elapsed</dt>
                <dd className="mt-1 font-medium text-foreground">{formatElapsed(status.elapsedMs)}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Ticks</dt>
                <dd className="mt-1 font-medium text-foreground">{status.ticks}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Last tick</dt>
                <dd className="mt-1">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${freshness?.className ?? ''}`}>
                    {freshness?.label ?? '—'}
                  </span>
                </dd>
              </div>
            </dl>
          )}
          <div className="mt-4" role="tablist" aria-label="Flywheel left-pane tabs">
            <div className="inline-flex rounded-lg border border-border bg-background p-1 text-xs font-medium">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'status'}
                onClick={() => setActiveTab('status')}
                className={
                  activeTab === 'status'
                    ? 'rounded-md bg-primary px-3 py-1.5 text-primary-foreground'
                    : 'rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground'
                }
              >
                Status
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'state'}
                onClick={() => setActiveTab('state')}
                className={
                  activeTab === 'state'
                    ? 'rounded-md bg-primary px-3 py-1.5 text-primary-foreground'
                    : 'rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground'
                }
              >
                State
              </button>
            </div>
          </div>
        </header>

        <div className="p-6" role="tabpanel" aria-label={activeTab === 'status' ? 'Flywheel status' : 'Flywheel state'}>
          {activeTab === 'status' ? (
            status ? (
              <FlywheelStatusDetails status={status} onNavigateAgent={onNavigateAgent} onNavigateIssue={onNavigateIssue} />
            ) : (
              <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
                <div>
                  <p className="text-base font-medium text-foreground">No active run — <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">pan flywheel start</code> to begin.</p>
                  <p className="mt-2 text-sm text-muted-foreground">The status pane will update as soon as the orchestrator emits its first snapshot.</p>
                </div>
              </div>
            )
          ) : (
            <FlywheelStatePane />
          )}
        </div>
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize flywheel panes"
        className="group relative z-30 flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-border/40 hover:bg-primary/40 active:bg-primary"
        onPointerDown={handleResizePointerDown}
      >
        <div className="h-8 w-0.5 rounded-full bg-border/70 transition-colors group-hover:bg-primary/70 group-active:bg-primary" />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden" aria-label="Flywheel conversation column">
        <FlywheelConversationPane onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
