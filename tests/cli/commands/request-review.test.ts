/**
 * PAN-3917 (W12): `requestReviewViaDashboard` is the one CLI door to
 * `POST /api/review/:issueId/request`. `pan review request` prints its result
 * and `pan done` calls it as its last step, so both reach the review pipeline
 * through the same request. A dashboard that never answers is `unreachable` —
 * Node's fetch rejects with `TypeError('fetch failed')` and keeps the socket
 * error on `.cause`, so the caller cannot read `error.code` directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { requestReviewViaDashboard } from '../../../src/cli/commands/request-review.js';

const originalFetch = globalThis.fetch;

describe('requestReviewViaDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts the message to the review-request route and returns the accepted body', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ queued: true, message: 'Verification started for PAN-3705' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    globalThis.fetch = fetchMock as never;

    const result = await requestReviewViaDashboard('PAN-3705', 'work complete');

    expect(result.kind).toBe('ok');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/review/PAN-3705/request');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'work complete' });
    if (result.kind === 'ok') {
      expect(result.result.message).toContain('Verification started');
    }
  });

  it('a refusal is rejected, not unreachable — the body carries the reason', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'Workspace has uncommitted changes' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )) as never;

    const result = await requestReviewViaDashboard('PAN-3705');

    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.status).toBe(400);
      expect(result.result.error).toBe('Workspace has uncommitted changes');
    }
  });

  it('a connection failure is unreachable, with the cause code', async () => {
    const failure = new TypeError('fetch failed');
    (failure as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    globalThis.fetch = (async () => { throw failure; }) as never;

    const result = await requestReviewViaDashboard('PAN-3705');

    expect(result).toEqual({ kind: 'unreachable', error: 'ECONNREFUSED' });
  });

  it('a body-less response is still a verdict', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 202 })) as never;

    const result = await requestReviewViaDashboard('PAN-3705');

    expect(result.kind).toBe('ok');
  });
});
