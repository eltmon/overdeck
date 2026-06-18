import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlywheelStatus } from '@overdeck/contracts';
import { FlywheelConversationPane } from '../components/flywheel/FlywheelConversationPane';
import { FlywheelStatePane } from '../components/flywheel/FlywheelStatePane';
import { FlywheelStatsPanel } from '../components/flywheel/FlywheelStatsPanel';
import { FlywheelStatusDetails } from '../components/flywheel/FlywheelStatusDetails';
import { MergeQueueCard } from '../components/flywheel/MergeQueueCard';
import { RailCard } from '../components/flywheel/RailCard';
import { MergePolicySection } from '../components/MergePolicySection';
import { subscribeFlywheelStatus } from '../lib/wsTransport';

interface FlywheelPageProps {
  onOpenSettings?: () => void;
  onNavigateAgent?: (agentId: string) => void;
  onNavigateIssue?: (issueId: string) => void;
}

type FlywheelLeftTab = 'status' | 'state' | 'stats';

interface FlywheelConfig {
  auto_pickup_backlog: boolean;
  require_uat_before_merge: boolean;
  merge_train_enabled: boolean;
}

interface FlywheelConfigPatch {
  auto_pickup_backlog?: boolean;
  require_uat_before_merge?: boolean;
  merge_train_enabled?: boolean;
}

interface PendingAutoMerge {
  id: number;
  issueId: string;
  prUrl: string;
  scheduledMergeAt: string;
  status: 'pending' | 'merging' | 'blocked' | 'failed' | 'merged' | 'cancelled';
}

const SPLIT_STORAGE_KEY = 'panopticon.ui.flywheelSplitWidth';
const SPLIT_MIN_LEFT = 360;
const SPLIT_MIN_RIGHT = 360;
const SPLIT_DEFAULT_LEFT = 720;
const FLYWHEEL_CONFIG_QUERY_KEY = ['flywheel', 'config'] as const;
const PENDING_AUTO_MERGES_QUERY_KEY = ['flywheel', 'auto-merge', 'pending'] as const;
const AUTO_PICKUP_BACKLOG_TITLE = 'Off: inventory is restricted to work in progress / in review / blocked / awaiting merge. On: also include READY backlog items bounded by maxAgents.';
const REQUIRE_UAT_BEFORE_MERGE_TITLE = 'On: UAT remains required before merge. Off: eligible merges may be scheduled through the server-managed cooldown.';
const MERGE_TRAIN_TITLE = 'On: after a merge lands, automatically rebase every other ready branch onto the new main, re-verify the clean ones, and dispatch an agent to resolve conflicts. Off (default): siblings are left as-is. Mutates git — enable deliberately.';

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

async function fetchPendingAutoMerges(): Promise<PendingAutoMerge[]> {
  const res = await fetch('/api/flywheel/auto-merge/pending');
  if (!res.ok) throw new Error(`GET /api/flywheel/auto-merge/pending → ${res.status}`);
  return res.json() as Promise<PendingAutoMerge[]>;
}

export function useFlywheelConfig() {
  return useQuery({
    queryKey: FLYWHEEL_CONFIG_QUERY_KEY,
    queryFn: async (): Promise<FlywheelConfig> => {
      const res = await fetch('/api/flywheel/config');
      if (!res.ok) throw new Error(`GET /api/flywheel/config → ${res.status}`);
      return res.json();
    },
    staleTime: 5_000,
  });
}

function usePendingAutoMerges() {
  return useQuery({
    queryKey: PENDING_AUTO_MERGES_QUERY_KEY,
    queryFn: fetchPendingAutoMerges,
    refetchInterval: 5_000,
  });
}

function useCancelAutoMergeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (issueId: string): Promise<void> => {
      const res = await fetch(`/api/flywheel/auto-merge/${encodeURIComponent(issueId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `DELETE /api/flywheel/auto-merge/${issueId} → ${res.status}`);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PENDING_AUTO_MERGES_QUERY_KEY });
    },
  });
}

export function useFlywheelConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: FlywheelConfigPatch): Promise<FlywheelConfig> => {
      const res = await fetch('/api/flywheel/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `POST /api/flywheel/config → ${res.status}`);
      }
      return res.json();
    },
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: FLYWHEEL_CONFIG_QUERY_KEY });
      const previous = queryClient.getQueryData<FlywheelConfig>(FLYWHEEL_CONFIG_QUERY_KEY);
      queryClient.setQueryData<FlywheelConfig>(FLYWHEEL_CONFIG_QUERY_KEY, {
        auto_pickup_backlog: previous?.auto_pickup_backlog ?? false,
        require_uat_before_merge: previous?.require_uat_before_merge ?? true,
        merge_train_enabled: previous?.merge_train_enabled ?? false,
        ...patch,
      });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      queryClient.setQueryData(FLYWHEEL_CONFIG_QUERY_KEY, context?.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(FLYWHEEL_CONFIG_QUERY_KEY, data);
    },
  });
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
  // Thresholds aligned with the orchestrator's 20-minute periodic-sweep contract
  // (roles/flywheel.md tick-loop step 8). Past 20 min = the orchestrator is
  // failing its own contract → destructive. 1–20 min is normal between-sweep
  // breathing → warning. ≤1 min = freshly emitted → live.
  if (ageMs <= 60_000) {
    return { label: 'live', className: 'border-success/30 bg-success/15 text-success' };
  }
  if (ageMs <= 1_200_000) {
    return { label: `last tick ${formatFreshnessAge(ageMs)} ago`, className: 'border-warning/30 bg-warning/15 text-warning' };
  }
  return { label: `stalled — last tick ${formatFreshnessAge(ageMs)} ago`, className: 'border-destructive/30 bg-destructive/15 text-destructive' };
}

function getTabPanelLabel(activeTab: FlywheelLeftTab): string {
  if (activeTab === 'status') return 'Flywheel status';
  if (activeTab === 'state') return 'Flywheel state';
  return 'Flywheel stats';
}

/** Sliding on/off switch for the flywheel-level config toggles (v3 top bar). */
function ToggleSwitch({ label, checked, disabled, title, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground disabled:opacity-50"
    >
      <span
        className={`relative h-4 w-7 rounded-full border transition-colors ${
          checked ? 'border-primary/60 bg-primary/25' : 'border-border bg-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
            checked ? 'left-[14px] bg-primary' : 'left-0.5 bg-muted-foreground'
          }`}
        />
      </span>
      {label}
    </button>
  );
}

function formatAutoMergeCountdown(scheduledMergeAt: string, nowMs: number): string {
  const remainingMs = Date.parse(scheduledMergeAt) - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'merging…';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `auto-merging in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function prLabel(prUrl: string): string {
  const match = prUrl.match(/\/pull\/(\d+)(?:$|[/?#])/);
  return match ? `PR #${match[1]}` : 'PR';
}

function PendingAutoMergesBanner({ onNavigateIssue }: { onNavigateIssue?: (issueId: string) => void }) {
  const { data } = usePendingAutoMerges();
  const cancelMutation = useCancelAutoMergeMutation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [cancellingIssueId, setCancellingIssueId] = useState<string | null>(null);
  const pendingEntries = Array.isArray(data) ? data.filter((entry) => entry.status === 'pending') : [];

  useEffect(() => {
    if (pendingEntries.length === 0) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [pendingEntries.length]);

  const cancel = (issueId: string) => {
    setCancellingIssueId(issueId);
    cancelMutation.mutate(issueId, {
      onSettled: () => setCancellingIssueId(null),
    });
  };

  if (pendingEntries.length === 0) return null;

  return (
    <section className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-3" aria-label="Pending auto-merges">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <h2 className="font-semibold text-foreground">Pending auto-merges</h2>
          <p className="text-xs text-muted-foreground">Flywheel will merge eligible PRs when their cooldown expires.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingEntries.map((entry) => {
            const remainingMs = Date.parse(entry.scheduledMergeAt) - nowMs;
            const isMerging = Number.isFinite(remainingMs) && remainingMs <= 0;
            return (
              <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-background px-3 py-2">
                <a
                  href={`#${entry.issueId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigateIssue?.(entry.issueId);
                  }}
                  className="font-mono text-xs font-semibold text-primary hover:underline"
                >
                  {entry.issueId}
                </a>
                <span className="text-xs text-muted-foreground">{prLabel(entry.prUrl)}</span>
                <span className="font-mono text-xs text-foreground">{formatAutoMergeCountdown(entry.scheduledMergeAt, nowMs)}</span>
                <button
                  type="button"
                  disabled={cancellingIssueId !== null || cancelMutation.isPending || entry.status === 'merging' || isMerging}
                  onClick={() => cancel(entry.issueId)}
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function FlywheelPage({ onOpenSettings, onNavigateAgent, onNavigateIssue }: FlywheelPageProps) {
  const [status, setStatus] = useState<FlywheelStatus | null>(null);
  const [activeTab, setActiveTab] = useState<FlywheelLeftTab>('status');
  const [leftWidth, setLeftWidth] = useState<number>(getStoredSplitWidth);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const leftWidthRef = useRef(leftWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { data: flywheelConfig } = useFlywheelConfig();
  const flywheelConfigMutation = useFlywheelConfigMutation();
  const autoPickupBacklog = flywheelConfig?.auto_pickup_backlog ?? false;
  const requireUatBeforeMerge = flywheelConfig?.require_uat_before_merge ?? true;
  const mergeTrainEnabled = flywheelConfig?.merge_train_enabled ?? false;
  const configBusy = flywheelConfigMutation.isPending;
  const configError = flywheelConfigMutation.error instanceof Error ? flywheelConfigMutation.error.message : null;

  // A paused orchestrator emits no live status snapshot, so `status` is null —
  // but that must NOT read as "stopped". Fetch the latest run's lifecycle so the
  // empty-state can tell a paused run (resume to continue) from no run at all
  // (start to begin). Mirrors the Sidebar / FlywheelConversationPane source.
  const { data: latestRun } = useQuery({
    queryKey: ['flywheel-latest-run-lifecycle'],
    queryFn: async (): Promise<{ status: 'running' | 'paused' | 'complete' | 'aborted' } | null> => {
      const res = await fetch('/api/flywheel/runs?limit=1');
      if (!res.ok) return null;
      const runs = (await res.json()) as Array<{ status: 'running' | 'paused' | 'complete' | 'aborted' }> | null;
      return Array.isArray(runs) ? (runs[0] ?? null) : null;
    },
    refetchInterval: 5000,
  });
  const isPaused = latestRun?.status === 'paused';

  // When the run is paused, the last-emitted snapshot is stale (often hours old)
  // and `/api/flywheel/current` returns null, while the RPC stream may still
  // replay the frozen snapshot — so `status` flickers between the two and the
  // header/suggestions flash-then-vanish. A paused run is not a live run: don't
  // render its stale status anywhere. The paused/idle empty states take over.
  const effectiveStatus = isPaused ? null : status;

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

  const freshness = effectiveStatus ? getLastTickFreshness(effectiveStatus.lastTickAt, nowMs) : null;

  return (
    <div
      ref={containerRef}
      aria-label="Flywheel page"
      className="flex h-full w-full flex-col overflow-hidden bg-background"
    >
      {/* v3: slim flywheel-level header bar — title, run status, config toggles, stats */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card/60 px-5 py-2.5">
        <h1 className="font-display text-base font-semibold tracking-tight text-foreground">Fix-All Flywheel</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          <span className={effectiveStatus ? 'h-1.5 w-1.5 rounded-full bg-success' : 'h-1.5 w-1.5 rounded-full bg-muted-foreground'} />
          {effectiveStatus ? `running · ${effectiveStatus.runId}` : isPaused ? 'paused' : 'idle'}
        </span>
        <a
          href="https://github.com/eltmon/overdeck/blob/main/docs/FLYWHEEL.md"
          target="_blank"
          rel="noreferrer"
          aria-label="Flywheel docs"
          className="text-xs font-medium text-primary hover:underline"
        >
          docs
        </a>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <div className="flex items-center gap-3">
            <ToggleSwitch label="Auto-pickup" checked={autoPickupBacklog} disabled={configBusy} title={AUTO_PICKUP_BACKLOG_TITLE} onChange={(next) => flywheelConfigMutation.mutate({ auto_pickup_backlog: next })} />
            <ToggleSwitch label="Require UAT" checked={requireUatBeforeMerge} disabled={configBusy} title={REQUIRE_UAT_BEFORE_MERGE_TITLE} onChange={(next) => flywheelConfigMutation.mutate({ require_uat_before_merge: next })} />
            <ToggleSwitch label="Merge train" checked={mergeTrainEnabled} disabled={configBusy} title={MERGE_TRAIN_TITLE} onChange={(next) => flywheelConfigMutation.mutate({ merge_train_enabled: next })} />
          </div>
          {effectiveStatus && (
            <div className="flex items-center gap-4 border-l border-border pl-4">
              <span className="flex flex-col items-end leading-tight"><b className="text-[13px] text-foreground">{effectiveStatus.system.agentsActive}/{effectiveStatus.system.agentsCap}</b><span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">agents</span></span>
              <span className="flex flex-col items-end leading-tight"><b className="text-[13px] text-foreground">{effectiveStatus.activePipeline.length}</b><span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">in flight</span></span>
              <span className="flex flex-col items-end leading-tight"><b className="text-[13px] text-foreground">{formatElapsed(effectiveStatus.elapsedMs)}</b><span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">{effectiveStatus.ticks} ticks</span></span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${freshness?.className ?? ''}`}>{freshness?.label ?? '—'}</span>
            </div>
          )}
        </div>
      </header>
      {configError && <div className="border-b border-border bg-destructive/5 px-5 py-1.5 text-xs text-destructive">{configError}</div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          className="relative flex shrink-0 flex-col overflow-y-auto border-r border-border"
          style={{ width: `${leftWidth}px`, minWidth: `${SPLIT_MIN_LEFT}px` }}
          aria-label="Flywheel control rail"
        >
          <MergeQueueCard active={!!effectiveStatus || isPaused} onNavigateIssue={onNavigateIssue} />
          <MergePolicySection onNavigateIssue={onNavigateIssue} />
          <PendingAutoMergesBanner onNavigateIssue={onNavigateIssue} />

          <RailCard icon={<Activity className="h-3.5 w-3.5 text-primary" />} label="Run status" ariaLabel="Flywheel run status">
            <div className="mb-3" role="tablist" aria-label="Flywheel left-pane tabs">
              <div className="inline-flex rounded-lg border border-border bg-background p-1 text-xs font-medium">
                {(['status', 'state', 'stats'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    className={
                      activeTab === tab
                        ? 'rounded-md bg-primary px-3 py-1.5 text-primary-foreground'
                        : 'rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground'
                    }
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div role="tabpanel" aria-label={getTabPanelLabel(activeTab)}>
              {activeTab === 'status' ? (
                effectiveStatus ? (
                  <FlywheelStatusDetails status={effectiveStatus} onNavigateAgent={onNavigateAgent} onNavigateIssue={onNavigateIssue} />
                ) : isPaused ? (
                  <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
                    <div>
                      <p className="text-sm font-medium text-foreground">Run paused — <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">pan flywheel resume</code> to continue.</p>
                      <p className="mt-2 text-xs text-muted-foreground">The orchestrator is paused; its run state is preserved. The status pane will repopulate when it resumes.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
                    <div>
                      <p className="text-sm font-medium text-foreground">No active run — <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">pan flywheel start</code> to begin.</p>
                      <p className="mt-2 text-xs text-muted-foreground">The status pane will update as soon as the orchestrator emits its first snapshot.</p>
                    </div>
                  </div>
                )
              ) : activeTab === 'state' ? (
                <FlywheelStatePane />
              ) : (
                <FlywheelStatsPanel />
              )}
            </div>
          </RailCard>
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
    </div>
  );
}
