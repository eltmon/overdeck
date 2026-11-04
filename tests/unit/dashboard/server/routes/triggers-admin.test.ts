/**
 * PAN-4648 W-6: /api/triggers management routes — the list never carries a
 * secret, create returns the hook path once, unknown targets are 400, delete
 * removes, the signing secret can be set, and an uncredentialed LAN peer is
 * stopped by the remote gate. The store is real (temp OVERDECK_HOME);
 * conversation and project lookups are faked.
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../../src/lib/internal-token.js';
import { invalidateRemoteAccessConfig } from '../../../../../src/lib/remote-access/config.js';
import { remoteRequestGateLayer } from '../../../../../src/dashboard/server/remote-request-gate.js';
import { triggersRouteLayer } from '../../../../../src/dashboard/server/routes/triggers.js';
import { _resetDashboardSessionTokenForTests } from '../../../../../src/dashboard/server/routes/dashboard-auth.js';

const mocks = vi.hoisted(() => ({
  byName: vi.fn(),
  byId: vi.fn(),
  project: vi.fn(),
}));

vi.mock('../../../../../src/lib/overdeck/conversations.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getConversationByName: mocks.byName,
  getConversationById: mocks.byId,
}));
vi.mock('../../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProjectSync: mocks.project,
}));

const INTERNAL = 'triggers-internal-token';
const HOOK_PATH = /^\/hooks\/trg_[0-9a-f]{12}\/[0-9a-f]{64}$/;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4648-admin-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  invalidateRemoteAccessConfig();
  mocks.byName.mockReset().mockImplementation((name: string) => (name === '20261101-0001' ? { name } : null));
  mocks.byId.mockReset().mockImplementation((id: number) => (id === 7 ? { name: '20261101-0007' } : null));
  mocks.project.mockReset().mockImplementation((key: string) => (key === 'overdeck' ? { name: 'overdeck' } : null));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { credential?: boolean; peer?: string; layer?: Layer.Layer<never, never, never> } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.credential !== false) headers[INTERNAL_TOKEN_HEADER] = INTERNAL;
  const request = HttpServerRequest.fromWeb(new Request(`http://127.0.0.1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })).modify({ remoteAddress: opts.peer ? Option.some(opts.peer) : Option.none() });
  const response = await Effect.runPromise(Effect.scoped(
    Effect.flatMap(HttpRouter.toHttpEffect(opts.layer ?? triggersRouteLayer), (app) =>
      Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)),
  ));
  const raw = (response.body as { body?: Uint8Array } | null)?.body;
  const text = raw ? new TextDecoder().decode(raw) : '{}';
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) as Record<string, any> };
}

describe('/api/triggers (PAN-4648)', () => {
  it('creates a trigger, returns the hook path once, and lists it without any secret', async () => {
    const created = await call('POST', '/api/triggers', {
      name: 'gh',
      target: { kind: 'project', projectKey: 'overdeck', harness: 'codex' },
      template: 'Handle this GitHub event.',
      verify: 'github',
    });
    expect(created.status).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body.hookPath).toMatch(HOOK_PATH);
    expect(created.body.urlSecretShownOnce).toBe(true);
    expect(created.body.url).toBeNull();
    expect(created.body.generatedSigningSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(created.body.trigger).toMatchObject({ name: 'gh', target: { kind: 'project', projectKey: 'overdeck', harness: 'codex' } });

    const urlSecret = String(created.body.hookPath).split('/').pop()!;
    const listed = await call('GET', '/api/triggers');
    expect(listed.status).toBe(200);
    expect(listed.body.triggers).toHaveLength(1);
    expect(listed.text).not.toContain('secretHash');
    expect(listed.text).not.toContain('signingSecret"');
    expect(listed.text).not.toContain(urlSecret);
    expect(listed.text).not.toContain(created.body.generatedSigningSecret);
    expect(listed.body.triggers[0].signingSecretSet).toBe(true);
    expect(listed.body.funnel).toEqual({
      port: 8443,
      baseUrl: null,
      command: `tailscale funnel --bg --https=8443 --set-path=/hooks http://127.0.0.1:${process.env.API_PORT ?? process.env.PORT ?? '3011'}/hooks`,
    });
  });

  it('stores a conversation given by numeric id under its name', async () => {
    const created = await call('POST', '/api/triggers', { name: 'ci', target: { kind: 'conversation', conversation: '7' } });
    expect(created.status).toBe(201);
    expect(created.body.trigger.target).toEqual({ kind: 'conversation', conversation: '20261101-0007' });
  });

  it('refuses an unknown conversation, an unknown project, and a store validation error with 400', async () => {
    expect((await call('POST', '/api/triggers', { name: 'ci', target: { kind: 'conversation', conversation: 'nope' } })).status).toBe(400);
    expect((await call('POST', '/api/triggers', { name: 'p', target: { kind: 'project', projectKey: 'ghost' }, template: 't' })).status).toBe(400);
    const invalid = await call('POST', '/api/triggers', { name: 'p', target: { kind: 'project', projectKey: 'overdeck' } });
    expect(invalid).toMatchObject({ status: 400, body: { error: 'A project target needs a prompt template' } });
    expect((await call('GET', '/api/triggers')).body.triggers).toEqual([]);
  });

  it('removes a trigger, and 404s a second removal', async () => {
    const created = await call('POST', '/api/triggers', { name: 'ci', target: { kind: 'conversation', conversation: '20261101-0001' } });
    const id = created.body.trigger.id as string;
    expect(await call('DELETE', `/api/triggers/${id}`)).toMatchObject({ status: 200, body: { removed: true } });
    expect((await call('GET', '/api/triggers')).body.triggers).toEqual([]);
    expect((await call('DELETE', `/api/triggers/${id}`)).status).toBe(404);
  });

  it('sets a signing secret without echoing it', async () => {
    const created = await call('POST', '/api/triggers', {
      name: 'stripe',
      target: { kind: 'conversation', conversation: '20261101-0001' },
      verify: 'stripe',
    });
    const id = created.body.trigger.id as string;
    expect(created.body.trigger.signingSecretSet).toBe(false);

    const updated = await call('PUT', `/api/triggers/${id}/signing-secret`, { secret: 'whsec_rolled_secret' });
    expect(updated).toMatchObject({ status: 200, body: { trigger: { id, signingSecretSet: true } } });
    expect(updated.text).not.toContain('whsec_rolled_secret');
    const listed = await call('GET', '/api/triggers');
    expect(listed.body.triggers[0]).toMatchObject({ id, signingSecretSet: true });
    expect(listed.text).not.toContain('whsec_rolled_secret');
    expect(JSON.parse(await readFile(join(home, 'triggers.json'), 'utf8')).triggers[0].signingSecret).toBe('whsec_rolled_secret');
    expect((await call('PUT', `/api/triggers/${id}/signing-secret`, { secret: 'has space' })).status).toBe(400);
    expect((await call('PUT', '/api/triggers/trg_000000000000/signing-secret', { secret: 'whsec_rolled_secret' })).status).toBe(404);
  });

  it('401s an uncredentialed request from a non-loopback peer', async () => {
    const gated = Layer.mergeAll(remoteRequestGateLayer, triggersRouteLayer);
    expect((await call('GET', '/api/triggers', undefined, { credential: false, peer: '192.0.2.44', layer: gated })).status).toBe(401);
    expect((await call('POST', '/api/triggers', { name: 'x' }, { credential: false, peer: '192.0.2.44', layer: gated })).status).toBe(401);
  });
});
