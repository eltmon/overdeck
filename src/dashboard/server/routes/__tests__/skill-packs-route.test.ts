/**
 * PAN-5540: the known-pack routes. The known-pack core is mocked except for its error class and
 * preview serializer; the routes stay admin-only for remote credentials because they have no
 * ROUTE_SCOPES row.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailablePacks: vi.fn(),
  previewKnownPack: vi.fn(),
  addKnownPack: vi.fn(),
}));

vi.mock('../../../../lib/skill-packs/known.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/skill-packs/known.js')>()),
  listAvailablePacks: mocks.listAvailablePacks,
  previewKnownPack: mocks.previewKnownPack,
  addKnownPack: mocks.addKnownPack,
}));

import type { PackPreview } from '../../../../lib/skill-packs/sources.js';
import { CORE_SKILLS } from '../../../../lib/skill-overrides/resolve.js';
import { KnownPackError } from '../../../../lib/skill-packs/known.js';
import { PackSourceError } from '../../../../lib/skill-packs/sources.js';
import { requiredScopeFor } from '../../route-scopes.js';

const COMMIT = 'c'.repeat(40);
const PREVIEW: PackPreview = {
  id: 'remotion',
  url: 'https://github.com/eltmon/remotion-skills',
  ref: '3e20ac75161bc34468845df714701cc9bf6075f4',
  commit: COMMIT,
  adapter: 'plain',
  manifest: {
    skills: [{ name: 'remotion-best-practices', dir: 'skills/remotion-best-practices', description: 'Rules', optIn: false }],
    capabilities: {
      hooks: false, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
      executables: [], projectMutatingSkills: [], requiresCli: [],
    },
    license: 'MIT',
    pluginName: null,
  },
};

const LISTING = {
  packs: [{
    id: 'remotion', url: 'https://github.com/eltmon/remotion-skills', ref: 'a'.repeat(40), adapter: 'plain',
    disclosure: null, added: false, dashboardAddable: true, reason: null,
    addCommand: 'pan skills pack add remotion', groups: ['video'],
  }],
  groups: [{
    name: 'video', packs: ['remotion', 'hyperframes', 'openmontage', 'video-use'], source: 'built-in',
    missing: ['remotion', 'hyperframes', 'openmontage', 'video-use'], unknown: [], dashboardAddable: true,
    addCommand: 'pan skills pack add --group video',
  }],
};

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const { skillPacksRouteLayer } = await import('../misc/skill-packs.js');
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(skillPacksRouteLayer), app =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const post = (path: string, body: unknown) => request(path, { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAvailablePacks.mockResolvedValue(LISTING);
  mocks.previewKnownPack.mockResolvedValue(PREVIEW);
  mocks.addKnownPack.mockResolvedValue(PREVIEW);
});

describe('GET /api/skills/packs/available', () => {
  it('returns the known-pack listing', async () => {
    const res = await request('/api/skills/packs/available');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(LISTING);
    expect(mocks.listAvailablePacks).toHaveBeenCalledTimes(1);
  });

  it('answers 500 with the error message when the listing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.listAvailablePacks.mockRejectedValue(new Error('config unreadable'));
    const res = await request('/api/skills/packs/available');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'config unreadable', code: 'internal' });
  });

  it('requires admin scope for remote credentials', () => {
    expect(requiredScopeFor('GET', '/api/skills/packs/available')).toBe('admin');
  });
});

describe('POST /api/skills/packs/preview', () => {
  it('previews a known pack by id', async () => {
    const res = await post('/api/skills/packs/preview', { id: 'remotion' });
    expect(res.status).toBe(200);
    expect(res.body.preview).toMatchObject({ id: 'remotion', commit: COMMIT, license: 'MIT', disclosure: expect.any(String) });
    expect(mocks.previewKnownPack).toHaveBeenCalledWith('remotion', CORE_SKILLS);
  });

  it.each(['url', 'ref', 'adapter'])('rejects a body carrying %s without previewing', async (key) => {
    const res = await post('/api/skills/packs/preview', { id: 'remotion', [key]: 'https://evil.example/x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'only a known pack id is accepted', code: 'bad-request' });
    expect(mocks.previewKnownPack).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed id', async () => {
    for (const body of [{}, { id: 7 }, { id: '../x' }, ['remotion']]) {
      const res = await post('/api/skills/packs/preview', body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('bad-request');
    }
    expect(mocks.previewKnownPack).not.toHaveBeenCalled();
  });

  it('maps a busy pack to 409 and a git failure to 502', async () => {
    mocks.previewKnownPack.mockRejectedValueOnce(new KnownPackError('busy', 'pack remotion is already being fetched or added'));
    expect(await post('/api/skills/packs/preview', { id: 'remotion' })).toMatchObject({ status: 409, body: { code: 'busy' } });
    mocks.previewKnownPack.mockRejectedValueOnce(new PackSourceError('git', 'fatal: could not read'));
    expect(await post('/api/skills/packs/preview', { id: 'remotion' })).toMatchObject({ status: 502, body: { code: 'git' } });
  });

  it('maps an already-registered pack to 409 exists', async () => {
    mocks.previewKnownPack.mockRejectedValueOnce(new PackSourceError('exists', 'pack remotion is already registered'));
    const res = await post('/api/skills/packs/preview', { id: 'remotion' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'pack remotion is already registered', code: 'exists' });
  });
});

describe('POST /api/skills/packs', () => {
  it('adds a known pack at the previewed commit', async () => {
    const res = await post('/api/skills/packs', { id: 'remotion', commit: COMMIT });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ added: true, preview: { id: 'remotion', commit: COMMIT } });
    expect(mocks.addKnownPack).toHaveBeenCalledWith('remotion', COMMIT, CORE_SKILLS);
  });

  it('rejects a commit that is not 40-hex', async () => {
    const res = await post('/api/skills/packs', { id: 'remotion', commit: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad-request');
    expect(mocks.addKnownPack).not.toHaveBeenCalled();
  });

  it('rejects a body carrying a url', async () => {
    const res = await post('/api/skills/packs', { id: 'remotion', commit: COMMIT, url: 'https://evil.example/x' });
    expect(res.status).toBe(400);
    expect(mocks.addKnownPack).not.toHaveBeenCalled();
  });

  it('maps commit-changed and exists to 409 and not-addable to 422', async () => {
    mocks.addKnownPack.mockRejectedValueOnce(new KnownPackError('commit-changed', 'pack remotion now resolves to ddddddd'));
    expect(await post('/api/skills/packs', { id: 'remotion', commit: COMMIT })).toEqual({
      status: 409,
      body: { error: 'pack remotion now resolves to ddddddd', code: 'commit-changed' },
    });

    mocks.addKnownPack.mockRejectedValueOnce(new PackSourceError('exists', 'pack remotion is already registered'));
    expect(await post('/api/skills/packs', { id: 'remotion', commit: COMMIT })).toEqual({
      status: 409,
      body: { error: 'pack remotion is already registered', code: 'exists' },
    });

    mocks.addKnownPack.mockRejectedValueOnce(new KnownPackError('not-addable', 'pack sageox cannot be added from the dashboard'));
    expect(await post('/api/skills/packs', { id: 'sageox', commit: COMMIT })).toEqual({
      status: 422,
      body: { error: 'pack sageox cannot be added from the dashboard', code: 'not-addable' },
    });

    mocks.addKnownPack.mockRejectedValueOnce(new KnownPackError('unknown-pack', 'unknown pack: nope'));
    expect(await post('/api/skills/packs', { id: 'nope', commit: COMMIT })).toMatchObject({ status: 404, body: { code: 'unknown-pack' } });
  });
});

describe('route scopes', () => {
  it('requires admin scope for the preview and add routes', () => {
    expect(requiredScopeFor('POST', '/api/skills/packs/preview')).toBe('admin');
    expect(requiredScopeFor('POST', '/api/skills/packs')).toBe('admin');
  });
});
