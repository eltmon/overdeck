/**
 * Route tests for POST /api/conversations/retrospective (PAN-3841).
 *
 * Mocks the conversation write door (handleConversationCreate) and the
 * heavyweight routes/conversations.js module body (it starts a model
 * backfill at load). The retrospective handler itself runs for real, so the
 * window validation and kickoff rendering are exercised end to end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../../http-helpers.js';

const handleConversationCreate = vi.fn(
  async () => jsonResponse({ name: 'conv-x', id: 1 }, { status: 201 }),
);

vi.mock('../../../../lib/overdeck/conversation-runtime.js', () => ({
  handleConversationCreate: (...args: unknown[]) => handleConversationCreate(...args),
}));

vi.mock('../conversations.js', () => ({
  conversationReadDependencies: {},
}));

function decodeTextResponse(response: { body: unknown }): string {
  const payload = response.body as { body: Uint8Array } | null;
  return payload?.body ? new TextDecoder().decode(payload.body) : '';
}

async function postRetrospective(body: unknown, origin = 'http://localhost:3011') {
  const { conversationsRetrospectiveRouteLayer } = await import('../conversations-retrospective.js');
  const request = HttpServerRequest.fromWeb(
    new Request('http://localhost/api/conversations/retrospective', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationsRetrospectiveRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
}

describe('POST /api/conversations/retrospective', () => {
  beforeEach(() => {
    handleConversationCreate.mockClear();
  });

  it('creates the conversation for a valid window and forwards no projectKey', async () => {
    const response = await postRetrospective({ window: '7d', model: 'm' });
    expect(response.status).toBe(201);
    expect(handleConversationCreate).toHaveBeenCalledTimes(1);
    const arg = handleConversationCreate.mock.calls[0][0] as Record<string, unknown>;
    expect((arg.message as string).startsWith('Pipeline retrospective: last 7 days')).toBe(true);
    expect(arg.model).toBe('m');
    expect(arg).not.toHaveProperty('projectKey');
    expect(arg).not.toHaveProperty('issueId');
  });

  it('returns 400 for an invalid window and never touches the write door', async () => {
    const response = await postRetrospective({ window: 'bad' });
    expect(response.status).toBe(400);
    expect(JSON.parse(decodeTextResponse(response))).toEqual({ error: 'Invalid window' });
    expect(handleConversationCreate).not.toHaveBeenCalled();
  });

  it('returns 403 for a foreign Origin', async () => {
    const response = await postRetrospective({ window: '7d' }, 'https://evil.example.com');
    expect(response.status).toBe(403);
    expect(handleConversationCreate).not.toHaveBeenCalled();
  });
});
