/**
 * Pipeline Notifier — event bridge between library code and Socket.io
 *
 * Lightweight singleton that decouples state mutations (review-status, specialist queue)
 * from the dashboard's Socket.io server. Library code calls notifyPipeline() which is
 * fire-and-forget — if no handler is registered (CLI context), events are silently dropped.
 * File-based persistence remains the source of truth.
 */

import type { ReviewStatus } from './review-status.js';

export type PipelineEvent =
  | { type: 'status_changed'; issueId: string; status: ReviewStatus }
  | { type: 'task_queued'; specialist: string; issueId: string };

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
  }
}
