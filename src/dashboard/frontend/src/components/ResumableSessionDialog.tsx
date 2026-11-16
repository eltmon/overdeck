/**
 * Start-block recovery dialog. The start route's 409s (resumable session,
 * paused gate) used to surface as raw alerts telling the
 * operator to run `pan resume` / `pan unpause` — this
 * dialog IS those choices, as working buttons.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, RotateCcw, ShieldCheck, Square } from 'lucide-react';
import { toast } from 'sonner';
import { useResumeRecovery, recoveryFromBody, type RecoveryRequest } from '../lib/resumeRecovery';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { toastResumeOutcome } from '../lib/resumeOutcome';
import { useAlert } from './DialogProvider';
import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

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
    <Modal
      title={content.title(request)}
      size="narrow"
      onClose={closeRecovery}
      footer={
        <>
          <button type="button" onClick={closeRecovery} className={formStyles.button}>
            Cancel
          </button>
          {kind === 'resumable' && (
            <button
              type="button"
              data-testid="recovery-start-fresh"
              onClick={startFresh}
              disabled={!!pending}
              className={formStyles.button}
            >
              {pending === 'fresh' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Start fresh
            </button>
          )}
          <button
            type="button"
            data-testid="recovery-primary"
            onClick={primary}
            disabled={!!pending}
            className={formStyles.primaryButton}
          >
            {pending === 'primary' ? <Loader2 size={13} className="animate-spin" /> : kind === 'resumable' ? <Play size={13} /> : kind === 'live-session' ? <Square size={13} /> : <ShieldCheck size={13} />}
            {kind === 'live-session' && !request.retry ? 'Stop agent' : content.primary}
          </button>
        </>
      }
    >
      <div data-testid="resumable-session-dialog" data-kind={kind} className={`${formStyles.content} space-y-3`}>
        <p className={formStyles.text}>{content.body}</p>
        {pending && (
          // A start can take minutes when the workspace docker stack has to
          // come up first. Never trap the operator: closing only dismisses the
          // dialog — the start keeps running server-side and the tree updates
          // via SSE when the agent lands.
          <p data-testid="recovery-pending-hint" className={formStyles.hint}>
            Starting can take a few minutes when the workspace docker stack needs to come up. Closing this won&apos;t stop it.
          </p>
        )}
      </div>
    </Modal>
  );
}
