/**
 * The flywheel conversation column (PAN-3964 FR-13). Embeds the ordinary
 * conversation panel for `conv-flywheel` (with a Terminal toggle) and the
 * run controls. Which controls show is decided by the derived run state from
 * `GET /api/flywheel/status`; every control POSTs to the route that wraps the
 * same action the CLI verb calls.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, Maximize2, Pause, Play, RotateCcw, Square, StopCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  FLYWHEEL_CONVERSATION_NAME,
  FLYWHEEL_CONVERSATION_QUERY_KEY,
  FlywheelActionHttpError,
  useFlywheelAction,
  useFlywheelStatus,
  type FlywheelAction,
} from '../../lib/flywheelApi';
import { ConversationPanel } from '../chat/ConversationPanel';
import type { Conversation } from '../CommandDeck/ConversationList';
import { useConfirm } from '../DialogProvider';
import { ViewToggle } from '../shared/ViewToggle';
import { XTerminal } from '../XTerminal';

export const FLYWHEEL_POPOUT_PATH = '/popout/flywheel-conversation';

interface FlywheelRoleConfig {
  harness?: string;
  model?: string;
  effort?: string;
  maxAgents?: number;
  scope?: string;
}

async function fetchConversation(): Promise<Conversation | null> {
  const res = await fetch(`/api/conversations/${FLYWHEEL_CONVERSATION_NAME}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/conversations/${FLYWHEEL_CONVERSATION_NAME} → ${res.status}`);
  return res.json() as Promise<Conversation>;
}

async function fetchRoleConfig(): Promise<FlywheelRoleConfig> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`GET /api/settings → ${res.status}`);
  const settings = (await res.json()) as { roles?: Record<string, FlywheelRoleConfig | undefined> };
  return settings.roles?.['flywheel'] ?? {};
}

const ACTION_TOAST: Record<FlywheelAction, string> = {
  start: 'Flywheel started',
  pause: 'Flywheel paused',
  resume: 'Flywheel resumed',
  stop: 'Asked the loop to write its report; it pauses when done',
  abort: 'Flywheel aborted',
  report: 'Asked the loop to write .pan/flywheel/report.md',
};

const BUTTON = 'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50';
const PRIMARY_BUTTON = 'inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-50';
const DESTRUCTIVE_BUTTON = 'inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50';

function useRunAction(action: FlywheelAction, onError?: (error: Error) => void) {
  const mutation = useFlywheelAction(action);
  return {
    pending: mutation.isPending,
    run: (body?: unknown) => mutation.mutate(body, {
      onSuccess: () => toast.success(ACTION_TOAST[action]),
      onError: (error: Error) => {
        toast.error(`Flywheel ${action} failed: ${error.message}`);
        onError?.(error);
      },
    }),
  };
}

/** The route's 409 for a leftover `conv-flywheel` session with no row (D9). */
const ORPHAN_CODE = 'FlywheelOrphanSession';

export function FlywheelConversationPane({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [viewMode, setViewMode] = useState<'conversation' | 'terminal'>('conversation');
  const isPopout = typeof window !== 'undefined' && window.location.pathname === FLYWHEEL_POPOUT_PATH;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const statusQuery = useFlywheelStatus();
  const conversationQuery = useQuery({ queryKey: FLYWHEEL_CONVERSATION_QUERY_KEY, queryFn: fetchConversation, refetchInterval: 5_000 });
  const configQuery = useQuery({ queryKey: ['settings', 'roles', 'flywheel'], queryFn: fetchRoleConfig, staleTime: 30_000 });

  // A start that trips the orphan guard is the one failure the operator can
  // clear from here: `Start fresh` replaces the leftover session.
  const [orphanDetected, setOrphanDetected] = useState(false);
  const start = useRunAction('start', (error) => {
    if (error instanceof FlywheelActionHttpError && error.code === ORPHAN_CODE) setOrphanDetected(true);
  });
  const pause = useRunAction('pause');
  const resume = useRunAction('resume');
  const report = useRunAction('report');
  const stop = useRunAction('stop');
  const abort = useRunAction('abort');
  const busy = start.pending || pause.pending || resume.pending || report.pending || stop.pending || abort.pending;

  const run = statusQuery.data?.run;
  // What is actually running, from the derived status — not the role config in
  // the footer, which says what the next start would use.
  const derivedConv = statusQuery.data?.conversation;
  const liveConversation = derivedConv ? `${derivedConv.harness ?? '—'} · ${derivedConv.model ?? '—'}` : null;

  // Once the flywheel is running or paused there is nothing orphaned to clear.
  useEffect(() => {
    if (run && run !== 'idle') setOrphanDetected(false);
  }, [run]);
  const conversation = conversationQuery.data ?? null;
  const config = configQuery.data ?? {};

  const handleStop = async () => {
    const ok = await confirm({
      title: 'Stop the flywheel',
      message: 'The loop writes .pan/flywheel/report.md and commits it, then the conversation pauses. Continue?',
      confirmLabel: 'Stop with report',
    });
    if (ok) stop.run();
  };

  const handleAbort = async () => {
    const ok = await confirm({
      title: 'Abort the flywheel',
      message: 'The conversation stops now, without a report. Its transcript is kept. Continue?',
      confirmLabel: 'Abort',
      variant: 'destructive',
    });
    if (ok) abort.run();
  };

  const handleStartFresh = async () => {
    const ok = await confirm({
      title: 'Start a fresh flywheel',
      message: orphanDetected
        ? `A leftover ${FLYWHEEL_CONVERSATION_NAME} session is still running with no conversation row. Start fresh replaces it with a new one; the old transcript stays on disk. Continue?`
        : 'The paused flywheel conversation is replaced by a new one. The old transcript stays on disk. Continue?',
      confirmLabel: 'Start fresh',
      variant: 'destructive',
    });
    if (ok) start.run({ fresh: true });
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label="Flywheel conversation pane">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <ViewToggle
          ariaLabel="Flywheel pane view"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { id: 'conversation', label: 'Conversation' },
            {
              id: 'terminal',
              label: 'Terminal',
              disabled: !conversation,
              disabledReason: conversation ? `Attach to ${FLYWHEEL_CONVERSATION_NAME}` : 'No flywheel conversation yet',
            },
          ]}
        />
        {liveConversation && (
          <span className="truncate font-mono text-[11px] text-muted-foreground" data-testid="flywheel-live-conversation">
            {liveConversation}
          </span>
        )}
        {(statusQuery.isLoading || busy) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Working" />}
        <div className="ml-auto flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Flywheel controls">
          {run === 'idle' && (
            <>
              <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => start.run()}>
                <Play className="h-3.5 w-3.5" />Start
              </button>
              {orphanDetected && (
                <button type="button" className={BUTTON} disabled={busy} onClick={() => void handleStartFresh()}>
                  <Play className="h-3.5 w-3.5" />Start fresh
                </button>
              )}
            </>
          )}
          {run === 'paused' && (
            <>
              {/* The embedded panel's "Resume flywheel" is this view's one primary CTA. */}
              <button type="button" className={BUTTON} disabled={busy} onClick={() => resume.run()}>
                <RotateCcw className="h-3.5 w-3.5" />Resume
              </button>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => void handleStartFresh()}>
                <Play className="h-3.5 w-3.5" />Start fresh
              </button>
            </>
          )}
          {run === 'running' && (
            <>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => pause.run()}>
                <Pause className="h-3.5 w-3.5" />Pause
              </button>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => report.run()}>
                <FileText className="h-3.5 w-3.5" />Report
              </button>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => void handleStop()}>
                <Square className="h-3.5 w-3.5" />Stop
              </button>
              <button type="button" className={DESTRUCTIVE_BUTTON} disabled={busy} onClick={() => void handleAbort()}>
                <StopCircle className="h-3.5 w-3.5" />Abort
              </button>
            </>
          )}
          {!isPopout && (
            <button
              type="button"
              className={BUTTON}
              title="Open this pane in its own window"
              onClick={() => window.open(FLYWHEEL_POPOUT_PATH, 'flywheel-conversation-popout', 'width=1100,height=750,menubar=no,toolbar=no,location=no,status=no')}
            >
              <Maximize2 className="h-3.5 w-3.5" />Pop out
            </button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {conversationQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Loading flywheel conversation…
          </div>
        ) : conversation ? (
          viewMode === 'terminal' ? (
            <XTerminal sessionName={FLYWHEEL_CONVERSATION_NAME} />
          ) : (
            <ConversationPanel
              conversation={conversation}
              embedded
              onEmbeddedResume={run === 'paused' ? () => resume.run() : undefined}
              embeddedResumeLabel={resume.pending ? 'Resuming…' : 'Resume flywheel'}
              onSendFailed={() => void queryClient.invalidateQueries({ queryKey: FLYWHEEL_CONVERSATION_QUERY_KEY })}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <p className="text-sm font-medium text-foreground">No flywheel conversation yet — Start to create it</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Start opens <span className="font-mono">{FLYWHEEL_CONVERSATION_NAME}</span> running /pan-flywheel. This pane then shows its transcript and composer; the Terminal toggle attaches to its session.
            </p>
          </div>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2.5">
        <button
          type="button"
          aria-label="Open Flywheel run config in Settings"
          className="w-full text-left"
          onClick={onOpenSettings}
        >
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Run config</span>
            <span className="text-[11px] text-primary">Settings → Roles → Flywheel</span>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="flywheel-run-config">
            {([
              ['Harness', config.harness],
              ['Model', config.model],
              ['Effort', config.effort],
              ['Max agents', config.maxAgents],
              ['Scope', config.scope],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex gap-1.5">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono text-foreground">{value ?? 'default'}</dd>
              </div>
            ))}
          </dl>
        </button>
      </footer>
    </section>
  );
}
