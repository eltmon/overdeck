/**
 * useMessageOutbox (PAN: resilient message delivery)
 *
 * A durable outbox for conversation messages. Owns:
 *   - localStorage persistence (per conversation) — entries survive reload.
 *   - Drain loop: POSTs `sending` entries with retry + backoff.
 *   - JSONL reconciliation: marks entries `delivered` (removed) once the server's
 *     polled user-messages contain a matching text + timestamp window.
 *   - State transitions: sending → queued → stalled (>3min unmatched) | failed (transport).
 *
 * UI contract:
 *   - `enqueue(text)` — always durable; never silently dropped.
 *   - `retry(id)` — reset a failed/stalled entry to `sending`.
 *   - `discard(id)` — remove an entry from the outbox.
 *   - `entries` — non-delivered entries, in enqueue order.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutboxStatus, ChatMessage } from '../components/chat/chat-types';

export interface OutboxEntry {
  id: string;
  text: string;
  status: OutboxStatus;
  createdAt: string;
  /** ISO — set when the server returned 2xx for this entry's POST. */
  sentAt?: string;
  /** Count of transport attempts so far (for backoff + failure threshold). */
  attempts: number;
  /** Last transport error message (populated on attempt failure). */
  lastError?: string;
}

const STORAGE_KEY_PREFIX = 'pan:outbox:v1:';
const STALLED_AFTER_MS = 3 * 60 * 1000;
const MAX_TRANSPORT_ATTEMPTS = 3;
const BACKOFF_CAP_MS = 30_000;
const BACKOFF_BASE_MS = 1000;
const RECONCILE_WINDOW_MS = 2000;

function storageKey(name: string): string {
  return STORAGE_KEY_PREFIX + name;
}

function loadOutbox(name: string): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(name));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is OutboxEntry => {
      if (!e || typeof e !== 'object') return false;
      const o = e as Record<string, unknown>;
      return typeof o.id === 'string' &&
        typeof o.text === 'string' &&
        typeof o.status === 'string' &&
        typeof o.createdAt === 'string' &&
        typeof o.attempts === 'number';
    });
  } catch {
    return [];
  }
}

function saveOutbox(name: string, entries: OutboxEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(storageKey(name));
    else localStorage.setItem(storageKey(name), JSON.stringify(entries));
  } catch {
    // localStorage quota or disabled — outbox still works in-memory for this session.
  }
}

async function postMessage(conversationName: string, message: string): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/message`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ''}`);
  }
}

export interface UseMessageOutboxArgs {
  conversationName: string;
  /** User-role messages from the polled server query; used for JSONL reconciliation. */
  serverMessages: ChatMessage[];
}

export interface UseMessageOutboxResult {
  entries: OutboxEntry[];
  enqueue: (text: string) => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
}

export function useMessageOutbox({
  conversationName,
  serverMessages,
}: UseMessageOutboxArgs): UseMessageOutboxResult {
  const [entries, setEntries] = useState<OutboxEntry[]>(() => loadOutbox(conversationName));
  const draining = useRef(false);
  // Already-matched server message ids so we don't double-match one JSONL entry to
  // multiple outbox entries with identical text (e.g. "ok", "ok").
  const matchedServerIdsRef = useRef<Set<string>>(new Set());

  // Swap outbox when conversation changes.
  useEffect(() => {
    setEntries(loadOutbox(conversationName));
    matchedServerIdsRef.current = new Set();
    draining.current = false;
  }, [conversationName]);

  // Persist entries on every change.
  useEffect(() => {
    saveOutbox(conversationName, entries);
  }, [conversationName, entries]);

  // Drain: process `sending` entries serially with retry + backoff.
  useEffect(() => {
    if (draining.current) return;
    const sending = entries.filter(e => e.status === 'sending');
    if (sending.length === 0) return;

    draining.current = true;
    const convAtStart = conversationName;
    void (async () => {
      try {
        for (const entry of sending) {
          // Bail if the user navigated to another conversation mid-drain.
          if (conversationName !== convAtStart) break;

          // Apply exponential backoff if this isn't the first attempt.
          if (entry.attempts > 0) {
            const delay = Math.min(
              BACKOFF_CAP_MS,
              BACKOFF_BASE_MS * Math.pow(2, entry.attempts - 1),
            );
            await new Promise(r => setTimeout(r, delay));
          }

          try {
            await postMessage(convAtStart, entry.text);
            setEntries(prev => prev.map(e => e.id === entry.id ? {
              ...e,
              status: 'queued' as OutboxStatus,
              sentAt: new Date().toISOString(),
              lastError: undefined,
            } : e));
          } catch (err) {
            const attempts = entry.attempts + 1;
            const failed = attempts >= MAX_TRANSPORT_ATTEMPTS;
            setEntries(prev => prev.map(e => e.id === entry.id ? {
              ...e,
              attempts,
              status: failed ? ('failed' as OutboxStatus) : ('sending' as OutboxStatus),
              lastError: err instanceof Error ? err.message : String(err),
            } : e));
            // Don't immediately loop on the same entry — let the useEffect re-fire
            // so backoff happens on the NEXT pass with the updated attempt count.
            if (!failed) break;
          }
        }
      } finally {
        draining.current = false;
      }
    })();
  }, [entries, conversationName]);

  // Reconcile queued/stalled entries against server user-messages.
  useEffect(() => {
    if (entries.length === 0) return;
    const candidates = entries.filter(e => e.status === 'queued' || e.status === 'stalled');
    if (candidates.length === 0) return;

    const matched = new Set(matchedServerIdsRef.current);
    // Prune matched ids that are no longer present in server messages — prevents
    // the set from growing unboundedly across long sessions.
    const serverIds = new Set(serverMessages.map(m => m.id));
    for (const id of matched) {
      if (!serverIds.has(id)) matched.delete(id);
    }

    const delivered = new Set<string>();
    // Match oldest outbox entries first so rapid-fire duplicates reconcile in order.
    const sorted = [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const entry of sorted) {
      const windowStart = entry.sentAt
        ? new Date(entry.sentAt).getTime() - RECONCILE_WINDOW_MS
        : 0;
      const match = serverMessages.find(m => {
        if (m.role !== 'user') return false;
        if (matched.has(m.id)) return false;
        if (m.text !== entry.text) return false;
        if (entry.sentAt && new Date(m.createdAt).getTime() < windowStart) return false;
        return true;
      });
      if (match) {
        matched.add(match.id);
        delivered.add(entry.id);
      }
    }

    if (delivered.size > 0 || matched.size !== matchedServerIdsRef.current.size) {
      matchedServerIdsRef.current = matched;
    }
    if (delivered.size > 0) {
      setEntries(prev => prev.filter(e => !delivered.has(e.id)));
    }
  }, [entries, serverMessages]);

  // Transition queued → stalled after STALLED_AFTER_MS with no reconciliation.
  useEffect(() => {
    const queued = entries.filter(e => e.status === 'queued' && e.sentAt);
    if (queued.length === 0) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const now = Date.now();
    for (const entry of queued) {
      const sentMs = new Date(entry.sentAt!).getTime();
      const elapsed = now - sentMs;
      const remaining = STALLED_AFTER_MS - elapsed;
      if (remaining <= 0) {
        setEntries(prev => prev.map(e =>
          e.id === entry.id && e.status === 'queued'
            ? { ...e, status: 'stalled' as OutboxStatus }
            : e,
        ));
      } else {
        timers.push(setTimeout(() => {
          setEntries(prev => prev.map(e =>
            e.id === entry.id && e.status === 'queued'
              ? { ...e, status: 'stalled' as OutboxStatus }
              : e,
          ));
        }, remaining + 50));
      }
    }

    return () => { for (const t of timers) clearTimeout(t); };
  }, [entries]);

  // On first mount: any entry persisted as `sending` with a sentAt is a crash
  // survivor (POST succeeded, page died before state flipped). Treat as queued.
  // Dedup guard: never re-POST an entry that already has sentAt.
  useEffect(() => {
    setEntries(prev => {
      let changed = false;
      const next = prev.map(e => {
        if (e.status === 'sending' && e.sentAt) {
          changed = true;
          return { ...e, status: 'queued' as OutboxStatus };
        }
        return e;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enqueue = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry: OutboxEntry = {
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      text: trimmed,
      status: 'sending',
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    setEntries(prev => [...prev, entry]);
  }, []);

  const retry = useCallback((id: string) => {
    setEntries(prev => prev.map(e => e.id === id ? {
      ...e,
      status: 'sending' as OutboxStatus,
      attempts: 0,
      lastError: undefined,
    } : e));
  }, []);

  const discard = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  return { entries, enqueue, retry, discard };
}
