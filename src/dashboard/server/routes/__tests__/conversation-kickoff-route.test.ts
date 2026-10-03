/**
 * PAN-4499 WI-5: the kickoff door — GET/POST /api/conversations/:name/kickoff.
 * The fork pipeline's delivery (ensureForkSessionReady, deliverForkSeed) is
 * mocked; the held-kickoff store is real.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

const forkMocks = vi.hoisted(() => ({
  ensureForkSessionReady: vi.fn(async () => {}),
  deliverForkSeed: vi.fn(async () => {}),
}));

vi.mock('../../../../lib/overdeck/conversation-forks.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/conversation-forks.js')>()),
  ensureForkSessionReady: forkMocks.ensureForkSessionReady,
  deliverForkSeed: forkMocks.deliverForkSeed,
}));

let testHome: string;
let originalHome: string | undefined;

function decode(response: { body: unknown }): unknown {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return text ? JSON.parse(text) : null;
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown) {
  const { conversationKickoffRouteLayer } = await import('../conversation-kickoff.js');
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: 'http://localhost:3011', 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationKickoffRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4499-kickoff-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  forkMocks.ensureForkSessionReady.mockReset().mockResolvedValue(undefined);
  forkMocks.deliverForkSeed.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  const { waitForInFlightForkPipelines } = await import('../../../../lib/overdeck/conversation-forks.js');
  await waitForInFlightForkPipelines(0);
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function seedHeld(name: string, text: string) {
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  const { holdKickoff } = await import('../../../../lib/overdeck/conversation-kickoff-store.js');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, claudeSessionId: `${name}-session`, harness: 'claude-code' });
  holdKickoff(name, text);
}

describe('kickoff door routes (PAN-4499 WI-5)', () => {
  it('GET answers held true with the text, then held false after start', async () => {
    await seedHeld('conv-a', 'do the thing');
    const before = await request('GET', '/api/conversations/conv-a/kickoff');
    expect(before.status).toBe(200);
    expect(decode(before)).toEqual({ held: true, text: 'do the thing' });

    const started = await request('POST', '/api/conversations/conv-a/kickoff', {});
    expect(started.status).toBe(200);
    const { waitForInFlightForkPipelines } = await import('../../../../lib/overdeck/conversation-forks.js');
    await waitForInFlightForkPipelines(0);

    const after = await request('GET', '/api/conversations/conv-a/kickoff');
    expect(decode(after)).toEqual({ held: false });
  });

  it('POST delivers the held kickoff exactly once and answers 409 the second time', async () => {
    await seedHeld('conv-b', 'do the thing');
    const first = await request('POST', '/api/conversations/conv-b/kickoff', {});
    expect(first.status).toBe(200);
    const { waitForInFlightForkPipelines } = await import('../../../../lib/overdeck/conversation-forks.js');
    await waitForInFlightForkPipelines(0);
    expect(forkMocks.deliverForkSeed).toHaveBeenCalledTimes(1);
    expect(forkMocks.deliverForkSeed.mock.calls[0]?.[1]).toBe('do the thing');

    const second = await request('POST', '/api/conversations/conv-b/kickoff', {});
    expect(second.status).toBe(409);
    expect(decode(second)).toMatchObject({ error: expect.stringContaining('No held kickoff') });
    expect(forkMocks.deliverForkSeed).toHaveBeenCalledTimes(1);
  });

  it('POST with edited text delivers the edited text', async () => {
    await seedHeld('conv-c', 'original text');
    const response = await request('POST', '/api/conversations/conv-c/kickoff', { text: 'edited text' });
    expect(response.status).toBe(200);
    const { waitForInFlightForkPipelines } = await import('../../../../lib/overdeck/conversation-forks.js');
    await waitForInFlightForkPipelines(0);
    expect(forkMocks.deliverForkSeed.mock.calls[0]?.[1]).toBe('edited text');
  });

  it('POST on a never-held conversation answers 409 and delivers nothing', async () => {
    const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
    createConversation({ name: 'conv-d', tmuxSession: 'conv-conv-d', cwd: testHome, claudeSessionId: 'conv-d-session', harness: 'claude-code' });
    const response = await request('POST', '/api/conversations/conv-d/kickoff', {});
    expect(response.status).toBe(409);
    expect(forkMocks.deliverForkSeed).not.toHaveBeenCalled();
  });

  it('a failed session start restores the hold and marks forkStatus failed', async () => {
    await seedHeld('conv-e', 'do the thing');
    forkMocks.ensureForkSessionReady.mockRejectedValue(new Error('session boom'));
    const response = await request('POST', '/api/conversations/conv-e/kickoff', {});
    expect(response.status).toBe(200);
    const { waitForInFlightForkPipelines } = await import('../../../../lib/overdeck/conversation-forks.js');
    await waitForInFlightForkPipelines(0);

    const { readHeldKickoff } = await import('../../../../lib/overdeck/conversation-kickoff-store.js');
    expect(readHeldKickoff('conv-e')).toBe('do the thing');
    expect(forkMocks.deliverForkSeed).not.toHaveBeenCalled();
    const { getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
    expect(getConversationByName('conv-e')?.forkStatus).toBe('failed');
  });
});
