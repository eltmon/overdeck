/**
 * POST /api/internal/pipeline/notify — the cross-process bridge for
 * `notifyPipeline()`.
 *
 * Lived in merge-ops.ts by accident of history and has nothing to do with
 * merging; extracted here so the merge god file shrinks and this route reads
 * on its own (same shape as internal-strike-merge.ts).
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { readJsonBody } from '../workspaces.js';

// ─── Route: POST /api/internal/pipeline/notify ────────────────────────────────
//
// Cross-process bridge for `notifyPipeline()` (PAN-891, expanded in PAN-915).
//
// `notifyPipeline` is an in-process handler registry; only the dashboard server
// registers a handler. CLI processes (e.g. `pan review run`) write to shared
// state and call `notifyPipeline()`, which is a no-op in their own process.
// This endpoint lets them poke the dashboard so it re-emits the corresponding
// domain event into the live event stream.
//
// Accepted bodies (PAN-915):
//   { type: 'status_changed', issueId }
//     — GONE (PAN-3917): it broadcast a review-status record change. Returns 410.
//   { type: 'review.approved', issueId }
//   { type: 'test.passed', issueId }
//   { type: 'task_queued', specialist, issueId }
//   { type: 'reviewer_started', issueId, role, sessionName }
//   { type: 'reviewer_completed', issueId, role }
//   { type: 'reviewer_timed_out', issueId, role, sessionName, attempt, maxRetries, willRetry }
//   { type: 'coordinator_started', issueId, sessionName }
//   { type: 'coordinator_died', issueId, sessionName, reason }
//   { type: 'pipeline.entry', issueId, entry }
//     — Forwarded verbatim to the in-process handler.

export const postInternalPipelineNotifyRoute = HttpRouter.add(
  'POST',
  '/api/internal/pipeline/notify',
  httpHandler(Effect.gen(function* () {
    // Shared-secret check (PAN-891 review feedback). The dashboard binds 0.0.0.0
    // by default, so this stateful endpoint must be unreachable without the
    // server-issued token. Same token is read by CLI senders via getInternalToken().
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalTokenSync } = yield* Effect.promise(() =>
      import('../../../../lib/internal-token.js'),
    );
    const expected = getInternalTokenSync();
    if (!expected) {
      return jsonResponse({ ok: false, error: 'internal token not configured' }, 503);
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const raw = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided || provided !== expected) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403);
    }

    const body = yield* readJsonBody;
    const event = body as Record<string, unknown>;
    const type = event.type as string | undefined;

    const { notifyPipelineSync } = yield* Effect.promise(() =>
      import('../../../../lib/pipeline-notifier.js'),
    );

    switch (type) {
      // PAN-3917: `status_changed` broadcast a review-status record change.
      // There is no record to change; the pipeline reads derived state instead.
      case 'status_changed':
        return jsonResponse({ ok: false, error: 'status_changed is gone: issue state is derived, not stored' }, 410);
      // The append-only pipeline journal. A CLI process (a reviewer running
      // `pan admin specialists done`) appends locally and forwards here so the
      // dashboard projects the entry into its live event stream.
      case 'pipeline.entry': {
        const issueId = event.issueId as string | undefined;
        const entry = event.entry as Record<string, unknown> | undefined;
        if (!issueId || !entry || typeof entry.type !== 'string' || typeof entry.at !== 'string') {
          return jsonResponse({ ok: false, error: 'pipeline.entry requires issueId and a stamped entry' }, 400);
        }
        notifyPipelineSync({ type: 'pipeline.entry', issueId, entry: entry as never });
        return jsonResponse({ ok: true });
      }
      case 'review.approved':
      case 'test.passed': {
        const issueId = event.issueId as string | undefined;
        if (!issueId) {
          return jsonResponse({ ok: false, error: `${type} requires issueId` }, 400);
        }
        // PAN-1988: this MUST be notifyPipelineSync (the imported function). The bare
        // `notifyPipeline` (the Effect variant) is not imported here, so it threw
        // "notifyPipeline is not defined" and silently dropped EVERY forwarded review.approved /
        // test.passed event — breaking the reactive review→test and test→ship handoffs for any
        // CLI-originated verdict. The in-process dashboard handler routes these to reactive Cloister.
        notifyPipelineSync({ type, issueId });
        return jsonResponse({ ok: true });
      }
      case 'task_queued': {
        const issueId = event.issueId as string | undefined;
        const specialist = event.specialist as string | undefined;
        if (!issueId || !specialist) {
          return jsonResponse({ ok: false, error: 'task_queued requires issueId and specialist' }, 400);
        }
        notifyPipelineSync({ type: 'task_queued', specialist, issueId });
        return jsonResponse({ ok: true });
      }
      case 'reviewer_started': {
        const issueId = event.issueId as string | undefined;
        const role = event.role as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        if (!issueId || !role || !sessionName) {
          return jsonResponse({ ok: false, error: 'reviewer_started requires issueId, role, sessionName' }, 400);
        }
        notifyPipelineSync({ type: 'reviewer_started', issueId, role, sessionName });
        return jsonResponse({ ok: true });
      }
      case 'reviewer_completed': {
        const issueId = event.issueId as string | undefined;
        const role = event.role as string | undefined;
        if (!issueId || !role) {
          return jsonResponse({ ok: false, error: 'reviewer_completed requires issueId, role' }, 400);
        }
        notifyPipelineSync({ type: 'reviewer_completed', issueId, role });
        return jsonResponse({ ok: true });
      }
      case 'reviewer_timed_out': {
        const issueId = event.issueId as string | undefined;
        const role = event.role as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        const attempt = typeof event.attempt === 'number' ? event.attempt : undefined;
        const maxRetries = typeof event.maxRetries === 'number' ? event.maxRetries : undefined;
        const willRetry = typeof event.willRetry === 'boolean' ? event.willRetry : undefined;
        if (!issueId || !role || !sessionName || attempt === undefined || maxRetries === undefined || willRetry === undefined) {
          return jsonResponse({ ok: false, error: 'reviewer_timed_out requires issueId, role, sessionName, attempt, maxRetries, willRetry' }, 400);
        }
        notifyPipelineSync({ type: 'reviewer_timed_out', issueId, role, sessionName, attempt, maxRetries, willRetry });
        return jsonResponse({ ok: true });
      }
      case 'coordinator_started': {
        const issueId = event.issueId as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        if (!issueId || !sessionName) {
          return jsonResponse({ ok: false, error: 'coordinator_started requires issueId, sessionName' }, 400);
        }
        notifyPipelineSync({ type: 'coordinator_started', issueId, sessionName });
        return jsonResponse({ ok: true });
      }
      case 'coordinator_died': {
        const issueId = event.issueId as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        const reason = event.reason as string | undefined;
        if (!issueId || !sessionName || !reason) {
          return jsonResponse({ ok: false, error: 'coordinator_died requires issueId, sessionName, reason' }, 400);
        }
        notifyPipelineSync({ type: 'coordinator_died', issueId, sessionName, reason });
        return jsonResponse({ ok: true });
      }
      default:
        return jsonResponse({ ok: false, error: `unknown pipeline event type: ${type}` }, 400);
    }
  })),
);
