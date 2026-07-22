/**
 * Start-block recovery dialog. The start route's 409s (resumable session,
 * troubled gate, paused gate) used to surface as raw alerts telling the
 * operator to run `pan resume` / `pan untroubled` / `pan unpause` — this
 * dialog IS those choices, as working buttons.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, RotateCcw, ShieldCheck, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { useResumeRecovery, recoveryFromBody, type RecoveryRequest } from '../lib/resumeRecovery';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { toastResumeOutcome } from '../lib/resumeOutcome';
import { useAlert } from './DialogProvider';

async function postJson(url: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: body === undefined ? '{}' : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error || message;
    } catch { /* keep default */ }
    throw new Error(message);
  }
  return res.json().catch(() => null);
}

const CONTENT: Record<RecoveryRequest['kind'], { title: (r: RecoveryRequest) => string; body: string; primary: string }> = {
  resumable: {
    title: (r) => `${r.agentId} has a saved session`,
    body: 'Resume it to continue with its memory intact, or start fresh (for example to switch model).',
    primary: 'Resume session',
  },
  troubled: {
    title: (r) => `${r.agentId} is troubled${r.detail ? ` (${r.detail})` : ''}`,
    body: 'The deacon quarantined this agent after repeated failures — starting it is blocked until the gate is cleared. Clear the gate and start again?',
    primary: 'Clear gate & start',
  },
  paused: {
    title: (r) => `${r.agentId} is paused${r.detail ? ` (${r.detail})` : ''}`,
    body: 'This agent was deliberately paused — starting it is blocked until it is unpaused. Unpause and start it?',
    primary: 'Unpause & start',
  },
  'live-session': {
    title: (r) => `${r.agentId} is still running`,
    body: 'Restarting it (for example with a different model) requires stopping it first. The workspace, plan, and branch are kept.',
    primary: 'Stop & restart',
  },
};

export function ResumableSessionDialog() {
  const request = useResumeRecovery((s) => s.request);
  const closeRecovery = useResumeRecovery((s) => s.closeRecovery);
  const openRecovery = useResumeRecovery((s) => s.openRecovery);
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const [pending, setPending] = useState<'primary' | 'fresh' | null>(null);

  if (!request) return null;
  const { agentId, issueId, kind } = request;
  const content = CONTENT[kind];

  const fail = (err: unknown) => {
    setPending(null);
    showAlert({ message: err instanceof Error ? err.message : 'Recovery failed', variant: 'error' });
  };

  /**
   * Start the issue after a gate clear / session reset. If the start itself
   * hits a NEW start-block (e.g. unpausing reveals a resumable session), swap
   * the dialog to that recovery instead of failing with a raw CLI-text alert.
   * Returns true when the dialog was handed off to a new request.
   */
  const startIssue = async (): Promise<boolean> => {
    if (!issueId) return false;
    const res = await fetch('/api/agents', {
      method: 'POST',
      credentials: 'include',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ issueId }),
    });
    if (res.ok) return false;
    const parsed = await res.json().catch(() => null);
    const recovery = res.status === 409 ? recoveryFromBody(parsed) : null;
    if (recovery) {
      setPending(null);
      openRecovery({ ...recovery, issueId });
      return true;
    }
    throw new Error((parsed as { error?: string } | null)?.error || `Request failed (${res.status})`);
  };

  const primary = async () => {
    setPending('primary');
    try {
      if (kind === 'live-session') {
        // Stop the live agent (this is the 'pan kill' the 409 demanded), then
        // re-run the original request when the caller supplied one. Without a
        // retry payload we only stop — never do more than was asked.
        const stopRes = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: await dashboardMutationJsonHeaders(),
        });
        if (!stopRes.ok) {
          const parsed = await stopRes.json().catch(() => null);
          throw new Error((parsed as { error?: string } | null)?.error || `Failed to stop ${agentId}`);
        }
        if (request.retry) {
          await postJson(request.retry.url, request.retry.body ?? {});
          toast.success(`${agentId} stopped — restarting`);
        } else {
          toast.success(`${agentId} stopped`);
        }
      } else if (kind === 'resumable') {
        await postJson(`/api/agents/${encodeURIComponent(agentId)}/resume`);
        toastResumeOutcome(agentId);
      } else if (kind === 'troubled') {
        await postJson(`/api/agents/${encodeURIComponent(agentId)}/untroubled`);
        if (await startIssue()) return;
        toast.success(issueId ? `${agentId} gate cleared — starting` : `${agentId} gate cleared`);
      } else {
        const unpauseResult = await postJson(`/api/agents/${encodeURIComponent(agentId)}/unpause`);
        if (unpauseResult?.resumeTriggered === true) {
          // The route resumed the agent itself — a follow-up start would race it.
          toast.success(`${agentId} unpaused — resuming now`);
        } else {
          if (await startIssue()) return;
          toast.success(issueId ? `${agentId} unpaused — starting` : `${agentId} unpaused`);
        }
      }
      closeRecovery();
      await refreshDashboardState(queryClient);
    } catch (err) { fail(err); }
  };

  const startFresh = async () => {
    setPending('fresh');
    try {
      await postJson(`/api/agents/${encodeURIComponent(agentId)}/reset-session`);
      if (await startIssue()) return;
      toast.success(issueId ? `${agentId} reset — fresh session starting` : `${agentId} session memory discarded`);
      closeRecovery();
      await refreshDashboardState(queryClient);
    } catch (err) { fail(err); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={closeRecovery}>
      <div
        role="dialog"
        aria-label={content.title(request)}
        data-testid="resumable-session-dialog"
        data-kind={kind}
        className="w-full max-w-md rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium"><span className="font-mono">{agentId}</span>{content.title(request).slice(agentId.length)}</h3>
          <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={closeRecovery}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{content.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            data-testid="recovery-primary"
            onClick={primary}
            disabled={!!pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {pending === 'primary' ? <Loader2 size={13} className="animate-spin" /> : kind === 'resumable' ? <Play size={13} /> : kind === 'live-session' ? <Square size={13} /> : <ShieldCheck size={13} />}
            {kind === 'live-session' && !request.retry ? 'Stop agent' : content.primary}
          </button>
          {kind === 'resumable' && (
            <button
              type="button"
              data-testid="recovery-start-fresh"
              onClick={startFresh}
              disabled={!!pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {pending === 'fresh' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Start fresh
            </button>
          )}
          <button
            type="button"
            onClick={closeRecovery}
            className="ml-auto rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        {pending && (
          // A start can take minutes when the workspace docker stack has to
          // come up first. Never trap the operator: closing only dismisses the
          // dialog — the start keeps running server-side and the tree updates
          // via SSE when the agent lands.
          <p data-testid="recovery-pending-hint" className="mt-3 text-[11px] leading-4 text-muted-foreground">
            Starting can take a few minutes when the workspace docker stack needs to come up. Closing this won&apos;t stop it.
          </p>
        )}
      </div>
    </div>
  );
}
