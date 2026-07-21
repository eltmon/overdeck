/**
 * The resumable-session recovery dialog. The start route's 409 for an agent
 * with a saved session used to surface as a raw alert telling the operator to
 * run `pan resume` / `pan start --fresh` — this dialog IS that choice, as two
 * working buttons: resume with memory intact, or reset-then-start fresh.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useResumeRecovery } from '../lib/resumeRecovery';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { useAlert } from './DialogProvider';

async function postJson(url: string, body?: unknown): Promise<void> {
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
}

export function ResumableSessionDialog() {
  const request = useResumeRecovery((s) => s.request);
  const closeRecovery = useResumeRecovery((s) => s.closeRecovery);
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const [pending, setPending] = useState<'resume' | 'fresh' | null>(null);

  if (!request) return null;
  const { agentId, issueId } = request;

  const fail = (err: unknown) => {
    setPending(null);
    showAlert({ message: err instanceof Error ? err.message : 'Resume failed', variant: 'error' });
  };

  const resume = async () => {
    setPending('resume');
    try {
      await postJson(`/api/agents/${encodeURIComponent(agentId)}/resume`);
      toast.success(`${agentId} resumed`);
      closeRecovery();
      await refreshDashboardState(queryClient);
    } catch (err) { fail(err); }
  };

  const startFresh = async () => {
    setPending('fresh');
    try {
      await postJson(`/api/agents/${encodeURIComponent(agentId)}/reset-session`);
      if (issueId) {
        await postJson('/api/agents', { issueId });
        toast.success(`${agentId} reset — fresh session starting`);
      } else {
        toast.success(`${agentId} session memory discarded — next start begins fresh`);
      }
      closeRecovery();
      await refreshDashboardState(queryClient);
    } catch (err) { fail(err); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={() => !pending && closeRecovery()}>
      <div
        role="dialog"
        aria-label={`${agentId} has a saved session`}
        data-testid="resumable-session-dialog"
        className="w-full max-w-md rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium"><span className="font-mono">{agentId}</span> has a saved session</h3>
          <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={closeRecovery} disabled={!!pending}>
            <X size={16} />
          </button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Resume it to continue with its memory intact, or start fresh (for example to switch model).
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            data-testid="recovery-resume"
            onClick={resume}
            disabled={!!pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {pending === 'resume' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Resume session
          </button>
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
          <button
            type="button"
            onClick={closeRecovery}
            disabled={!!pending}
            className="ml-auto rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
