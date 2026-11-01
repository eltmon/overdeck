/**
 * PAN-4641 WI-11: the client side of scheduled messages — operator messages
 * the server holds until a conversation's usage limit resets.
 *
 * Plain fetch + polling (not react-query's useQuery): six test files mount
 * `ComposerFooter` with no `QueryClientProvider` ancestor, and an
 * unconditional `useQuery` call there would break every one (see
 * heldKickoff.tsx). One module-level store keyed by conversation name holds
 * the latest answer; every mounted, enabled subscriber shares one 15 s poller
 * per conversation, so the composer and the timeline rows never fetch twice.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { fetchWithTimeout } from '../../lib/apiFetch';
import type { ChatMessage, ConversationLimitState, ScheduledMessage } from './chat-types';

export type { ConversationLimitState, ScheduledMessage, ScheduledMessageStatus } from './chat-types';

export interface ScheduledMessagesSnapshot {
  supported: boolean;
  limit: ConversationLimitState | null;
  messages: ScheduledMessage[];
}

export interface ScheduledMessagesApi extends ScheduledMessagesSnapshot {
  schedule: (text: string) => Promise<void>;
  edit: (id: number, text: string) => Promise<void>;
  cancel: (id: number) => Promise<void>;
}

export const SCHEDULED_POLL_MS = 15_000;

const EMPTY: ScheduledMessagesSnapshot = { supported: false, limit: null, messages: [] };

const snapshots = new Map<string, ScheduledMessagesSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const pollers = new Map<string, { count: number; timer: ReturnType<typeof setInterval> }>();

function basePath(name: string): string {
  return `/api/conversations/${encodeURIComponent(name)}/scheduled-messages`;
}

/** The empty answer on a non-OK response, a non-JSON body or a rejected fetch. */
async function fetchScheduledMessages(name: string): Promise<ScheduledMessagesSnapshot> {
  try {
    const res = await fetchWithTimeout(basePath(name));
    if (!res.ok) return EMPTY;
    // .clone() so reading this body never consumes a Response another fetch
    // consumer (e.g. a test's blanket fetch mock) still needs to read.
    const body = (await res.clone().json()) as Partial<ScheduledMessagesSnapshot>;
    return {
      supported: body.supported === true,
      limit: body.limit ?? null,
      messages: Array.isArray(body.messages) ? body.messages : [],
    };
  } catch {
    return EMPTY;
  }
}

function notify(name: string): void {
  for (const listener of listeners.get(name) ?? []) listener();
}

/** Re-fetches one conversation's queue and wakes every subscriber. */
export async function refreshScheduledMessages(name: string): Promise<void> {
  snapshots.set(name, await fetchScheduledMessages(name));
  notify(name);
}

function retainPoller(name: string): void {
  const existing = pollers.get(name);
  if (existing) {
    existing.count += 1;
    return;
  }
  const timer = setInterval(() => { void refreshScheduledMessages(name); }, SCHEDULED_POLL_MS);
  pollers.set(name, { count: 1, timer });
  void refreshScheduledMessages(name);
}

function releasePoller(name: string): void {
  const existing = pollers.get(name);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  clearInterval(existing.timer);
  pollers.delete(name);
}

async function mutate(name: string, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<void> {
  const res = await fetchWithTimeout(`${basePath(name)}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    let error: string | null = null;
    try {
      const parsed = (await res.clone().json()) as { error?: unknown };
      if (typeof parsed.error === 'string') error = parsed.error;
    } catch {
      // Non-JSON error body: fall back to the status.
    }
    throw new Error(error ?? `Request failed (${res.status})`);
  }
  await refreshScheduledMessages(name);
}

/** A conversation's scheduled messages; no request at all while `enabled` is false. */
export function useScheduledMessages(conversationName: string, enabled: boolean): ScheduledMessagesApi {
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled) return () => {};
    let set = listeners.get(conversationName);
    if (!set) {
      set = new Set();
      listeners.set(conversationName, set);
    }
    set.add(listener);
    retainPoller(conversationName);
    return () => {
      set.delete(listener);
      releasePoller(conversationName);
    };
  }, [conversationName, enabled]);
  const snapshot = useSyncExternalStore(subscribe, () => (enabled ? snapshots.get(conversationName) ?? EMPTY : EMPTY));
  const schedule = useCallback((text: string) => mutate(conversationName, 'POST', '', { message: text }), [conversationName]);
  const edit = useCallback((id: number, text: string) => mutate(conversationName, 'PATCH', `/${id}`, { message: text }), [conversationName]);
  const cancel = useCallback((id: number) => mutate(conversationName, 'DELETE', `/${id}`), [conversationName]);
  return { ...snapshot, schedule, edit, cancel };
}

function clockLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (at.toDateString() === now.toDateString()) return time;
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** How a limit window reads in a sentence: `5-hour limit`, `weekly limit`, else `usage limit`. */
export function limitWindowLabel(window: string | null): string {
  if (window === 'five_hour') return '5-hour limit';
  if (window === 'seven_day') return 'weekly limit';
  return 'usage limit';
}

/** The timestamp line under a scheduled bubble. */
export function scheduledSendLabel(message: ScheduledMessage, now: Date): string {
  if (message.status === 'failed') return `Not sent: ${message.lastError ?? 'unknown error'}`;
  if (message.status === 'unknown') return 'Delivery not confirmed';
  if (message.status === 'sending') return 'Sending…';
  if (message.resetSource === null) return 'Sends within a minute';
  if (message.resetSource === 'fallback') return `Tries again at about ${clockLabel(message.notBefore, now)} (reset time unknown)`;
  return `Sends at about ${clockLabel(message.notBefore, now)} (when your ${limitWindowLabel(message.limitWindow)} resets)`;
}

/** Undelivered rows as dimmed user bubbles for the end of the timeline. */
export function scheduledToChatMessages(messages: ReadonlyArray<ScheduledMessage>): ChatMessage[] {
  return messages.map((message) => ({
    id: `scheduled-${message.id}`,
    role: 'user',
    text: message.text,
    createdAt: message.createdAt,
    deliveryState: 'scheduled',
    scheduled: message,
  }));
}
