import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from './internal-token.js';

export type PipelineEvent =
  | { type: 'review.approved'; issueId: string }
  | { type: 'test.passed'; issueId: string }
  | { type: 'task_queued'; specialist: string; issueId: string }
  | { type: 'reviewer_started'; issueId: string; role: string; sessionName: string }
  | { type: 'reviewer_completed'; issueId: string; role: string }
  | { type: 'reviewer_timed_out'; issueId: string; role: string; sessionName: string; attempt: number; maxRetries: number; willRetry: boolean }
  | { type: 'coordinator_started'; issueId: string; sessionName: string }
  | { type: 'coordinator_died'; issueId: string; sessionName: string; reason: string }
  // The append-only per-issue pipeline journal (see cloister/pipeline-journal.ts).
  // Plain JSON, so the HTTP forward below carries it verbatim from a CLI
  // process. The entry is typed structurally rather than imported: the journal
  // module imports THIS one, and an import back would close a cycle.
  | {
    type: 'pipeline.entry';
    issueId: string;
    entry: { at: string; type: string; issueId: string; source?: string; data?: Record<string, unknown> };
  };

type Handler = (event: PipelineEvent) => void;
let handler: Handler | null = null;

export function setPipelineHandlerSync(fn: Handler): void {
  handler = fn;
}

export function notifyPipelineSync(event: PipelineEvent): void {
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
  // Tests can opt out with `OVERDECK_PIPELINE_NOTIFY=off`.
  if (process.env.OVERDECK_PIPELINE_NOTIFY === 'off') return;
  // Skip in test environments — Vitest/Jest set NODE_ENV=test and there's no
  // dashboard at localhost:3011 to receive the POST.
  if (process.env.NODE_ENV === 'test') return;

  // Resolve shared secret (PAN-891). If the dashboard hasn't started in this
  // home (no token file, no env), skip the forward — DB write is durable.
  const token = getInternalTokenSync();
  if (!token) return;

  // PAN-915 — forward the full event; each type carries its own payload.
  const body = event;

  const baseUrl = process.env.OVERDECK_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011';
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
