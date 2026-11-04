/**
 * PAN-4648 W-5: POST /hooks/:id/:secret through the real route layer — a
 * signed GitHub ping carrying the Funnel marker starts a conversation, a wrong
 * signature is refused before any door runs, a conversation trigger delivers
 * through the message door, and oversized bodies get 413. The trigger store is
 * real (temp OVERDECK_HOME); the conversation doors are faked.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../../../../src/dashboard/server/http-helpers.js';
import { triggerHooksRouteLayer } from '../../../../../src/dashboard/server/routes/trigger-hooks.js';
import { _resetTriggerRateLimitsForTests } from '../../../../../src/lib/triggers/deliver.js';
import { createTrigger } from '../../../../../src/lib/triggers/store.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  message: vi.fn(),
  read: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/routes/conversations.js', () => ({
  conversationReadDependencies: { resolveSessionFile: vi.fn(async () => null) },
}));
vi.mock('../../../../../src/lib/overdeck/conversation-runtime.js', () => ({ handleConversationCreate: mocks.create }));
vi.mock('../../../../../src/lib/overdeck/conversation-message.js', () => ({ handleConversationMessage: mocks.message }));
vi.mock('../../../../../src/lib/overdeck/conversation-reads.js', () => ({
  generateAiTitle: vi.fn(async () => undefined),
  getConversationRead: mocks.read,
}));
vi.mock('../../../../../src/lib/cloister/cpu-pressure.js', () => ({
  assessCpuPressure: vi.fn(async () => ({ saturated: false })),
}));

let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4648-hooks-'));
  process.env.OVERDECK_HOME = home;
  _resetTriggerRateLimitsForTests();
  mocks.create.mockReset().mockImplementation(async () => jsonResponse({ name: '20261101-0042', id: 42 }, { status: 201 }));
  mocks.message.mockReset().mockImplementation(async () => jsonResponse({ success: true }));
  mocks.read.mockReset().mockImplementation(async () => ({ body: { pendingInputKinds: [] } }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function post(path: string, body: Buffer | string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const init = { method: 'POST', headers, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit;
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1${path}`, init));
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(triggerHooksRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
  ));
  const raw = (response.body as { body?: Uint8Array } | null)?.body;
  return {
    status: response.status,
    headers: response.headers,
    body: JSON.parse(raw ? new TextDecoder().decode(raw) : '{}') as Record<string, unknown>,
  };
}

const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('POST /hooks/:id/:secret (PAN-4648)', () => {
  it('starts a conversation for a signed GitHub ping that came through Funnel', async () => {
    const created = await createTrigger({
      name: 'gh-ping',
      target: { kind: 'project', projectKey: 'overdeck' },
      template: 'Handle this GitHub event.',
      verify: 'github',
    });
    const body = '{"zen":"Design for failure.","hook_id":1}';
    const response = await post(created.hookPath, body, {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-github-delivery': '72d3162e-cc78-11e3-81ab-4c9367dc0958',
      'x-hub-signature-256': sign(created.generatedSigningSecret!, body),
      'tailscale-funnel-request': '?1',
    });

    expect(response).toMatchObject({ status: 202, body: { started: true, conversation: '20261101-0042', id: 42 } });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const createBody = mocks.create.mock.calls[0][0] as { message: string; projectKey: string };
    expect(createBody.projectKey).toBe('overdeck');
    expect(createBody.message).toContain('source=github event=ping');
    expect(createBody.message).toContain(body);
  });

  it('refuses a wrong signature with 401 and never calls the create door', async () => {
    const created = await createTrigger({
      name: 'gh-ping',
      target: { kind: 'project', projectKey: 'overdeck' },
      template: 'Handle this GitHub event.',
      verify: 'github',
    });
    const body = '{"zen":"Design for failure."}';
    const response = await post(created.hookPath, body, {
      'x-github-event': 'ping',
      'x-hub-signature-256': sign('not-the-secret', body),
      'tailscale-funnel-request': '?1',
    });

    expect(response).toMatchObject({ status: 401, body: { error: 'invalid signature' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('delivers to a conversation through the message door', async () => {
    const created = await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    const response = await post(created.hookPath, 'build failed');

    expect(response).toMatchObject({ status: 202, body: { delivered: true, conversation: '20261101-0007' } });
    expect(mocks.read).toHaveBeenCalledWith('20261101-0007', expect.anything());
    expect(mocks.message).toHaveBeenCalledTimes(1);
    expect(mocks.message.mock.calls[0][0]).toBe('20261101-0007');
    expect((mocks.message.mock.calls[0][1] as { message: string }).message).toMatch(/^An external webhook event/);
  });

  it('answers 503 with Retry-After when the conversation is waiting for an answer', async () => {
    mocks.read.mockImplementation(async () => ({ body: { pendingInputKinds: ['askUserQuestion'] } }));
    const created = await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    const response = await post(created.hookPath, 'build failed');

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('300');
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it('answers 404 for a wrong URL secret', async () => {
    const created = await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    const response = await post(`/hooks/${created.trigger.id}/${'0'.repeat(64)}`, 'x');
    expect(response).toMatchObject({ status: 404, body: { error: 'not found' } });
  });

  it('answers 413 for a body over 1 MiB, by Content-Length and by bytes read', async () => {
    const created = await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    const big = Buffer.alloc(1_048_577, 'a');
    expect(await post(created.hookPath, big)).toMatchObject({ status: 413, body: { error: 'event too large' } });
    expect(await post(created.hookPath, 'small', { 'content-length': '1048577' })).toMatchObject({ status: 413 });
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it('reads a multi-chunk body in full', async () => {
    const created = await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    let pulls = 0;
    const threeChunks = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 3) controller.close();
        else controller.enqueue(new TextEncoder().encode(`part${pulls};`));
      },
    });

    expect((await post(created.hookPath, threeChunks)).status).toBe(202);
    expect((mocks.message.mock.calls[0]?.[1] as { message: string }).message).toContain('\npart1;part2;part3;\n');
  });

  it('stops reading a chunked body with no Content-Length at 1 MiB and answers 413 (PAN-4648 review)', async () => {
    const created = await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 65_536;
        controller.enqueue(new Uint8Array(65_536).fill(97));
      },
    });

    const response = await post(created.hookPath, endless);
    expect(response).toMatchObject({ status: 413, body: { error: 'event too large' } });
    expect(pulled).toBeLessThan(4 * 1_048_576);
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown URL without reading the body', async () => {
    await createTrigger({ name: 'ci', target: { kind: 'conversation', conversation: '20261101-0007' } });
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const response = await post(`/hooks/trg_ffffffffffff/${'0'.repeat(64)}`, body);
    expect(response).toMatchObject({ status: 404, body: { error: 'not found' } });
    expect(pulled).toBeLessThanOrEqual(1);
  });
});
