/**
 * Client for the needs-you push routes (PAN-2354): the VAPID public key, push
 * status, subscribing and removing devices, and a test send.
 */
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';

export type PushEventKind = 'question' | 'approval' | 'finished' | 'failed';

/** Mirrors `PushStatus` in src/dashboard/server/services/needs-you-push-service.ts. */
export interface PushStatus {
  enabled: boolean;
  events: PushEventKind[];
  includePreview: boolean;
  webpush: {
    subscriptions: Array<{
      id: string;
      label: string;
      host: string;
      createdAt: string;
      lastSuccessAt: string | null;
      failureCount: number;
      thisDevice: boolean;
    }>;
  };
  ntfy: { state: 'off' | 'misconfigured' | 'ready'; reason?: string; host?: string; topicHint?: string };
  native: { phones: number; directoryOnline: boolean };
  stats: { sent: number; dropped: number; rateLimited: number; lastError: string | null };
}

export type ProviderSendOutcome =
  | { target: string; ok: true }
  | { target: string; ok: false; reason: string; status?: number; detail?: string };

export const PUSH_STATUS_QUERY_KEY = ['push-status'] as const;

async function errorFrom(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`);
}

export async function loadPushStatus(): Promise<PushStatus> {
  const response = await fetch('/api/push/status');
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as PushStatus;
}

export async function loadVapidPublicKey(): Promise<string> {
  const response = await fetch('/api/push/vapid-public-key');
  if (!response.ok) throw await errorFrom(response);
  return ((await response.json()) as { publicKey: string }).publicKey;
}

export async function savePushSubscription(subscription: PushSubscriptionJSON, label: string): Promise<{ id: string }> {
  const response = await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ subscription, label }),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as { id: string };
}

export async function deletePushSubscription(id: string): Promise<void> {
  const response = await fetch(`/api/push/subscriptions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  });
  if (!response.ok) throw await errorFrom(response);
}

export async function sendTestPush(): Promise<ProviderSendOutcome[]> {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await errorFrom(response);
  return ((await response.json()) as { outcomes: ProviderSendOutcome[] }).outcomes;
}

/** Decode a base64url VAPID key into the bytes `pushManager.subscribe` expects. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Mirrors `PushHistoryView` in src/dashboard/server/services/needs-you-push-service.ts (PAN-5111). */
export interface PushHistoryEntry {
  id: string;
  ts: string;
  kind: string;
  category: string;
  key: string;
  subject: string | null;
  title: string;
  issueId: string | null;
  url: string;
  deliveries: Array<{ provider: string; target: string; ok: boolean; reason?: string; status?: number }>;
  resolution: { outcome: 'answered' | 'resolved-without-answer'; ts: string } | null;
  state: 'open' | 'answered' | 'resolved-without-answer' | null;
}

export const PUSH_HISTORY_QUERY_KEY = ['push-history'] as const;

export async function loadPushHistory(): Promise<PushHistoryEntry[]> {
  const response = await fetch('/api/push/history');
  if (!response.ok) throw await errorFrom(response);
  return ((await response.json()) as { entries: PushHistoryEntry[] }).entries;
}
