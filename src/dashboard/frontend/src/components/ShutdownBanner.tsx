/**
 * Safe-shutdown status banner (PAN-5342 WI-11, FR-7, D-12).
 *
 * Renders the server's `system.shutdown_changed` snapshot on every page:
 * the phase, the time left, each pending session with its in-flight tool and
 * that tool's age, the server-side writers, and a collapsed stopped count with
 * the warnings. Force stop (per row), Force all and Cancel shutdown post to the
 * shutdown routes; the server owns every state change (D-5).
 *
 * The frontend keeps the last snapshot after the dashboard exits, so the
 * `complete` header ("Overdeck is shut down. It is safe to reboot.") stays on
 * screen. `HiddenWhenShutDown` lets AppChrome hide the reconnect banner then
 * (D-12) without AppChrome calling a store selector itself.
 *
 * Amber throughout: the drain is waiting on the operator's decision to reboot,
 * force or cancel.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Power } from 'lucide-react';
import { toast } from 'sonner';
import type { ShutdownSnapshot } from '@overdeck/contracts';

import { useDashboardStore, type DashboardState } from '../lib/store';
import { navigateToIssue } from './AgentPillPopoverRow';
import { navigateToDecisionSubject } from '../lib/navigateToDecision';

type PendingSession = ShutdownSnapshot['pending'][number];

/**
 * Like store.ts `selectShutdown`, but tolerant of a state without the field
 * (a snapshot cached before PAN-5342, or a store mock that predates it).
 */
const selectShutdownOrNull = (s: DashboardState): ShutdownSnapshot | null => s.shutdown ?? null;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** `m:ss`, clamped at 0:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ageSeconds(iso: string, now: number): number | null {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 1000)) : null;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function shutdownHeader(shutdown: ShutdownSnapshot, now: number): string {
  switch (shutdown.phase) {
    case 'draining': {
      const sessions = plural(shutdown.pending.length, 'session');
      if (shutdown.overdue) return `Shutting down · past the deadline · ${sessions} still running`;
      return `Shutting down · letting ${sessions} finish · ${formatCountdown(Date.parse(shutdown.deadlineAt) - now)} left`;
    }
    case 'waiting-for-writers':
      return 'Waiting for server work to finish';
    case 'verifying':
      return 'Checking that nothing is still writing';
    case 'complete':
      return shutdown.reboot ? 'Rebooting…' : 'Overdeck is shut down. It is safe to reboot.';
  }
}

function pendingDetail(session: PendingSession, now: number): string {
  if (session.tool && session.toolStartedAt) {
    const age = ageSeconds(session.toolStartedAt, now);
    const what = session.toolDescription ? `${session.tool}: ${session.toolDescription}` : session.tool;
    return age === null ? what : `${what} · ${age}s`;
  }
  return session.activity;
}

function openSession(session: PendingSession): void {
  if (session.kind === 'conversation' && session.conversationName) {
    navigateToDecisionSubject({ id: session.conversationName, source: 'conversation' });
  } else if (session.issueId) {
    navigateToIssue(session.issueId);
  }
}

/** POST a shutdown action; toasts the route's error. Resolves true on success. */
async function postShutdownAction(path: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (res.ok) return true;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    toast.error(data?.error ?? `Shutdown request failed (HTTP ${res.status})`);
  } catch {
    toast.error('Could not reach the dashboard');
  }
  return false;
}

const ACTION_BUTTON =
  'shrink-0 rounded-md border border-warning/40 px-2.5 py-0.5 text-xs font-medium transition-colors hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-50';
const ROW_BUTTON =
  'shrink-0 rounded border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';

export function ShutdownBanner() {
  const shutdown = useDashboardStore(selectShutdownOrNull);
  if (!shutdown) return null;
  return <ShutdownBannerView shutdown={shutdown} />;
}

/** Hides its children once the shutdown reaches `complete` (D-12). */
export function HiddenWhenShutDown({ children }: { children: ReactNode }) {
  const phase = useDashboardStore((s) => selectShutdownOrNull(s)?.phase);
  return phase === 'complete' ? null : <>{children}</>;
}

function ShutdownBannerView({ shutdown }: { shutdown: ShutdownSnapshot }) {
  const complete = shutdown.phase === 'complete';
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  // The countdown and the tool ages tick once a second until the drain completes.
  useEffect(() => {
    if (complete) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [complete]);

  const run = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    try {
      await postShutdownAction(path, body);
    } finally {
      setBusy(null);
    }
  };

  const showForceAll = shutdown.pending.length > 0 || shutdown.writers.length > 0;

  return (
    <div
      role="status"
      data-testid="shutdown-banner"
      className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Power className="h-3.5 w-3.5 shrink-0 text-warning-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 font-medium text-warning-foreground" data-testid="shutdown-banner-header">
          {shutdownHeader(shutdown, now)}
        </p>
        {!complete && (
          <div className="flex shrink-0 items-center gap-2 text-warning-foreground">
            {showForceAll && (
              <button
                type="button"
                className={ACTION_BUTTON}
                disabled={busy !== null}
                onClick={() => void run('force-all', '/api/shutdown/force-all')}
              >
                Force all
              </button>
            )}
            <button
              type="button"
              className={ACTION_BUTTON}
              disabled={busy !== null}
              onClick={() => void run('cancel', '/api/shutdown/cancel')}
            >
              Cancel shutdown
            </button>
          </div>
        )}
      </div>

      {shutdown.pending.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 pl-6" aria-label="Sessions still running">
          {shutdown.pending.map((session) => (
            <li key={session.id} className="flex items-center gap-2 text-xs" data-testid="shutdown-pending-row">
              <span className="min-w-0 truncate">{session.label}</span>
              <span className="min-w-0 truncate text-muted-foreground">{pendingDetail(session, now)}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {(session.issueId || session.conversationName) && (
                  <button type="button" className={ROW_BUTTON} onClick={() => openSession(session)}>
                    Open
                  </button>
                )}
                {!complete && (
                  <button
                    type="button"
                    className={ROW_BUTTON}
                    disabled={busy !== null}
                    aria-label={`Force stop ${session.label}`}
                    onClick={() => void run(`stop:${session.id}`, '/api/shutdown/force-stop', { id: session.id })}
                  >
                    Force stop
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {shutdown.writers.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 pl-6" aria-label="Server work still running">
          {shutdown.writers.map((writer) => {
            const age = writer.startedAt ? ageSeconds(writer.startedAt, now) : null;
            return (
              <li key={`${writer.kind}:${writer.label}`} className="text-xs" data-testid="shutdown-writer-row">
                {writer.label}
                {age !== null && <span className="text-muted-foreground"> · {formatAge(age)}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {shutdown.warnings.length > 0 && (
        <ul className="mt-1.5 list-disc pl-10 text-xs text-warning-foreground" aria-label="Warnings" data-testid="shutdown-warnings">
          {shutdown.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {shutdown.stoppedCount > 0 && (
        <details className="mt-1.5 pl-6 text-xs">
          <summary className="cursor-pointer text-muted-foreground">{shutdown.stoppedCount} stopped</summary>
          <p className="mt-1 text-muted-foreground">
            Stopped at a turn boundary. After the restart, Needs you offers to resume the agents and the conversations
            that were working.
          </p>
        </details>
      )}
    </div>
  );
}
