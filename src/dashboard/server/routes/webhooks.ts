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
import { readFileSync, existsSync } from 'node:fs';
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
  type WebhookPayload,
} from '../../../lib/webhook-handlers.js';

const WEBHOOK_SECRET_PATH = join(homedir(), '.panopticon', 'github-app', 'webhook-secret');

let webhookSecret: string | null | undefined;
function getWebhookSecret(): string | null {
  if (webhookSecret !== undefined) return webhookSecret;
  try {
    if (!existsSync(WEBHOOK_SECRET_PATH)) { webhookSecret = null; return null; }
    webhookSecret = readFileSync(WEBHOOK_SECRET_PATH, 'utf-8').trim();
    return webhookSecret;
  } catch { webhookSecret = null; return null; }
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

    const secret = getWebhookSecret();
    if (secret) {
      if (!signature || typeof signature !== 'string') {
        return jsonResponse({ error: 'Missing X-Hub-Signature-256 header' }, { status: 400 });
      }
      if (!verifySignature(body, signature, secret)) {
        console.warn('[webhook] Invalid HMAC signature — rejecting');
        return jsonResponse({ error: 'Invalid signature' }, { status: 401 });
      }
    } else {
      console.warn('[webhook] No webhook secret configured — skipping signature verification');
    }

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(body) as WebhookPayload;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Dispatch to event-specific handlers
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
        // Commit status updates — handled by check_suite/check_run for now
        break;
      default:
        // Unknown events are silently accepted (GitHub expects 200)
        break;
    }

    console.log(`[webhook] Received ${eventType} event`);
    return jsonResponse({ received: true, event: eventType });
  })),
);

export const webhooksRouteLayer = postGitHubWebhookRoute;
