/**
 * Tests for webhooks route (PAN-905)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  handleCheckSuite,
  handleCheckRun,
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewThread,
  handleStatus,
  isTrackedRepositorySync,
} from '../../../../src/lib/webhook-handlers.js';
import { runWebhookHandler, verifySignature, _resetWebhookSecretForTests } from '../../../../src/dashboard/server/routes/webhooks.ts';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../../../src/lib/webhook-handlers.js', () => ({
  handleCheckSuite: vi.fn(),
  handleCheckRun: vi.fn(),
  handlePullRequest: vi.fn(),
  handlePullRequestReview: vi.fn(),
  handlePullRequestReviewThread: vi.fn(),
  handleStatus: vi.fn(),
  isTrackedRepository: vi.fn(() => true),
}));

const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
const mockIsTrackedRepository = isTrackedRepositorySync as unknown as ReturnType<typeof vi.fn>;

describe('verifySignature', () => {
  it('returns true for a valid HMAC-SHA256 signature', () => {
    const secret = 'my-secret';
    const body = '{"action":"opened"}';
    const { createHmac } = require('node:crypto');
    const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf-8').digest('hex')}`;

    expect(verifySignature(body, expected, secret)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    expect(verifySignature('body', 'sha256=invalid', 'secret')).toBe(false);
  });

  it('returns false when lengths differ', () => {
    expect(verifySignature('body', 'short', 'secret')).toBe(false);
  });
});

describe('runWebhookHandler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PANOPTICON_DEV_WEBHOOKS;
    vi.clearAllMocks();
    _resetWebhookSecretForTests();
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue('test-webhook-secret');
    mockIsTrackedRepository.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 200 with received:true for a valid request', async () => {
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });
    const { createHmac } = await import('node:crypto');
    const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(body, 'utf-8').digest('hex')}`;

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    }));

    expect(response.status).toBe(200);
  });

  it('returns 401 for an invalid HMAC signature', async () => {
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': 'sha256=invalidsignature12345678901234567890123456789012345678901234',
    }));

    expect(response.status).toBe(401);
  });

  it('returns 400 when X-Hub-Signature-256 is missing and secret is set', async () => {
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
    }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when X-GitHub-Event header is missing', async () => {
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-hub-signature-256': 'sha256=abc',
    }));

    expect(response.status).toBe(400);
  });

  it('returns 403 for an untracked repository', async () => {
    mockIsTrackedRepository.mockReturnValue(false);
    const body = JSON.stringify({ repository: { full_name: 'evil-owner/evil-repo' } });
    const { createHmac } = await import('node:crypto');
    const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(body, 'utf-8').digest('hex')}`;

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    }));

    expect(response.status).toBe(403);
  });

  it('returns 503 when no secret is configured and dev mode is off', async () => {
    mockExistsSync.mockReturnValue(false);
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
    }));

    expect(response.status).toBe(503);
  });

  it('passes through when no secret is configured but PANOPTICON_DEV_WEBHOOKS=1', async () => {
    mockExistsSync.mockReturnValue(false);
    process.env.PANOPTICON_DEV_WEBHOOKS = '1';
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
    }));

    expect(response.status).toBe(200);
  });

  it('returns 200 for unknown event types (GitHub expects 200)', async () => {
    const body = JSON.stringify({ repository: { full_name: 'test-owner/test-repo' } });
    const { createHmac } = await import('node:crypto');
    const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(body, 'utf-8').digest('hex')}`;

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'ping',
      'x-hub-signature-256': signature,
    }));

    expect(response.status).toBe(200);
  });

  it('returns 400 for invalid JSON body', async () => {
    const body = 'not valid json';
    const { createHmac } = await import('node:crypto');
    const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(body, 'utf-8').digest('hex')}`;

    const response = await Effect.runPromise(runWebhookHandler(body, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': signature,
    }));

    expect(response.status).toBe(400);
  });
});
