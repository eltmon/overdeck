/** PAN-4639 WI-2: POST /api/conversations/triage. */
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

async function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const { conversationTriageRouteLayer } = await import('../conversation-triage.js');
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method: 'POST',
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
