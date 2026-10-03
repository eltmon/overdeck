/**
 * Requests behind the new-conversation options dialog (PAN-4486): the default
 * effort with its source, the create payload, and the create POST.
 */
import type { EffortSource } from '@overdeck/contracts';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

export interface EffortDefault {
  effort: string;
  source: EffortSource;
  requested: string;
  clamped: boolean;
  warning?: string;
}

export async function fetchEffortDefault(input: { model: string; harness: string; issueId?: string | null }): Promise<EffortDefault> {
  const params = new URLSearchParams({ model: input.model, harness: input.harness });
  if (input.issueId) params.set('issue', input.issueId);
  const res = await fetch(`/api/effort/default?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<EffortDefault>;
}

export interface NewConversationFormState {
  projectKey: string | null;
  /** The selected project's path; the cwd is sent only when it differs. */
  projectPath: string | null;
  cwd: string;
  model: string;
  harness: string;
  /** Null when the model supports no effort (D5). */
  effort: string | null;
  bareContext: boolean;
  skipClaudeMd: boolean;
  skillOverrides: Record<string, boolean>;
  issueId: string | null;
  message: string;
}

/** The POST /api/conversations body for the dialog's choices (FR-4, D5). */
export function buildNewConversationPayload(state: NewConversationFormState): Record<string, unknown> {
  const payload: Record<string, unknown> = { model: state.model, harness: state.harness };
  if (state.projectKey) payload.projectKey = state.projectKey;
  const cwd = state.cwd.trim();
  if (state.projectKey && cwd && cwd !== state.projectPath) payload.cwd = cwd;
  if (state.effort) payload.effort = state.effort;
  if (state.bareContext) payload.bareContext = true;
  if (state.skipClaudeMd && state.harness === 'claude-code') payload.skipClaudeMd = true;
  if (Object.keys(state.skillOverrides).length > 0) payload.skillOverrides = state.skillOverrides;
  if (state.issueId) payload.issueId = state.issueId;
  const message = state.message.trim();
  if (message) payload.message = message;
  return payload;
}

export async function createConversationWithOptions(payload: Record<string, unknown>): Promise<{ id: number; name: string }> {
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({})) as { id?: number; name?: string; error?: string };
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as { id: number; name: string };
}
