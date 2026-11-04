/** PAN-4641 WI-5: GET/POST/PATCH/DELETE /api/conversations/:name/scheduled-messages. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

// The usage-limit read resolves the transcript through conversation-reads, which
// pulls in every harness parser; these conversations have no transcript anyway.
vi.mock('../../../../lib/overdeck/conversation-reads.js', () => ({ resolveSessionFile: async () => null }));

let testHome: string;
let originalHome: string | undefined;

function decode(response: { body: unknown }): unknown {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return text ? JSON.parse(text) : null;
}

async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const { conversationScheduledMessagesRouteLayer } = await import('../conversation-scheduled-messages.js');
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: 'http://localhost:3011', 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationScheduledMessagesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4641-scheduled-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function seedConversation(name: string, harness: 'claude-code' | 'codex' = 'claude-code') {
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness });
}

describe('scheduled-messages routes (PAN-4641 WI-5)', () => {
  it('GET answers supported, limit and an empty queue', async () => {
    await seedConversation('conv-a');
    const response = await request('GET', '/api/conversations/conv-a/scheduled-messages');
    expect(response.status).toBe(200);
    expect(decode(response)).toEqual({ supported: true, limit: null, messages: [] });
  });

  it('GET answers 404 for an unknown conversation', async () => {
    const response = await request('GET', '/api/conversations/missing/scheduled-messages');
    expect(response.status).toBe(404);
  });

  it('POST returns 201 and GET lists the row', async () => {
    await seedConversation('conv-b');
    const created = await request('POST', '/api/conversations/conv-b/scheduled-messages', { message: 'continue please' });
    expect(created.status).toBe(201);
    expect(decode(created)).toMatchObject({ message: { text: 'continue please', status: 'pending' }, limit: null });

    const listed = await request('GET', '/api/conversations/conv-b/scheduled-messages');
    expect(decode(listed)).toMatchObject({ supported: true, messages: [{ text: 'continue please', status: 'pending' }] });
  });

  it('POST returns 422 with a code for a codex conversation', async () => {
    await seedConversation('conv-c', 'codex');
    const response = await request('POST', '/api/conversations/conv-c/scheduled-messages', { message: 'hi' });
    expect(response.status).toBe(422);
    expect(decode(response)).toMatchObject({ code: 'limit-detection-unsupported' });
  });

  it('PATCH edits a pending row and returns 409 once it is sent', async () => {
    await seedConversation('conv-d');
    const created = decode(await request('POST', '/api/conversations/conv-d/scheduled-messages', { message: 'one' })) as { message: { id: number } };
    const id = created.message.id;
    const edited = await request('PATCH', `/api/conversations/conv-d/scheduled-messages/${id}`, { message: 'two' });
    expect(edited.status).toBe(200);
    expect(decode(edited)).toMatchObject({ message: { id, text: 'two' } });

    const { claimScheduledMessage, markScheduledSent } = await import('../../../../lib/overdeck/conversation-scheduled-messages.js');
    claimScheduledMessage(id, Date.now());
    markScheduledSent(id, Date.now());
    const refused = await request('PATCH', `/api/conversations/conv-d/scheduled-messages/${id}`, { message: 'three' });
    expect(refused.status).toBe(409);
    expect(decode(refused)).toMatchObject({ code: 'not-editable' });
  });

  it('DELETE removes the row, then answers 404; a non-integer id is 404', async () => {
    await seedConversation('conv-e');
    const created = decode(await request('POST', '/api/conversations/conv-e/scheduled-messages', { message: 'bye' })) as { message: { id: number } };
    const removed = await request('DELETE', `/api/conversations/conv-e/scheduled-messages/${created.message.id}`);
    expect(removed.status).toBe(200);
    expect(decode(removed)).toEqual({ removed: true });
    const again = await request('DELETE', `/api/conversations/conv-e/scheduled-messages/${created.message.id}`);
    expect(again.status).toBe(404);
    const bogus = await request('DELETE', '/api/conversations/conv-e/scheduled-messages/abc');
    expect(bogus.status).toBe(404);
  });
});
