import { useMutation } from '@tanstack/react-query';
import { Info, PauseCircle, RotateCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { selectRestartGate, useDashboardStore } from '../lib/store';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

/**
 * How long the "nobody restarted" notice stays up before the banner clears
 * (PAN-3731). Measured from `lastOutcome.at`, so a browser that connects late
 * shows only what is left of the window — the server needs no extra timer.
 */
export const OUTCOME_NOTICE_MS = 8_000;

/**
 * Amber says a human must act; blue says a machine is working; neutral is the
 * rest state. One tone per gate status, no decoration.
 */
const TONES = {
  waiting: { strip: 'bg-warning/10', text: 'text-warning-foreground' },
  working: { strip: 'bg-info/10', text: 'text-info-foreground' },
  settled: { strip: 'bg-muted/40', text: 'text-muted-foreground' },
} as const;

function GateStrip({
  tone,
  icon: Icon,
  title,
  children,
  action,
}: {
  tone: keyof typeof TONES;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <div
      className={`${palette.strip} flex flex-1 items-center gap-2 px-4 py-1.5`}
      data-testid="restart-approval-banner"
    >
      <Icon className={`w-3.5 h-3.5 ${palette.text} shrink-0`} />
      <p className={`flex-1 truncate text-xs ${palette.text}`} title={title}>
        {children}
      </p>
      {action}
    </div>
  );
}

/**
 * RestartApprovalBanner (PAN-3729) — the operator's approval surface for
 * voluntary dashboard restarts.
 *
 * A voluntary restart is one a process asked for: the post-merge deploy
 * script, `pan reload`, or `pan restart`. Each of those now registers a
 * request and waits indefinitely instead of restarting the dashboard under the
 * operator mid-work. This banner is where the operator lets them through.
 *
 * One approval satisfies EVERY request listed here — the requests are
 * coalesced into a single restart, not one restart each.
 *
 * The banner follows the approval through (PAN-3731): the click swaps it to
 * "Approved", then "Restarting…" once a requester claims, and if every
 * requester died before claiming it says so for a few seconds. Before that the
 * banner simply vanished on approval, which read as a broken button.
 *
 * State arrives through the read model (snapshot on connect, then
 * `restart_gate.changed` events); the banner never polls. A request whose
 * process died stops refreshing and disappears on its own within 20 seconds.
 */
export function RestartApprovalBanner() {
  const gate = useDashboardStore(selectRestartGate);
  const outcomeAt = gate?.lastOutcome?.type === 'pruned-unclaimed' ? gate.lastOutcome.at : null;
  const [noticeElapsed, setNoticeElapsed] = useState(false);

  // The notice is a fixed window from when the server recorded the outcome —
  // not from when this browser saw it — so a reload cannot restart the clock.
  useEffect(() => {
    if (!outcomeAt) return;
    const remaining = OUTCOME_NOTICE_MS - (Date.now() - Date.parse(outcomeAt));
    if (remaining <= 0) {
      setNoticeElapsed(true);
      return;
    }
    setNoticeElapsed(false);
    const timer = setTimeout(() => setNoticeElapsed(true), remaining);
    return () => clearTimeout(timer);
  }, [outcomeAt]);

  const approve = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/restart-gate/approve', {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; pendingCount?: number };
      if (!response.ok) throw new Error(body.error || 'Failed to approve the restart');
      return body;
    },
    onSuccess: (body) => {
      const count = body.pendingCount ?? 0;
      toast.success(
        count > 0
          ? `Restart approved — ${count} waiting request${count === 1 ? '' : 's'} will be satisfied by one restart`
          : 'Nothing left to restart for — every waiting request had already given up',
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to approve the restart'),
  });

  if (!gate) return null;

  const count = gate.pending.length;
  const reasons = gate.pending.map((request) => request.reason || request.kind).join('; ');

  if (gate.status === 'pending' && count > 0) {
    const explanation =
      `${count} process${count === 1 ? '' : 'es'} asked to restart the dashboard and ${count === 1 ? 'is' : 'are'} waiting for you. ` +
      'Nothing restarts until you approve, and one approval covers every request listed here — they are satisfied by a single restart. ' +
      'Approve here, or run `pan restart approve` in a terminal. ' +
      `Waiting: ${reasons}`;
    return (
      <GateStrip
        tone="waiting"
        icon={PauseCircle}
        title={explanation}
        action={
          <button
            type="button"
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
            className="h-[26px] shrink-0 rounded-sm bg-warning/20 px-[10px] text-[11px] font-medium text-warning-foreground hover:bg-warning/30 disabled:opacity-50"
          >
            {approve.isPending ? 'Approving…' : 'Restart now'}
          </button>
        }
      >
        <span className="font-medium">
          {count === 1 ? 'A dashboard restart is waiting for your approval' : `${count} dashboard restarts are waiting for your approval`}
        </span>
        {' — '}{reasons}
      </GateStrip>
    );
  }

  // Approved, but the restart itself belongs to the requester: it performs the
  // restart on its next poll, which is up to 5 seconds away.
  if (gate.status === 'approved') {
    const names = gate.pending.map((request) => request.requesterId).join(', ') || 'the requester';
    return (
      <GateStrip
        tone="working"
        icon={RotateCw}
        title={`The restart is approved. ${names} performs it on the next poll — nothing else is waiting on you.`}
      >
        <span className="font-medium">Approved</span>
        {' — waiting for '}{names}{' to restart…'}
      </GateStrip>
    );
  }

  // A requester holds the restart, so the WebSocket is about to drop. Saying so
  // makes the reconnect expected rather than alarming.
  if (gate.status === 'claimed') {
    return (
      <GateStrip
        tone="working"
        icon={RotateCw}
        title="A requester is restarting the dashboard now. This page loses its connection for a moment and reconnects on its own."
      >
        <span className="font-medium">Restarting…</span>
        {' — the dashboard reconnects on its own in a moment'}
      </GateStrip>
    );
  }

  // Every member of the approved epoch expired before claiming: the approval
  // was real, the restart never happened, and without this the banner would
  // just disappear.
  if (outcomeAt && !noticeElapsed) {
    return (
      <GateStrip
        tone="settled"
        icon={Info}
        title="Every process waiting on that approval had already exited, so the approval had nothing left to restart. Restart again from a terminal if you still want one."
      >
        The requester(s) went away without restarting — nothing was restarted.
      </GateStrip>
    );
  }

  return null;
}
