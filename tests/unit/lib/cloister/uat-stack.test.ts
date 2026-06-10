/**
 * Tests for the UAT stack lifecycle (PAN-1737) — cap enforcement, teardown,
 * probe self-healing, URL derivation. All docker/fs faked.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ensureUatStack,
  teardownUatStack,
  probeUatStack,
  uatFrontendUrl,
  MAX_UAT_STACKS,
  type UatStackDeps,
} from '../../../../src/lib/cloister/uat-stack.js';
import type { UatGeneration } from '../../../../src/lib/database/uat-generations-db.js';

function gen(name: string, overrides: Partial<UatGeneration> = {}): UatGeneration {
  const folder = name.replace(/\//g, '-');
  return {
    name,
    worktreePath: `/proj/workspaces/${folder}`,
    projectRoot: '/proj',
    baseSha: 'main-sha',
    status: 'ready',
    members: [{ issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 }],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '',
    ...overrides,
  };
}

function makeDeps(options: {
  withStacks?: UatGeneration[];
  composeFileExists?: boolean;
  composeContent?: string;
  psCount?: number;
  failUp?: boolean;
  failRender?: boolean;
} = {}): UatStackDeps & {
  ups: string[]; downs: string[]; stackWrites: Array<[string, string | null]>;
} {
  const ups: string[] = [];
  const downs: string[] = [];
  const stackWrites: Array<[string, string | null]> = [];
  const withStacks = options.withStacks ?? [];
  return {
    ups, downs, stackWrites,
    ensureDevcontainer: () => options.failRender ? { ok: false, error: 'render failed' } : { ok: true },
    composeUp: async (_file, project) => {
      if (options.failUp) throw new Error('network pool exhausted');
      ups.push(project);
    },
    composeDown: async (_file, project) => { downs.push(project); },
    composePsCount: async () => options.psCount ?? 1,
    findComposeFile: (workspacePath) =>
      (options.composeFileExists ?? true) ? `${workspacePath}/.devcontainer/docker-compose.devcontainer.yml` : null,
    readComposeFile: async () => options.composeContent ?? '',
    store: {
      setStack: (name, startedAt) => { stackWrites.push([name, startedAt]); },
      listWithStacks: () => withStacks,
    },
    log: () => {},
  };
}

describe('ensureUatStack', () => {
  it('renders, composes up, records the stack, and returns the frontend URL', async () => {
    const deps = makeDeps();
    const g = gen('uat/pan-otter-0610');

    const result = await ensureUatStack(g, deps);

    expect(result.success).toBe(true);
    expect(result.frontendUrl).toBe('https://uat-pan-otter-0610.pan.localhost');
    expect(deps.ups).toEqual(['panopticon-uat-pan-otter-0610']);
    expect(deps.stackWrites).toHaveLength(1);
    expect(deps.stackWrites[0]![0]).toBe('uat/pan-otter-0610');
    expect(deps.stackWrites[0]![1]).toBeTruthy();
    expect(result.evicted).toEqual([]);
  });

  it(`enforces the hard cap of ${MAX_UAT_STACKS}: starting a third tears down the oldest first`, async () => {
    const oldest = gen('uat/pan-a-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' });
    const newer = gen('uat/pan-b-0610', { stackStartedAt: '2026-06-10T02:00:00.000Z' });
    const deps = makeDeps({ withStacks: [oldest, newer] }); // oldest first, as the store returns
    const g = gen('uat/pan-c-0610');

    const result = await ensureUatStack(g, deps);

    expect(result.success).toBe(true);
    expect(result.evicted).toEqual(['uat/pan-a-0610']);
    expect(deps.downs).toEqual(['panopticon-uat-pan-a-0610']);
    // evicted stack record cleared, new stack recorded
    expect(deps.stackWrites).toContainEqual(['uat/pan-a-0610', null]);
    expect(deps.ups).toEqual(['panopticon-uat-pan-c-0610']);
  });

  it('re-ensuring a generation that already has a stack does not evict others below cap', async () => {
    const self = gen('uat/pan-self-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' });
    const other = gen('uat/pan-other-0610', { stackStartedAt: '2026-06-10T02:00:00.000Z' });
    const deps = makeDeps({ withStacks: [self, other] });

    const result = await ensureUatStack(self, deps);

    expect(result.success).toBe(true);
    expect(result.evicted).toEqual([]);
    expect(deps.downs).toEqual([]);
  });

  it('fails cleanly on render failure, missing compose file, and compose-up errors', async () => {
    const g = gen('uat/pan-x-0610');

    const renderFail = await ensureUatStack(g, makeDeps({ failRender: true }));
    expect(renderFail).toMatchObject({ success: false, error: 'render failed' });

    const noCompose = await ensureUatStack(g, makeDeps({ composeFileExists: false }));
    expect(noCompose.success).toBe(false);
    expect(noCompose.error).toContain('no compose file');

    const upFail = makeDeps({ failUp: true });
    const failed = await ensureUatStack(g, upFail);
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('network pool exhausted');
    expect(upFail.stackWrites).toEqual([]); // no stack recorded on failure
  });

  it('refuses a generation with no members', async () => {
    const result = await ensureUatStack(gen('uat/pan-empty-0610', { members: [] }), makeDeps());
    expect(result.success).toBe(false);
  });
});

describe('teardownUatStack', () => {
  it('composes down and clears the stack record', async () => {
    const deps = makeDeps();
    await teardownUatStack(gen('uat/pan-down-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(deps.downs).toEqual(['panopticon-uat-pan-down-0610']);
    expect(deps.stackWrites).toEqual([['uat/pan-down-0610', null]]);
  });

  it('still clears the record when the compose file is already gone', async () => {
    const deps = makeDeps({ composeFileExists: false });
    await teardownUatStack(gen('uat/pan-gone-0610'), deps);
    expect(deps.downs).toEqual([]);
    expect(deps.stackWrites).toEqual([['uat/pan-gone-0610', null]]);
  });

  it('clears the record even when compose down fails', async () => {
    const deps = makeDeps();
    deps.composeDown = async () => { throw new Error('docker daemon gone'); };
    await teardownUatStack(gen('uat/pan-err-0610'), deps);
    expect(deps.stackWrites).toEqual([['uat/pan-err-0610', null]]);
  });
});

describe('probeUatStack', () => {
  it('reports running when the record and containers agree', async () => {
    const deps = makeDeps({ psCount: 3 });
    const probe = await probeUatStack(gen('uat/pan-up-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('running');
    expect(probe.frontendUrl).toBe('https://uat-pan-up-0610.pan.localhost');
  });

  it('reports absent with no stack record', async () => {
    const probe = await probeUatStack(gen('uat/pan-cold-0610'), makeDeps());
    expect(probe.status).toBe('absent');
  });

  it('self-heals a stale record when containers are gone', async () => {
    const deps = makeDeps({ psCount: 0 });
    const probe = await probeUatStack(gen('uat/pan-stale-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('absent');
    expect(deps.stackWrites).toEqual([['uat/pan-stale-0610', null]]);
  });
});

describe('uatFrontendUrl', () => {
  it('prefers the Host() label from the rendered compose file', async () => {
    const deps = makeDeps({
      composeContent: 'labels:\n  - "traefik.http.routers.x.rule=Host(`uat-pan-host-0610.custom.localhost`)"',
    });
    const url = await uatFrontendUrl(gen('uat/pan-host-0610'), deps);
    expect(url).toBe('https://uat-pan-host-0610.custom.localhost');
  });

  it('falls back to the FEATURE_FOLDER convention without a rendered compose', async () => {
    const url = await uatFrontendUrl(gen('uat/pan-conv-0610'), makeDeps({ composeFileExists: false }));
    expect(url).toBe('https://uat-pan-conv-0610.pan.localhost');
  });
});
