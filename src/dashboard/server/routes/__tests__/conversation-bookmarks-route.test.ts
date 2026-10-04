/** PAN-4498 WI-2: GET/PUT/DELETE /api/conversations/:name/bookmarks. */
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

async function request(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  const { conversationBookmarksRouteLayer } = await import('../conversation-bookmarks.js');
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: 'http://localhost:3011', 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationBookmarksRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4498-bookmarks-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function seedConversation(name: string) {
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness: 'claude-code' });
}

describe('bookmark routes (PAN-4498 WI-2)', () => {
  it('GET returns [] then the saved bookmark', async () => {
    await seedConversation('conv-a');
    const before = await request('GET', '/api/conversations/conv-a/bookmarks');
    expect(before.status).toBe(200);
    expect(decode(before)).toEqual({ bookmarks: [] });

    await request('PUT', '/api/conversations/conv-a/bookmarks/msg-1', { label: 'First' });
    const after = await request('GET', '/api/conversations/conv-a/bookmarks');
    expect(decode(after)).toMatchObject({ bookmarks: [{ messageId: 'msg-1', label: 'First' }] });
  });

  it('PUT creates and a second PUT renames', async () => {
    await seedConversation('conv-b');
    const first = await request('PUT', '/api/conversations/conv-b/bookmarks/msg-1', { label: 'First' });
    expect(first.status).toBe(200);
    expect(decode(first)).toMatchObject({ bookmark: { messageId: 'msg-1', label: 'First' } });

    const second = await request('PUT', '/api/conversations/conv-b/bookmarks/msg-1', { label: 'Renamed' });
    expect(second.status).toBe(200);
    expect(decode(second)).toMatchObject({ bookmark: { messageId: 'msg-1', label: 'Renamed' } });
  });

  it('PUT 400 on empty label', async () => {
    await seedConversation('conv-c');
    const response = await request('PUT', '/api/conversations/conv-c/bookmarks/msg-1', { label: '   ' });
    expect(response.status).toBe(400);
    expect(decode(response)).toEqual({ error: 'label is required' });
  });

  it('PUT 400 on optimistic- id', async () => {
    await seedConversation('conv-d');
    const response = await request('PUT', '/api/conversations/conv-d/bookmarks/optimistic-123', { label: 'ok' });
    expect(response.status).toBe(400);
    expect(decode(response)).toEqual({ error: 'optimistic messages cannot be bookmarked' });
  });

  it('PUT 409 at the limit', async () => {
    await seedConversation('conv-e');
    const { upsertConversationBookmark, MAX_BOOKMARKS_PER_CONVERSATION } = await import('../../../../lib/overdeck/conversation-bookmarks.js');
    for (let i = 0; i < MAX_BOOKMARKS_PER_CONVERSATION; i++) {
      upsertConversationBookmark('conv-e', { messageId: `msg-${i}`, label: `Label ${i}`, messageCreatedAt: null });
    }
    const response = await request('PUT', '/api/conversations/conv-e/bookmarks/msg-overflow', { label: 'Overflow' });
    expect(response.status).toBe(409);
    expect(decode(response)).toEqual({ error: 'Bookmark limit reached (500)' });
  });

  it('DELETE returns removed true then false', async () => {
    await seedConversation('conv-f');
    await request('PUT', '/api/conversations/conv-f/bookmarks/msg-1', { label: 'Label' });
    const first = await request('DELETE', '/api/conversations/conv-f/bookmarks/msg-1');
    expect(decode(first)).toEqual({ removed: true });
    const second = await request('DELETE', '/api/conversations/conv-f/bookmarks/msg-1');
    expect(decode(second)).toEqual({ removed: false });
  });

  it('all three return 404 for an unknown conversation', async () => {
    const get = await request('GET', '/api/conversations/no-such-conv/bookmarks');
    expect(get.status).toBe(404);
    const put = await request('PUT', '/api/conversations/no-such-conv/bookmarks/msg-1', { label: 'ok' });
    expect(put.status).toBe(404);
    const del = await request('DELETE', '/api/conversations/no-such-conv/bookmarks/msg-1');
    expect(del.status).toBe(404);
  });

  it("a message id containing '/' round-trips when URL-encoded", async () => {
    await seedConversation('conv-g');
    const encoded = encodeURIComponent('harness/msg-1');
    const put = await request('PUT', `/api/conversations/conv-g/bookmarks/${encoded}`, { label: 'Slashy' });
    expect(put.status).toBe(200);
    expect(decode(put)).toMatchObject({ bookmark: { messageId: 'harness/msg-1' } });

    const get = await request('GET', '/api/conversations/conv-g/bookmarks');
    expect(decode(get)).toMatchObject({ bookmarks: [{ messageId: 'harness/msg-1' }] });

    const del = await request('DELETE', `/api/conversations/conv-g/bookmarks/${encoded}`);
    expect(decode(del)).toEqual({ removed: true });
  });
});
