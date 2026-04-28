/**
 * Webhook route module — Effect HttpRouter.Layer (PAN-905)
 *
 * POST /api/webhooks/github
 *   Receives GitHub webhook events via smee.io relay.
 *   Verifies X-Hub-Signature-256 HMAC-SHA256 signature.
 *   Dispatches to per-event-type handlers.
 */

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getGitHubConfig } from '../services/tracker-config.js';
import {
  handleCheckSuite,
  handleCheckRun,
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewThread,
  handleStatus,
  type WebhookPayload,
} from '../../../lib/webhook-handlers.js';

const WEBHOOK_SECRET_PATH = join(homedir(), '.panopticon', 'github-app', 'webhook-secret');

// ─── Async secret loading at module init (never blocks request handlers) ─────

let _cachedWebhookSecret: string | null | undefined;

async function loadWebhookSecret(): Promise<void> {
  try {
    if (!existsSync(WEBHOOK_SECRET_PATH)) {
      _cachedWebhookSecret = null;
      return;
    }
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(WEBHOOK_SECRET_PATH, 'utf-8');
    _cachedWebhookSecret = content.trim() || null;
  } catch {
    _cachedWebhookSecret = null;
  }
}

const _secretLoadPromise = loadWebhookSecret();

function getWebhookSecret(): string | null | undefined {
  return _cachedWebhookSecret;
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf-8').digest('hex')}`;
  try {
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

function dispatchWebhook(eventType: string, payload: WebhookPayload): void {
  try {
    switch (eventType) {
      case 'check_suite':
        handleCheckSuite(payload);
        break;
      case 'check_run':
        handleCheckRun(payload);
        break;
      case 'pull_request':
        handlePullRequest(payload);
        break;
      case 'pull_request_review':
        handlePullRequestReview(payload);
        break;
      case 'pull_request_review_thread':
        handlePullRequestReviewThread(payload);
        break;
      case 'status':
        handleStatus(payload);
        break;
      default:
        // Unknown events are silently accepted (GitHub expects 200)
        break;
    }
  } catch (err) {
    console.error(`[webhook] ${eventType} handler failed:`, err);
  }
}

const postGitHubWebhookRoute = HttpRouter.add(
  'POST',
  '/api/webhooks/github',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.text;
    const headers = request.headers;

    const eventType = headers['x-github-event'];
    const signature = headers['x-hub-signature-256'];

    if (!eventType || typeof eventType !== 'string') {
      return jsonResponse({ error: 'Missing X-GitHub-Event header' }, { status: 400 });
    }

    // Fail closed: require a configured webhook secret
    let secret = getWebhookSecret();
    if (secret === undefined) {
      // Still loading — wait for init to complete
      yield* Effect.promise(() => _secretLoadPromise);
      secret = getWebhookSecret();
    }
    if (!secret) {
      console.warn('[webhook] No webhook secret configured — rejecting event');
      return jsonResponse({ error: 'Webhook secret not configured' }, { status: 401 });
    }

    if (!signature || typeof signature !== 'string') {
      return jsonResponse({ error: 'Missing X-Hub-Signature-256 header' }, { status: 400 });
    }
    if (!verifySignature(body, signature, secret)) {
      console.warn('[webhook] Invalid HMAC signature — rejecting');
      return jsonResponse({ error: 'Invalid signature' }, { status: 401 });
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body) as WebhookPayload;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Repository authorization: reject events from unconfigured repos
    const ghConfig = getGitHubConfig();
    const allowedRepos = new Set(
      ghConfig?.repos.map((r) => `${r.owner}/${r.repo}`) ?? [],
    );
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName || !allowedRepos.has(repoFullName)) {
      console.warn(`[webhook] Repository not allowed: ${repoFullName ?? 'unknown'}`);
      return jsonResponse({ error: 'Repository not allowed' }, { status: 403 });
    }

    // Dispatch handlers in the background so sync DB work doesn't block
    // the HTTP response or the Node event loop.
    yield* Effect.fork(
      Effect.sync(() => dispatchWebhook(eventType, payload)),
    );

    console.log(`[webhook] Received ${eventType} event from ${repoFullName}`);
    return jsonResponse({ received: true, event: eventType });
  })),
);

export const webhooksRouteLayer = postGitHubWebhookRoute;
