import type { ClaudeChannelPermissionBehavior } from '@overdeck/contracts';
import type { ConfirmationRequest } from '../components/ConfirmationDialog';
import type { ConversationPaletteOpenRequest } from '../components/CommandPalette';

export interface TrackerStatusItem {
  type: string;
  name: string;
  hasKey: boolean;
  envVar: string;
  isPrimary: boolean;
}

export interface TrackerStatus {
  primary: string;
  secondary?: string;
  configured: TrackerStatusItem[];
}

interface ConversationMessageLocator {
  messageId: string;
  messageIndex: number;
  sequence: number;
  byteOffset: number;
}

export interface CliproxyStatus {
  running: boolean;
  pid: number | null;
  checkedAt: string;
}

// Cached supervisor URL — populated by successful /api/version polls.
// Used as a final fallback for Force Restart when the dashboard is dead.
let cachedSupervisorUrl: string | null = null;

export function getCachedSupervisorUrl(): string | null {
  return cachedSupervisorUrl;
}

export async function fetchBackendHealth(): Promise<{ version: string }> {
  const res = await fetch('/api/version');
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  const data = await res.json();
  if (data.supervisorUrl) cachedSupervisorUrl = data.supervisorUrl;
  return data;
}

export async function fetchConversationMessageLocator(name: string, byteOffset: number): Promise<ConversationMessageLocator> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(name)}/message-locator?byteOffset=${byteOffset}`);
  if (!res.ok) throw new Error(`Unable to locate matching message (${res.status})`);
  return res.json();
}

export function describeConversationHitOpenFailure(hit: ConversationPaletteOpenRequest, err: unknown): string {
  const reason = err instanceof Error ? err.message : 'Unable to open conversation hit';
  const details = [
    hit.sourceLabel,
    hit.conversationId === hit.sessionId ? 'no dashboard conversation row' : null,
    hit.projectId ? `project ${hit.projectId}` : null,
  ].filter(Boolean).join(' · ');
  return details ? `${reason}. ${details}` : reason;
}

export async function fetchTrackerStatus(): Promise<TrackerStatus> {
  const res = await fetch('/api/tracker-status');
  if (!res.ok) throw new Error('Failed to fetch tracker status');
  return res.json();
}

export async function fetchConfirmations(): Promise<ConfirmationRequest[]> {
  const res = await fetch('/api/confirmations');
  if (!res.ok) throw new Error('Failed to fetch confirmations');
  return res.json();
}

export async function respondToConfirmation(id: string, confirmed: boolean): Promise<void> {
  const res = await fetch(`/api/confirmations/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed }),
  });
  if (!res.ok) throw new Error('Failed to respond to confirmation');
}

export async function respondToChannelPermission(
  agentId: string,
  requestId: string,
  behavior: ClaudeChannelPermissionBehavior,
): Promise<void> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/permissions/${encodeURIComponent(requestId)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ behavior }),
  });
  if (res.ok) return;
  let message = `Failed to respond to permission request (${res.status})`;
  try {
    const body = await res.json() as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Ignore invalid JSON bodies and fall back to the generic message.
  }
  throw new Error(message);
}

export async function fetchCliproxyStatus(): Promise<CliproxyStatus> {
  const res = await fetch('/api/cliproxy/status');
  if (!res.ok) throw new Error('Failed to fetch CLIProxy status');
  return res.json();
}

export async function restartCliproxy(): Promise<void> {
  const res = await fetch('/api/cliproxy/restart', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to restart CLIProxy');
}
