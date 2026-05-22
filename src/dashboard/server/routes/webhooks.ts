/**
 * Webhook route module — Effect HttpRouter.Layer (PAN-905)
 *
 * POST /api/webhooks/github
 *   Receives GitHub webhook events via smee.io relay.
 *   Verifies X-Hub-Signature-256 HMAC-SHA256 signature.
 *   Dispatches to per-event-type handlers.
 */

import { Effect, Exit, Fiber, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  handleCheckSuite,
  handleCheckRun,
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewThread,
  handleStatus,
  isTrackedRepositorySync,
  type WebhookPayload,
} from '../../../lib/webhook-handlers.js';

const WEBHOOK_SECRET_PATH = join(homedir(), '.panopticon', 'github-app', 'webhook-secret');

// ─── Lazy async secret loading (defers to first request so tests can mock fs) ─

let _cachedWebhookSecret: string | null | undefined = undefined;
let _secretLoadPromise: Promise<void> | null = null;

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

function ensureSecretLoaded(): Promise<void> {
  if (!_secretLoadPromise) {
    _secretLoadPromise = loadWebhookSecret();
  }
  return _secretLoadPromise;
}

function getWebhookSecret(): string | null | undefined {
  return _cachedWebhookSecret;
}

/** Reset secret cache — called by tests between cases. */
export function _resetWebhookSecretForTests(): void {
  _cachedWebhookSecret = undefined;
  _secretLoadPromise = null;
}

export function verifySignature(body: string, signature: string, secret: string): boolean {
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

async function dispatchWebhook(eventType: string, payload: WebhookPayload): Promise<void> {
  switch (eventType) {
    case 'check_suite':
      await Effect.runPromise(handleCheckSuite(payload));
      break;
    case 'check_run':
      await Effect.runPromise(handleCheckRun(payload));
      break;
    case 'pull_request':
      await Effect.runPromise(handlePullRequest(payload));
      break;
    case 'pull_request_review':
      await Effect.runPromise(handlePullRequestReview(payload));
      break;
    case 'pull_request_review_thread':
      await Effect.runPromise(handlePullRequestReviewThread(payload));
      break;
    case 'status':
      await Effect.runPromise(handleStatus(payload));
      break;
    default:
      // Unknown events are silently accepted (GitHub expects 200)
      break;
  }
}

/**
 * Core webhook handler logic — extracted for testability.
 * Takes the raw body and headers directly so tests don't need to mock
 * Effect's HttpServerRequest service.
 */
export function runWebhookHandler(
  body: string,
  headers: Record<string, string | string[] | undefined>,
): Effect.Effect<ReturnType<typeof jsonResponse>, never, never> {
  return httpHandler(Effect.gen(function* () {
    const eventType = headers['x-github-event'];
    const signature = headers['x-hub-signature-256'];

    if (!eventType || typeof eventType !== 'string') {
      return jsonResponse({ error: 'Missing X-GitHub-Event header' }, { status: 400 });
    }

    // Load secret on first request (lazy so tests can mock fs before import)
    let secret = getWebhookSecret();
    if (secret === undefined) {
      yield* Effect.promise(() => ensureSecretLoaded());
      secret = getWebhookSecret();
    }

    if (secret) {
      // Production mode: verify HMAC signature
      if (!signature || typeof signature !== 'string') {
        return jsonResponse({ error: 'Missing X-Hub-Signature-256 header' }, { status: 400 });
      }
      if (!verifySignature(body, signature, secret)) {
        console.warn('[webhook] Invalid HMAC signature — rejecting');
        return jsonResponse({ error: 'Invalid signature' }, { status: 401 });
      }
    } else if (process.env.PANOPTICON_DEV_WEBHOOKS === '1') {
      console.warn('[webhook] PANOPTICON_DEV_WEBHOOKS=1 — skipping HMAC verification (dev mode)');
    } else {
      return jsonResponse(
        { error: 'Webhook secret not configured. Run pan auth github to set up.' },
        { status: 503 },
      );
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body) as WebhookPayload;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Repository authorization: reject events from unconfigured repos
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName || !isTrackedRepositorySync(repoFullName)) {
      console.warn(`[webhook] Repository not allowed: ${repoFullName ?? 'unknown'}`);
      return jsonResponse({ error: 'Repository not allowed' }, { status: 403 });
    }

    // Dispatch handlers asynchronously so DB work (deferred via setImmediate)
    // does not block the HTTP response or the Node event loop.
    const fiber = yield* Effect.forkChild(
      Effect.promise(() => dispatchWebhook(eventType, payload)),
    );
    yield* Effect.forkChild(
      Effect.gen(function* () {
        const exit = yield* Fiber.await(fiber);
        if (Exit.isFailure(exit)) {
          console.error(`[webhook] Forked dispatch failed for ${eventType}:`, exit.cause);
        }
      }),
    );

    console.log(`[webhook] Received ${eventType} event from ${repoFullName}`);
    return jsonResponse({ received: true, event: eventType });
  }));
}

const postGitHubWebhookRoute = HttpRouter.add(
  'POST',
  '/api/webhooks/github',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.text;
    const headers = request.headers;
    return yield* runWebhookHandler(body, headers);
  })),
);

export const webhooksRouteLayer = postGitHubWebhookRoute;
