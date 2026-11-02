/** PAN-4639 WI-2: POST /api/conversations/triage. PAN-4653: GET/POST /api/conversations/auto-settle-on-merge. PAN-4655 WI-4: GET/PUT /api/conversations/triage/auto-settle. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

let testHome: string;
let originalHome: string | undefined;

function decode(response: { body: unknown }): unknown {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return text ? JSON.parse(text) : null;
}

async function request(path: string, body?: unknown, headers: Record<string, string> = {}, method: 'GET' | 'POST' | 'PUT' = 'POST') {
  const { conversationTriageRouteLayer } = await import('../conversation-triage.js');
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: 'http://localhost:3011', 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationTriageRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4639-triage-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function seedConversation(name: string, opts: { origin?: 'local' | 'vault' } = {}) {
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness: 'claude-code' });
  if (opts.origin === 'vault') {
    const { getOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
    getOverdeckDatabase().prepare("UPDATE conversations SET origin = 'vault' WHERE name = ?").run(name);
  }
}

describe('POST /api/conversations/triage (PAN-4639 WI-2)', () => {
  it('settles a conversation and the state reads back from the store', async () => {
    await seedConversation('conv-a');
    const response = await request('/api/conversations/triage', { updates: [{ name: 'conv-a', settled: true }] });
    expect(response.status).toBe(200);
    expect(decode(response)).toMatchObject({
      conversations: [{ name: 'conv-a', settleReason: 'manual' }],
      notFound: [],
      rejected: [],
    });

    const { getConversationTriage } = await import('../../../../lib/overdeck/conversation-triage-store.js');
    expect(getConversationTriage('conv-a')?.settledAt).not.toBeNull();
  });

  it('applies a bulk update of three names in one request', async () => {
    await seedConversation('conv-b1');
    await seedConversation('conv-b2');
    await seedConversation('conv-b3');
    const response = await request('/api/conversations/triage', {
      updates: [
        { name: 'conv-b1', settled: true },
        { name: 'conv-b2', settled: true },
        { name: 'conv-b3', settled: true },
      ],
    });
    expect(response.status).toBe(200);
    const payload = decode(response) as { conversations: unknown[] };
    expect(payload.conversations).toHaveLength(3);
  });

  it('sets only the auto-settle override (PAN-4653) and leaves settle and snooze unchanged', async () => {
    await seedConversation('conv-o');
    const response = await request('/api/conversations/triage', { updates: [{ name: 'conv-o', autoSettleOverride: 'off' }] });
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({
      conversations: [{ name: 'conv-o', settledAt: null, settleReason: null, snoozedUntil: null, autoSettleOverride: 'off' }],
      notFound: [],
      rejected: [],
    });

    const { getConversationTriage } = await import('../../../../lib/overdeck/conversation-triage-store.js');
    expect(getConversationTriage('conv-o')).toEqual({
      settledAt: null,
      settleReason: null,
      snoozedUntil: null,
      autoSettleOverride: 'off',
    });
  });

  it('reports an unknown name in notFound', async () => {
    const response = await request('/api/conversations/triage', { updates: [{ name: 'no-such-conv', settled: true }] });
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ conversations: [], notFound: ['no-such-conv'], rejected: [] });
  });

  it('reports a vault browse row in rejected and does not write it', async () => {
    await seedConversation('conv-vault', { origin: 'vault' });
    const response = await request('/api/conversations/triage', { updates: [{ name: 'conv-vault', settled: true }] });
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ conversations: [], notFound: [], rejected: [{ name: 'conv-vault', reason: 'vault-browse-row' }] });

    const { getConversationTriage } = await import('../../../../lib/overdeck/conversation-triage-store.js');
    expect(getConversationTriage('conv-vault')?.settledAt).toBeNull();
  });

  it('400s on a malformed body', async () => {
    const response = await request('/api/conversations/triage', { updates: [] });
    expect(response.status).toBe(400);
    expect(decode(response)).toHaveProperty('error');
  });

  it('403s without an origin or referer header', async () => {
    const { conversationTriageRouteLayer } = await import('../conversation-triage.js');
    const req = HttpServerRequest.fromWeb(
      new Request('http://localhost/api/conversations/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ name: 'conv-a', settled: true }] }),
      }),
    );
    const response = await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(HttpRouter.toHttpEffect(conversationTriageRouteLayer), (app) =>
          Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
        ),
      ),
    );
    expect(response.status).toBe(403);
  });
});

describe('GET/POST /api/conversations/auto-settle-on-merge (PAN-4653 WI-4)', () => {
  const PATH = '/api/conversations/auto-settle-on-merge';

  it('GET reports enabled when the setting is unset', async () => {
    const response = await request(PATH, undefined, {}, 'GET');
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ enabled: true });
  });

  it('POST { enabled: false } stores it and the next GET agrees', async () => {
    const response = await request(PATH, { enabled: false });
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ enabled: false });

    const next = await request(PATH, undefined, {}, 'GET');
    expect(decode(next)).toEqual({ enabled: false });
  });

  it('POST 400s when enabled is not a boolean', async () => {
    const response = await request(PATH, { enabled: 'no' });
    expect(response.status).toBe(400);
    expect(decode(response)).toEqual({ error: 'enabled must be a boolean' });
  });

  it('POST 403s on a failing origin', async () => {
    const response = await request(PATH, { enabled: false }, { Origin: 'https://evil.example' });
    expect(response.status).toBe(403);

    const { isConversationsAutoSettleOnMerge } = await import('../../../../lib/overdeck/control-settings.js');
    expect(isConversationsAutoSettleOnMerge()).toBe(true);
  });
});

describe('GET/PUT /api/conversations/triage/auto-settle (PAN-4655 WI-4)', () => {
  const path = '/api/conversations/triage/auto-settle';

  it('GET returns the default of 3 days on a fresh database', async () => {
    const response = await request(path, undefined, {}, 'GET');
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ idleDays: 3 });
  });

  it('PUT stores a valid value and GET reads it back', async () => {
    const put = await request(path, { idleDays: 5 }, {}, 'PUT');
    expect(put.status).toBe(200);
    expect(decode(put)).toEqual({ idleDays: 5 });

    const get = await request(path, undefined, {}, 'GET');
    expect(decode(get)).toEqual({ idleDays: 5 });
  });

  it.each([[{ idleDays: -1 }], [{ idleDays: 1.5 }], [{ idleDays: 'abc' }], [{ idleDays: 366 }], [{}]])(
    'PUT 400s on %j and stores nothing',
    async (body) => {
      const response = await request(path, body, {}, 'PUT');
      expect(response.status).toBe(400);
      expect(decode(response)).toEqual({ error: 'idleDays must be a whole number from 0 to 365' });

      const get = await request(path, undefined, {}, 'GET');
      expect(decode(get)).toEqual({ idleDays: 3 });
    },
  );

  it('PUT 403s from a foreign origin', async () => {
    const response = await request(path, { idleDays: 5 }, { Origin: 'https://evil.example' }, 'PUT');
    expect(response.status).toBe(403);
  });
});
