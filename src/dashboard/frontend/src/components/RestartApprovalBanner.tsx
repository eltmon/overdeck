import { useMutation } from '@tanstack/react-query';
import { PauseCircle } from 'lucide-react';
import { toast } from 'sonner';

import { selectRestartGate, useDashboardStore } from '../lib/store';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

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
 * State arrives through the read model (snapshot on connect, then
 * `restart_gate.changed` events); the banner never polls. A request whose
 * process died stops refreshing and disappears on its own within 20 seconds.
 */
export function RestartApprovalBanner() {
  const gate = useDashboardStore(selectRestartGate);

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

  // `pending` is only awaiting the operator while the gate is in `pending`.
  // Once approved or claimed the restart is already on its way, so asking
  // again would be noise.
  if (!gate || gate.status !== 'pending' || gate.pending.length === 0) return null;

  const count = gate.pending.length;
  const reasons = gate.pending.map((request) => request.reason || request.kind).join('; ');
  const explanation =
    `${count} process${count === 1 ? '' : 'es'} asked to restart the dashboard and ${count === 1 ? 'is' : 'are'} waiting for you. ` +
    'Nothing restarts until you approve, and one approval covers every request listed here — they are satisfied by a single restart. ' +
    'Approve here, or run `pan restart approve` in a terminal. ' +
    `Waiting: ${reasons}`;

  return (
    <div
      className="bg-warning/10 flex flex-1 items-center gap-2 px-4 py-1.5"
      data-testid="restart-approval-banner"
    >
      <PauseCircle className="w-3.5 h-3.5 text-warning-foreground shrink-0" />
      <p className="flex-1 truncate text-xs text-warning-foreground" title={explanation}>
        <span className="font-medium">
          {count === 1 ? 'A dashboard restart is waiting for your approval' : `${count} dashboard restarts are waiting for your approval`}
        </span>
        {' — '}{reasons}
      </p>
      <button
        type="button"
        onClick={() => approve.mutate()}
        disabled={approve.isPending}
        className="h-[26px] shrink-0 rounded-sm bg-warning/20 px-[10px] text-[11px] font-medium text-warning-foreground hover:bg-warning/30 disabled:opacity-50"
      >
        {approve.isPending ? 'Approving…' : 'Restart now'}
      </button>
    </div>
  );
}
