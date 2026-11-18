/**
 * PAN-5516: `pan conversations resume` posts with the internal token and no
 * Origin, and names the conversation by numeric id, stored name or `conv-`
 * session name. The route must admit that request and hand the handler the
 * stored name; a POST with no credential and no Origin is still refused.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resumeMock } = vi.hoisted(() => ({ resumeMock: vi.fn() }));

vi.mock('../../../../lib/overdeck/conversation-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/conversation-runtime.js')>()),
  handleConversationResume: resumeMock,
}));

const { jsonResponse } = await import('../../http-helpers.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../../lib/internal-token.js');
const { _resetTrustedOriginsForTests } = await import('../origin-validation.js');
const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
const { createConversation, getConversationByName } = await import('../../../../lib/overdeck/conversations.js');
const { conversationsRouteLayer } = await import('../conversations.js');

const INTERNAL_TOKEN = 'resume-route-internal-token-0123456789';
const NAME = '20261117-32dc';
const ENV_KEYS = ['OVERDECK_HOME', 'OVERDECK_INTERNAL_TOKEN', 'OVERDECK_TRUSTED_ORIGINS'] as const;
let savedEnv: Record<string, string | undefined>;
let home: string;

async function postResume(key: string, headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1:3011/api/conversations/${encodeURIComponent(key)}/resume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(conversationsRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

const CLI = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(join(tmpdir(), 'pan-5516-resume-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetTrustedOriginsForTests();
  closeOverdeckDatabase();
  createConversation({ name: NAME, tmuxSession: `conv-${NAME}`, cwd: home, harness: 'claude-code' });
  resumeMock.mockReset();
  resumeMock.mockImplementation(async (name: string) => jsonResponse({ name, reattached: true }));
});

afterEach(async () => {
  closeOverdeckDatabase();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  _resetInternalTokenCacheForTests();
  _resetTrustedOriginsForTests();
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/conversations/:name/resume (PAN-5516)', () => {
  it('admits a POST that carries only the internal token', async () => {
    const answer = await postResume(NAME, CLI);
    expect(answer.status).toBe(200);
    expect(resumeMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a POST with no credential and no Origin', async () => {
    const answer = await postResume(NAME, {});
    expect(answer).toMatchObject({ status: 403, json: { error: 'Missing origin' } });
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('refuses a POST with a wrong internal token and no Origin', async () => {
    const answer = await postResume(NAME, { [INTERNAL_TOKEN_HEADER]: 'not-the-token' });
    expect(answer).toMatchObject({ status: 403, json: { error: 'Missing origin' } });
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('resolves the stored name', async () => {
    await postResume(NAME, CLI);
    expect(resumeMock).toHaveBeenCalledWith(NAME, {}, expect.anything());
  });

  it('resolves the numeric conversation id to the stored name', async () => {
    const id = getConversationByName(NAME)?.id;
    expect(typeof id).toBe('number');
    await postResume(String(id), CLI);
    expect(resumeMock).toHaveBeenCalledWith(NAME, {}, expect.anything());
  });

  it('resolves the conv- session name to the stored name', async () => {
    await postResume(`conv-${NAME}`, CLI);
    expect(resumeMock).toHaveBeenCalledWith(NAME, {}, expect.anything());
  });

  it('passes an unknown identifier through unchanged so the handler answers 404', async () => {
    await postResume('no-such-conversation', CLI);
    expect(resumeMock).toHaveBeenCalledWith('no-such-conversation', {}, expect.anything());
  });
});
