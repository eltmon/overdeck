/**
 * PAN-2354: /api/push/* routes. Subscriptions are validated against the push
 * service allowlist, and status responses never carry a full endpoint,
 * subscription keys or the ntfy token.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPushConfig, type NormalizedPushConfig } from '../../../../lib/config-yaml/push-config.js';

let pushConfig: NormalizedPushConfig = defaultPushConfig();
vi.mock('../../../../lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigSync: () => {
      const loaded = actual.loadConfigSync();
      return { ...loaded, config: { ...loaded.config, push: pushConfig } };
    },
  };
});

const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests } = await import('../dashboard-auth.js');
const { pushRouteLayer } = await import('../push.js');

const INTERNAL_TOKEN = 'push-routes-internal-token-0123';
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_DASHBOARD_SESSION_TOKEN', 'API_PORT'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

async function call(method: string, path: string, body?: unknown) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(pushRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, headers: raw.headers, text, json: text ? JSON.parse(text) : null };
}

function subscriberKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-2354-push-routes-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'push-routes-session-token-0123';
  process.env.API_PORT = '3999';
  pushConfig = defaultPushConfig();
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  await rm(home, { recursive: true, force: true });
});

describe('/api/push routes (PAN-2354)', () => {
  it('rejects a subscription to a disallowed endpoint', async () => {
    const res = await call('POST', '/api/push/subscriptions', {
      subscription: { endpoint: 'https://evil.example/push', keys: subscriberKeys() },
    });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'endpoint-not-allowed' });
  });

  it('stores a valid subscription and reports only its host', async () => {
    const keys = subscriberKeys();
    const endpoint = 'https://fcm.googleapis.com/fcm/send/secret-endpoint-id';
    const created = await call('POST', '/api/push/subscriptions', { subscription: { endpoint, keys }, label: 'Android' });
    expect(created.status).toBe(201);
    expect(created.json).toEqual({ id: expect.stringMatching(/^[0-9a-f]{16}$/) });

    const status = await call('GET', '/api/push/status');
    expect(status.status).toBe(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.json.webpush.subscriptions).toEqual([expect.objectContaining({
      id: created.json.id,
      label: 'Android',
      host: 'fcm.googleapis.com',
      thisDevice: false,
    })]);
    expect(status.text).not.toContain('secret-endpoint-id');
    expect(status.text).not.toContain(keys.p256dh);
    expect(status.text).not.toContain(keys.auth);
  });

  it('returns 404 when deleting an unknown subscription', async () => {
    const res = await call('DELETE', '/api/push/subscriptions/0123456789abcdef');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'not-found' });
  });

  it('never returns the ntfy token or the full topic', async () => {
    pushConfig = {
      ...defaultPushConfig(),
      ntfy: { state: 'ready', url: 'https://ntfy.example.net', topic: 'deck-k3J9xQ2mV7pL4sTa', token: 'tk_supersecret', clickBaseUrl: null },
    };
    const status = await call('GET', '/api/push/status');
    expect(status.json.ntfy).toEqual({ state: 'ready', host: 'ntfy.example.net', topicHint: 'deck…' });
    expect(status.text).not.toContain('tk_supersecret');
    expect(status.text).not.toContain('k3J9xQ2mV7pL4sTa');
  });

  it('serves the VAPID public key', async () => {
    const res = await call('GET', '/api/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(Buffer.from(res.json.publicKey, 'base64url')).toHaveLength(65);
  });
});
