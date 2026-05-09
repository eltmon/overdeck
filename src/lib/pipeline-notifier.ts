/**
 * Pipeline Notifier — event bridge between library code and Socket.io
 *
 * Lightweight singleton that decouples state mutations (review-status, specialist queue)
 * from the dashboard's Socket.io server. Library code calls notifyPipeline() which is
 * fire-and-forget — when an in-process handler is registered (the dashboard server),
 * the handler is invoked synchronously. Otherwise the call is forwarded to the
 * dashboard via a best-effort HTTP POST so CLI-process state changes (e.g.
 * `pan review run`) still propagate to the live WebSocket event stream (PAN-891).
 *
 * File-based persistence (SQLite) remains the source of truth — the HTTP forward
 * is purely to wake the dashboard so it re-emits the domain event. If the
 * dashboard is offline the call silently fails; the next dashboard read will
 * pick up the latest DB state via `enrichReviewStatusFromSessions()`.
 */

import type { ReviewStatus } from './review-status.js';
import { getInternalToken, INTERNAL_TOKEN_HEADER } from './internal-token.js';

export type PipelineEvent =
  | { type: 'status_changed'; issueId: string; status: ReviewStatus }
  | { type: 'task_queued'; specialist: string; issueId: string }
  | { type: 'reviewer_started'; issueId: string; role: string; sessionName: string }
  | { type: 'reviewer_completed'; issueId: string; role: string }
  | { type: 'reviewer_timed_out'; issueId: string; role: string; sessionName: string; attempt: number; maxRetries: number; willRetry: boolean }
  | { type: 'coordinator_started'; issueId: string; sessionName: string }
  | { type: 'coordinator_died'; issueId: string; sessionName: string; reason: string };

type Handler = (event: PipelineEvent) => void;
let handler: Handler | null = null;

export function setPipelineHandler(fn: Handler): void {
  handler = fn;
}

export function notifyPipeline(event: PipelineEvent): void {
  if (handler) {
    try {
      handler(event);
    } catch (e) {
      console.error('[pipeline] handler error:', e);
    }
    return;
  }

  // No in-process handler — we are not the dashboard server (typically a CLI
  // process such as `pan review run`). Forward to the dashboard so the live
  // event stream stays in sync. Best-effort: fail silently if the dashboard
  // is offline. The DB write (when applicable) is durable.
  // Tests can opt out with `PANOPTICON_PIPELINE_NOTIFY=off`.
  if (process.env.PANOPTICON_PIPELINE_NOTIFY === 'off') return;
  // Skip in test environments — Vitest/Jest set NODE_ENV=test and there's no
  // dashboard at localhost:3011 to receive the POST.
  if (process.env.NODE_ENV === 'test') return;

  // Resolve shared secret (PAN-891). If the dashboard hasn't started in this
  // home (no token file, no env), skip the forward — DB write is durable.
  const token = getInternalToken();
  if (!token) return;

  // PAN-915 — forward the full event. status_changed intentionally omits the
  // `status` field because the server re-reads from SQLite to avoid stale
  // snapshots; other types carry their own payload.
  const body = event.type === 'status_changed'
    ? { type: 'status_changed', issueId: event.issueId }
    : event;

  const baseUrl = process.env.DASHBOARD_URL || 'http://localhost:3011';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1000);
  void fetch(`${baseUrl}/api/internal/pipeline/notify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_TOKEN_HEADER]: token,
    },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  })
    .catch(() => {
      // Dashboard down or unreachable — DB write already persisted, frontend
      // will pick up latest state on next reconnect/snapshot.
    })
    .finally(() => clearTimeout(timer));
}
