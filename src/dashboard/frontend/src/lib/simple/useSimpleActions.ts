/**
 * PAN-2908 · C-SIMPLE — the simple-mode action handlers.
 *
 * Thin wrappers over the EXISTING endpoints (no new server routes). Every
 * mutation refreshes the dashboard state on success and surfaces errors via
 * the global alert dialog. Advanced actions (stop/wipe/reset…) deliberately
 * do not exist here — they live in Advanced mode only.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { refreshDashboardState } from '../refresh-dashboard-state';
import { useAlert } from '../../components/DialogProvider';
import { recoveryFromBody, useResumeRecovery } from '../resumeRecovery';

async function postJson(url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    // Same recovery path as the registry actions: a 409 with a resumable
    // lifecycle opens the Resume / Start fresh dialog, not an alert.
    const recovery = res.status === 409 ? recoveryFromBody(parsed) : null;
    if (recovery) {
      const issueId = typeof body === 'object' && body !== null && 'issueId' in body ? String((body as { issueId: unknown }).issueId) : undefined;
      useResumeRecovery.getState().openRecovery({ ...recovery, issueId });
      return { recovery: true };
    }
    let message = `Request failed (${res.status})`;
    try {
      const data = JSON.parse(text);
      message = data.error || message;
    } catch {
      if (text.length < 200) message = text;
    }
    throw new Error(message);
  }
  return res.json().catch(() => ({}));
}

export function useSimpleActions() {
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const onError = (err: Error) => showAlert({ message: err.message, variant: 'error' });
  const onSuccess = async () => {
    await refreshDashboardState(queryClient);
  };

  const tell = useMutation({
    mutationFn: ({ agentId, message }: { agentId: string; message: string }) =>
      postJson(`/api/agents/${encodeURIComponent(agentId)}/tell`, { message }),
    onSuccess,
    onError,
  });

  const answer = useMutation({
    mutationFn: ({ agentId, text, isConversation }: { agentId: string; text: string; isConversation?: boolean }) => {
      if (isConversation) {
        return postJson(`/api/conversations/${encodeURIComponent(agentId)}/message`, { message: text });
      }
      return postJson(`/api/agents/${encodeURIComponent(agentId)}/answer-question`, { answers: [text] });
    },
    onSuccess,
    onError,
  });

  const recover = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      postJson(`/api/agents/${encodeURIComponent(agentId)}/recover`),
    onSuccess,
    onError,
  });

  const unpause = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      postJson(`/api/agents/${encodeURIComponent(agentId)}/unpause`, {}),
    onSuccess,
    onError,
  });

  const untroubled = useMutation({
    mutationFn: ({ agentId }: { agentId: string }) =>
      postJson(`/api/agents/${encodeURIComponent(agentId)}/untroubled`, {}),
    onSuccess,
    onError,
  });

  // PAN-3073: clears the persistent review-status stuck flag. Agent recovery
  // (above) cannot touch it — a review-stuck issue needs this door.
  const unstick = useMutation({
    mutationFn: ({ issueId }: { issueId: string }) =>
      postJson(`/api/workspaces/${encodeURIComponent(issueId)}/unstick`),
    onSuccess,
    onError,
  });

  const merge = useMutation({
    mutationFn: ({ issueId }: { issueId: string }) =>
      postJson(`/api/issues/${encodeURIComponent(issueId)}/merge`),
    onSuccess,
    onError,
  });

  const startWork = useMutation({
    mutationFn: ({ issueId }: { issueId: string }) =>
      postJson(`/api/agents`, { issueId }),
    onSuccess,
    onError,
  });

  const startPlanning = useMutation({
    mutationFn: ({ issueId }: { issueId: string }) =>
      postJson(`/api/issues/${encodeURIComponent(issueId)}/start-planning`),
    onSuccess,
    onError,
  });

  return { tell, answer, recover, unpause, untroubled, unstick, merge, startWork, startPlanning };
}
