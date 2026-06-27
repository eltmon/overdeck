import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Loader2, Maximize2, MoreHorizontal, Pause, Plus, RotateCcw, Settings, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { FlywheelStatus } from '@overdeck/contracts';
import { ConversationPanel } from '../chat/ConversationPanel';
import { XTerminal } from '../XTerminal';
import type { Conversation } from '../CommandDeck/ConversationList';
import toggleStyles from '../CommandDeck/styles/command-deck.module.css';
import { useConfirm } from '../DialogProvider';

const FLYWHEEL_CONVERSATION_NAME = 'flywheel-orchestrator';

interface FlywheelRunSummary {
  id: string;
  startedAt: string;
  status: 'running' | 'paused' | 'complete' | 'aborted';
}

interface FlywheelRunDetail extends FlywheelRunSummary {
  latest: FlywheelStatus | null;
  paths: {
    latest: string;
    report?: string;
    openedPr?: string;
  };
}

interface FlywheelRoleConfig {
  harness?: 'claude-code' | 'ohmypi' | 'codex';
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  maxAgents?: number;
  scope?: 'pan-only' | 'all-tracked-projects';
}

interface SettingsResponse {
  roles?: Record<string, FlywheelRoleConfig | undefined>;
}

interface FlywheelConversationPaneProps {
  onOpenSettings?: () => void;
}

const DEFAULT_FLYWHEEL_CONFIG: Required<FlywheelRoleConfig> = {
  harness: 'claude-code',
  model: 'claude-opus-4-8',
  effort: 'high',
  maxAgents: 8,
  scope: 'pan-only',
};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

async function fetchFlywheelConversation(): Promise<Conversation | null> {
  const res = await fetch('/api/flywheel/conversation');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<Conversation>;
}

async function postFlywheelAction<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function formatScope(value: string): string {
  if (value === 'pan-only') return 'PAN only';
  if (value === 'all-tracked-projects') return 'All tracked projects';
  return value;
}

export function resolveFlywheelConfig(settings: SettingsResponse | undefined): Required<FlywheelRoleConfig> {
  return {
    ...DEFAULT_FLYWHEEL_CONFIG,
    ...(settings?.roles?.['flywheel'] ?? {}),
  };
}

export function findFlywheelConversation(conversations: Conversation[]): Conversation | null {
  return conversations.find((conversation) => (
    conversation.name === FLYWHEEL_CONVERSATION_NAME || conversation.tmuxSession === FLYWHEEL_CONVERSATION_NAME
  )) ?? null;
}

type FlywheelPaneViewMode = 'conversation' | 'terminal';

export function FlywheelConversationPane({ onOpenSettings }: FlywheelConversationPaneProps) {
  const [viewMode, setViewMode] = useState<FlywheelPaneViewMode>('conversation');
  const [moreOpen, setMoreOpen] = useState(false);
  const isPopoutWindow = typeof window !== 'undefined' && window.location.pathname === '/popout/flywheel-conversation';
  const queryClient = useQueryClient();
  const runsQuery = useQuery({
    queryKey: ['flywheel-runs'],
    queryFn: () => fetchJson<FlywheelRunSummary[]>('/api/flywheel/runs?limit=10'),
    refetchInterval: 5000,
  });
  const latestRun = runsQuery.data?.[0] ?? null;
  const runDetailQuery = useQuery({
    queryKey: ['flywheel-run-detail', latestRun?.id],
    queryFn: () => fetchJson<FlywheelRunDetail>(`/api/flywheel/runs/${encodeURIComponent(latestRun!.id)}`),
    enabled: !!latestRun?.id,
    refetchInterval: latestRun?.status === 'running' ? 5000 : false,
  });
  const conversationQuery = useQuery({
    queryKey: ['conversation', FLYWHEEL_CONVERSATION_NAME],
    queryFn: fetchFlywheelConversation,
    refetchInterval: 5000,
  });
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<SettingsResponse>('/api/settings'),
    staleTime: 30000,
  });
  const run = runDetailQuery.data ?? null;
  const activeRun = run?.status === 'running' ? run : null;
  const status = (run?.status === 'running' || run?.status === 'paused') ? run.latest : null;
  const conversation = conversationQuery.data ?? null;
  const config = resolveFlywheelConfig(settingsQuery.data);
  const runState: 'none' | 'running' | 'paused' = run?.status === 'running'
    ? 'running'
    : run?.status === 'paused'
      ? 'paused'
      : 'none';
  const confirm = useConfirm();

  const refreshFlywheel = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['flywheel-runs'] }),
      queryClient.invalidateQueries({ queryKey: ['flywheel-run-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['conversation', FLYWHEEL_CONVERSATION_NAME] }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: () => postFlywheelAction('/api/flywheel/start'),
    onSuccess: async () => {
      toast.success('Flywheel started');
      await refreshFlywheel();
    },
    onError: (error: Error) => toast.error(`Failed to start Flywheel: ${error.message}`),
  });
  const pauseMutation = useMutation({
    mutationFn: () => postFlywheelAction('/api/flywheel/pause'),
    onSuccess: async () => {
      toast.success('Flywheel paused');
      await refreshFlywheel();
    },
    onError: (error: Error) => toast.error(`Failed to pause Flywheel: ${error.message}`),
  });
  const resumeMutation = useMutation({
    mutationFn: () => postFlywheelAction('/api/flywheel/resume'),
    onSuccess: async () => {
      toast.success('Flywheel resumed');
      await refreshFlywheel();
    },
    onError: (error: Error) => toast.error(`Failed to resume Flywheel: ${error.message}`),
  });
  const newRunMutation = useMutation({
    mutationFn: async () => {
      if (runState === 'paused') {
        await postFlywheelAction('/api/flywheel/report');
      }
      return postFlywheelAction('/api/flywheel/start');
    },
    onSuccess: async () => {
      toast.success('Flywheel started');
      await refreshFlywheel();
    },
    onError: (error: Error) => toast.error(`Failed to start Flywheel: ${error.message}`),
  });
  const openReportMutation = useMutation({
    mutationFn: () => postFlywheelAction('/api/flywheel/report/open', { runId: run?.id }),
    onError: (error: Error) => toast.error(`Failed to open run report: ${error.message}`),
  });
  const reportMutation = useMutation({
    mutationFn: () => postFlywheelAction('/api/flywheel/report'),
    onSuccess: async () => {
      toast.success('Flywheel run reported');
      await refreshFlywheel();
    },
    onError: (error: Error) => toast.error(`Failed to report Flywheel run: ${error.message}`),
  });
  const abortMutation = useMutation({
    mutationFn: () => postFlywheelAction('/api/flywheel/abort'),
    onSuccess: async () => {
      toast.success('Flywheel run aborted');
      await refreshFlywheel();
    },
    onError: (error: Error) => toast.error(`Failed to abort Flywheel: ${error.message}`),
  });

  const handleAbort = async () => {
    const ok = await confirm({
      title: 'Abort Flywheel Run',
      message: `${run?.id ?? 'The active run'} will be discarded without a report. Continue?`,
      confirmLabel: 'Abort Run',
      variant: 'destructive',
    });
    if (!ok) return;
    abortMutation.mutate();
  };

  const handleReport = async () => {
    const ok = await confirm({
      title: 'Finalize Run Report',
      message: `Write the report for ${run?.id ?? 'the active run'} and close it out. The orchestrator session must be paused or stopped first; if it is alive, this will fail.`,
      confirmLabel: 'Write Report',
      variant: 'default',
    });
    if (!ok) return;
    reportMutation.mutate();
  };

  const handleNewRun = async () => {
    if (runState === 'paused') {
      const ok = await confirm({
        title: 'Start New Run',
        message: `${run?.id ?? 'The current run'} is paused. Reporting it will close the run and start a fresh one. Continue?`,
        confirmLabel: 'Report & Start New',
        variant: 'destructive',
      });
      if (!ok) return;
    } else if (runState === 'running') {
      const ok = await confirm({
        title: 'Start New Run',
        message: `${run?.id ?? 'The current run'} is RUNNING. Starting a new run will abort the active orchestrator session and discard its in-flight work. Continue?`,
        confirmLabel: 'Abort & Start New',
        variant: 'destructive',
      });
      if (!ok) return;
    }
    newRunMutation.mutate();
  };

  const actionPending = startMutation.isPending || pauseMutation.isPending || resumeMutation.isPending || newRunMutation.isPending || openReportMutation.isPending || abortMutation.isPending || reportMutation.isPending;
  const topBarLoading = runsQuery.isLoading || runDetailQuery.isLoading;

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-border bg-background" aria-label="Flywheel conversation pane">
      <header className="border-b border-border bg-card/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
              <span>{activeRun?.id ?? (run ? `${run.id} (${run.status})` : 'No active run')}</span>
              {topBarLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Model: {status?.orchestrator.model ?? config.model}</span>
              <span>Effort: {status?.orchestrator.effort ?? config.effort}</span>
              <span>Context: {formatPercent(status?.orchestrator.ctxPercent)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={toggleStyles.viewToggle} role="tablist" aria-label="Flywheel pane view">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'conversation'}
                className={`${toggleStyles.viewToggleBtn} ${viewMode === 'conversation' ? toggleStyles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('conversation')}
              >
                Conversation
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'terminal'}
                className={`${toggleStyles.viewToggleBtn} ${viewMode === 'terminal' ? toggleStyles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('terminal')}
                title={conversation ? 'Attach to flywheel-orchestrator tmux session' : 'No flywheel-orchestrator session yet'}
                disabled={!conversation}
              >
                Terminal
              </button>
            </div>
            {/* v3 control bar (PAN-1694): Pause/Resume primary, secondary actions under
                ⋯ More, Abort red + isolated. PAN-RUN-11 guard preserved — no action is
                state-gated-away: Pause/Resume/Abort are always visible, and New Run /
                Write Report / Open Run Report / Pop out / Configure are always reachable
                one click into the More menu. Each keeps its disabled-by-legality logic. */}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/20 disabled:opacity-50"
              onClick={() => pauseMutation.mutate()}
              disabled={actionPending || runState !== 'running'}
              title={runState !== 'running' ? 'No active run to pause' : 'Pause the orchestrator'}
            >
              <Pause className="h-3.5 w-3.5" />
              Pause
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
              onClick={() => resumeMutation.mutate()}
              disabled={actionPending || runState !== 'paused'}
              title={runState !== 'paused' ? 'Run is not paused' : 'Resume the orchestrator'}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Resume
            </button>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                More
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMoreOpen(false)} />
                  <div role="menu" aria-label="More flywheel actions" className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-card p-1 shadow-lg">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                      onClick={() => { setMoreOpen(false); void handleNewRun(); }}
                      disabled={actionPending}
                      title={runState === 'running'
                        ? 'Abort the active run and start a new one'
                        : runState === 'paused'
                          ? 'Report the paused run and start a new one'
                          : 'Start a new Flywheel run'}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New Run
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                      onClick={() => { setMoreOpen(false); void handleReport(); }}
                      disabled={actionPending || runState === 'none'}
                      title={runState === 'none'
                        ? 'No active run to report'
                        : 'Finalize the run report and close out (orchestrator must be paused/stopped)'}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Write Report
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                      onClick={() => { setMoreOpen(false); openReportMutation.mutate(); }}
                      disabled={actionPending || !run?.paths.report}
                      title={run?.paths.report ?? 'No run report yet'}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Run Report
                    </button>
                    {!isPopoutWindow && (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent"
                        onClick={() => {
                          setMoreOpen(false);
                          window.open(
                            '/popout/flywheel-conversation',
                            'flywheel-conversation-popout',
                            'width=1100,height=750,menubar=no,toolbar=no,location=no,status=no',
                          );
                        }}
                        title="Open this view in a separate window"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        Pop out
                      </button>
                    )}
                    <a
                      href="/settings#roles"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent"
                      onClick={(event) => {
                        setMoreOpen(false);
                        if (onOpenSettings) {
                          event.preventDefault();
                          onOpenSettings();
                        }
                      }}
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Configure
                    </a>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-destructive/50 bg-destructive/5 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/15 disabled:opacity-50"
              onClick={handleAbort}
              disabled={actionPending || runState === 'none'}
              title={runState === 'none' ? 'No active run to abort' : 'Discard this run without writing a report'}
            >
              <StopCircle className="h-3.5 w-3.5" />
              Abort
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {conversationQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading flywheel conversation…
          </div>
        ) : conversation ? (
          viewMode === 'terminal' ? (
            <XTerminal sessionName={FLYWHEEL_CONVERSATION_NAME} />
          ) : (
            <ConversationPanel
              conversation={conversation}
              embedded
              onEmbeddedResume={!conversation.sessionAlive ? () => startMutation.mutate() : undefined}
              embeddedResumeLabel={startMutation.isPending ? 'Starting…' : 'Start New Run'}
              onSendFailed={() => void queryClient.invalidateQueries({ queryKey: ['conversation', FLYWHEEL_CONVERSATION_NAME] })}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="text-sm font-medium text-foreground">No flywheel-orchestrator session yet.</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Start a run to create the singleton conversation. Once it exists, this pane reuses the standard conversation transcript and composer, and the Terminal toggle attaches to the orchestrator&apos;s tmux session.
            </p>
          </div>
        )}
      </div>

      <footer className="border-t border-border bg-card/60 p-4 space-y-3">
        <button
          type="button"
          className="w-full rounded-lg border border-border bg-background p-3 text-left hover:bg-accent/60"
          onClick={onOpenSettings}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Run config</span>
            <span className="text-xs font-medium text-primary">Settings → Roles → Flywheel</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Harness</dt>
              <dd className="font-medium text-foreground">{config.harness}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-medium text-foreground">{config.model}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Effort</dt>
              <dd className="font-medium text-foreground">{config.effort}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Max agents</dt>
              <dd className="font-medium text-foreground">{config.maxAgents}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Scope</dt>
              <dd className="font-medium text-foreground">{formatScope(config.scope)}</dd>
            </div>
          </dl>
        </button>
      </footer>
    </section>
  );
}
