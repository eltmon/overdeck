/**
 * PAN-3942 WI-6: GET/PUT /api/skills/overrides. The store is mocked except for
 * its pure request parser and error class.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSkillStates: vi.fn(),
  setSkillOverride: vi.fn(),
  listLowerLevelOverrides: vi.fn(),
  listLowerLevelPackOverrides: vi.fn(),
}));

vi.mock('../../../../lib/skill-overrides/store.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/skill-overrides/store.js')>()),
  listSkillStates: mocks.listSkillStates,
  setSkillOverride: mocks.setSkillOverride,
  listLowerLevelOverrides: mocks.listLowerLevelOverrides,
  listLowerLevelPackOverrides: mocks.listLowerLevelPackOverrides,
}));

import { SkillOverrideError } from '../../../../lib/skill-overrides/store.js';

const grilling = {
  name: 'grilling', description: '', core: false, projectSkill: false,
  global: null, project: null, issue: false, enabled: false, source: 'issue',
};

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const { skillOverridesRouteLayer } = await import('../misc/skill-overrides.js');
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(skillOverridesRouteLayer), app =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const put = (body: unknown) => request('/api/skills/overrides', { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSkillStates.mockImplementation(async (ctx: { projectKey?: string; issueId?: string }) => ({
    project: ctx.projectKey ?? (ctx.issueId ? 'tst' : null), issue: ctx.issueId ?? null, skills: [grilling],
  }));
  mocks.listLowerLevelOverrides.mockResolvedValue({ grilling: { projects: ['tst'], issues: ['TST-1'] } });
  mocks.listLowerLevelPackOverrides.mockResolvedValue({ mattpocock: { projects: ['tst'], issues: [] } });
  mocks.setSkillOverride.mockResolvedValue({ committed: true, sha: 'abc', pushed: true });
});

describe('GET /api/skills/overrides', () => {
  it('returns the resolved list for an issue without the global aggregate', async () => {
    const result = await request('/api/skills/overrides?issue=TST-1');
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: undefined, issueId: 'TST-1' });
    expect(result).toEqual({ status: 200, body: { project: 'tst', issue: 'TST-1', skills: [grilling] } });
    expect(mocks.listLowerLevelOverrides).not.toHaveBeenCalled();
  });

  it('adds lower-level overrides for the global context', async () => {
    const result = await request('/api/skills/overrides');
    expect(result.status).toBe(200);
    expect(result.body.overriddenBelow).toEqual({ grilling: { projects: ['tst'], issues: ['TST-1'] } });
  });

  it('returns packs and the pack toggles below global (PAN-4334)', async () => {
    mocks.listSkillStates.mockResolvedValue({ project: null, issue: null, skills: [grilling], packs: [{ id: 'mattpocock' }] });
    const result = await request('/api/skills/overrides');
    expect(result.body.packs).toEqual([{ id: 'mattpocock' }]);
    expect(result.body.packOverriddenBelow).toEqual({ mattpocock: { projects: ['tst'], issues: [] } });
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: undefined, issueId: undefined });
  });

  it('forwards checkUpdates=1 to the store', async () => {
    await request('/api/skills/overrides?checkUpdates=1');
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: undefined, issueId: undefined }, { checkUpdates: true });
  });

  it('maps an issue with no project to 404', async () => {
    mocks.listSkillStates.mockRejectedValue(new SkillOverrideError('unknown-issue', 'no registered project owns issue ZZZ-1'));
    const result = await request('/api/skills/overrides?issue=ZZZ-1');
    expect(result).toEqual({ status: 404, body: { error: 'no registered project owns issue ZZZ-1', code: 'unknown-issue' } });
  });
});

describe('PUT /api/skills/overrides', () => {
  it('writes the override and returns the refreshed list for the same context', async () => {
    const result = await put({ level: 'issue', issueId: 'tst-1', skill: 'grilling', enabled: false });
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'issue', issueId: 'TST-1', skill: 'grilling', enabled: false });
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: undefined, issueId: 'TST-1' });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, committed: true, sha: 'abc', pushed: true, project: 'tst', issue: 'TST-1', skills: [grilling] },
    });
  });

  it.each([
    ['core-skill', 409],
    ['unknown-skill', 404],
    ['unknown-project', 404],
    ['unknown-issue', 404],
    ['bad-request', 400],
  ] as const)('maps %s to %i', async (code, status) => {
    mocks.setSkillOverride.mockRejectedValue(new SkillOverrideError(code, `failed: ${code}`));
    const result = await put({ level: 'global', skill: 'grilling', enabled: false });
    expect(result).toEqual({ status, body: { error: `failed: ${code}`, code } });
  });

  it('writes a pack toggle and returns the refreshed packs (PAN-4334)', async () => {
    const pack = { id: 'mattpocock', project: false, enabled: false, source: 'project', skills: [] };
    mocks.listSkillStates.mockResolvedValue({ project: 'tst', issue: null, skills: [grilling], packs: [pack] });
    const result = await put({ level: 'project', projectKey: 'tst', pack: 'mattpocock', enabled: false });
    expect(mocks.setSkillOverride).toHaveBeenCalledWith({ level: 'project', projectKey: 'tst', pack: 'mattpocock', enabled: false });
    expect(mocks.listSkillStates).toHaveBeenCalledWith({ projectKey: 'tst', issueId: undefined });
    expect(result.status).toBe(200);
    expect(result.body.packs).toEqual([pack]);
  });

  it('maps an unknown pack to 404', async () => {
    mocks.setSkillOverride.mockRejectedValue(new SkillOverrideError('unknown-pack', 'unknown pack: nope'));
    const result = await put({ level: 'global', pack: 'nope', enabled: true });
    expect(result).toEqual({ status: 404, body: { error: 'unknown pack: nope', code: 'unknown-pack' } });
  });

  it('rejects a malformed body with 400 before writing', async () => {
    const result = await put({ level: 'project', skill: 'grilling', enabled: false });
    expect(result.status).toBe(400);
    expect(mocks.setSkillOverride).not.toHaveBeenCalled();
  });
});
