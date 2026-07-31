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
  parseComposePs,
  lastErrorLine,
  MAX_UAT_STACKS,
  type ComposeServiceState,
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
  /** Declared services (`docker compose config --services`). */
  services?: string[];
  /** Per-service container state; defaults to `psCount` generic running rows. */
  containers?: ComposeServiceState[];
  logsByService?: Record<string, string>;
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
    composePs: async () =>
      options.containers ??
      Array.from({ length: options.psCount ?? 1 }, (_, i) => ({
        service: `svc${i + 1}`,
        running: true,
        status: 'Up 3 minutes',
        exitCode: null,
      })),
    composeServices: async () =>
      options.services ?? (options.containers ?? []).map((c) => c.service),
    composeServiceLogs: async (_file, _project, service) => options.logsByService?.[service] ?? '',
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
    expect(result.frontendUrl).toBe('https://uat-pan-otter-0610.localhost');
    expect(deps.ups).toEqual(['overdeck-uat-pan-otter-0610']);
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
    expect(deps.downs).toEqual(['overdeck-uat-pan-a-0610']);
    // evicted stack record cleared, new stack recorded
    expect(deps.stackWrites).toContainEqual(['uat/pan-a-0610', null]);
    expect(deps.ups).toEqual(['overdeck-uat-pan-c-0610']);
  });

  it('serializes concurrent starts so the cap is enforced against the re-read stack set', async () => {
    const oldest = gen('uat/pan-a-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' });
    const first = gen('uat/pan-b-0610');
    const second = gen('uat/pan-c-0610');
    const byName = new Map([oldest, first, second].map((g) => [g.name, g]));
    const running = new Set([oldest.name]);
    const deps = makeDeps();
    deps.store.listWithStacks = () => [...running].map((name) => byName.get(name)!).filter(Boolean);
    deps.store.setStack = (name, startedAt) => {
      deps.stackWrites.push([name, startedAt]);
      if (startedAt) running.add(name);
      else running.delete(name);
    };

    const [r1, r2] = await Promise.all([ensureUatStack(first, deps), ensureUatStack(second, deps)]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect([...running].sort()).toEqual(['uat/pan-b-0610', 'uat/pan-c-0610']);
    expect(deps.downs).toEqual(['overdeck-uat-pan-a-0610']);
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
    expect(deps.downs).toEqual(['overdeck-uat-pan-down-0610']);
    expect(deps.stackWrites).toEqual([['uat/pan-down-0610', null]]);
  });

  it('still clears the record when the compose file is already gone', async () => {
    const deps = makeDeps({ composeFileExists: false });
    await teardownUatStack(gen('uat/pan-gone-0610'), deps);
    expect(deps.downs).toEqual([]);
    expect(deps.stackWrites).toEqual([['uat/pan-gone-0610', null]]);
  });

  it('leaves the record intact and rejects when compose down fails', async () => {
    const deps = makeDeps();
    deps.composeDown = async () => { throw new Error('docker daemon gone'); };
    await expect(teardownUatStack(gen('uat/pan-err-0610'), deps)).rejects.toThrow('docker daemon gone');
    expect(deps.stackWrites).toEqual([]);
  });
});

describe('probeUatStack', () => {
  it('reports running when the record and containers agree', async () => {
    const deps = makeDeps({ psCount: 3 });
    const probe = await probeUatStack(gen('uat/pan-up-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('running');
    expect(probe.frontendUrl).toBe('https://uat-pan-up-0610.localhost');
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

  // PAN-3166: the min-quartz-0726 failure — 4 declared services, the api dead
  // at Flyway startup, and the probe still reporting a healthy 'running'.
  it('reports degraded and names the service when a declared service is not up', async () => {
    const deps = makeDeps({
      services: ['postgres', 'redis', 'api', 'fe'],
      containers: [
        { service: 'postgres', running: true, status: 'Up 11 minutes (healthy)', exitCode: null },
        { service: 'redis', running: true, status: 'Up 11 minutes (healthy)', exitCode: null },
        { service: 'api', running: false, status: 'Exited (0) 7 minutes ago', exitCode: 0 },
        { service: 'fe', running: true, status: 'Up 11 minutes', exitCode: null },
      ],
      logsByService: {
        api: [
          'BUILD SUCCESS',
          'org.springframework.beans.factory.BeanCreationException: Error creating bean',
          'Caused by: org.flywaydb.core.api.FlywayException: Found more than one migration with version 256',
        ].join('\n'),
      },
    });

    const probe = await probeUatStack(gen('uat/min-quartz-0726', { stackStartedAt: '2026-07-26T01:00:00.000Z' }), deps);

    expect(probe.status).toBe('degraded');
    expect(probe.downServices).toEqual(['api']);
    expect(probe.serviceErrors?.api).toContain('Found more than one migration with version 256');
    expect(deps.stackWrites).toEqual([]); // degraded is not stale — the record stands
  });

  it('does not call a stack degraded for a one-shot init service that exited cleanly', async () => {
    const deps = makeDeps({
      services: ['init', 'server'],
      containers: [
        { service: 'init', running: false, status: 'Exited (0) 5 minutes ago', exitCode: 0 },
        { service: 'server', running: true, status: 'Up 5 minutes', exitCode: null },
      ],
    });
    const probe = await probeUatStack(gen('uat/pan-init-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('running');
  });

  it('reports degraded when a one-shot init service exited non-zero', async () => {
    const deps = makeDeps({
      services: ['init', 'server'],
      containers: [
        { service: 'init', running: false, status: 'Exited (1) 5 minutes ago', exitCode: 1 },
        { service: 'server', running: true, status: 'Up 5 minutes', exitCode: null },
      ],
      logsByService: { init: 'ERROR: bun install failed' },
    });
    const probe = await probeUatStack(gen('uat/pan-badinit-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('degraded');
    expect(probe.downServices).toEqual(['init']);
  });

  // Guardrail (4): absent is the only status that clears the record, because
  // clearing it destroys the evidence the operator needs.
  it('reports unknown and PRESERVES the record when the probe itself fails', async () => {
    const deps = makeDeps();
    deps.composePs = async () => { throw new Error('Cannot connect to the Docker daemon'); };

    const probe = await probeUatStack(gen('uat/pan-probefail-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);

    expect(probe.status).toBe('unknown');
    expect(probe.probeError).toContain('Cannot connect to the Docker daemon');
    expect(deps.stackWrites).toEqual([]);
  });

  it('reports unknown and preserves the record when the declared services cannot be read', async () => {
    const deps = makeDeps({
      containers: [{ service: 'api', running: true, status: 'Up 1 minute', exitCode: null }],
    });
    deps.composeServices = async () => { throw new Error('compose config failed') };

    const probe = await probeUatStack(gen('uat/pan-cfgfail-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);

    expect(probe.status).toBe('unknown');
    expect(deps.stackWrites).toEqual([]);
  });

  it('reports degraded for a running service Compose calls unhealthy', async () => {
    const deps = makeDeps({
      services: ['api', 'fe'],
      containers: [
        { service: 'api', running: true, status: 'Up 2 minutes (unhealthy)', exitCode: null, health: 'unhealthy' },
        { service: 'fe', running: true, status: 'Up 2 minutes', exitCode: null },
      ],
      logsByService: { api: 'ERROR: connection refused' },
    });
    const probe = await probeUatStack(gen('uat/pan-unhealthy-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('degraded');
    expect(probe.downServices).toEqual(['api']);
    expect(deps.stackWrites).toEqual([]);
  });

  it('reports degraded when a declared service never produced a container', async () => {
    const deps = makeDeps({
      services: ['api', 'fe'],
      containers: [{ service: 'fe', running: true, status: 'Up 2 minutes', exitCode: null }],
    });
    const probe = await probeUatStack(gen('uat/pan-nocreate-0610', { stackStartedAt: '2026-06-10T01:00:00.000Z' }), deps);
    expect(probe.status).toBe('degraded');
    expect(probe.downServices).toEqual(['api']);
  });
});

describe('parseComposePs', () => {
  it('parses the per-line JSON object form', () => {
    const stdout = [
      '{"Service":"api","State":"exited","Status":"Exited (0) 7 minutes ago","ExitCode":0}',
      '{"Service":"fe","State":"running","Status":"Up 11 minutes"}',
    ].join('\n');
    expect(parseComposePs(stdout)).toEqual([
      { service: 'api', running: false, status: 'Exited (0) 7 minutes ago', exitCode: 0 },
      { service: 'fe', running: true, status: 'Up 11 minutes', exitCode: null },
    ]);
  });

  it('reads health from the Health field and from the Status suffix', () => {
    const fromField = parseComposePs('{"Service":"api","State":"running","Status":"Up 2m","Health":"unhealthy"}');
    expect(fromField[0]!.health).toBe('unhealthy');
    // Older Compose folds it into Status instead of emitting Health.
    const fromStatus = parseComposePs('{"Service":"api","State":"running","Status":"Up 2 minutes (unhealthy)"}');
    expect(fromStatus[0]!.health).toBe('unhealthy');
  });

  it('parses the single JSON array form', () => {
    const stdout = '[{"Service":"api","State":"running","Status":"Up 1 minute"}]';
    expect(parseComposePs(stdout)).toEqual([
      { service: 'api', running: true, status: 'Up 1 minute', exitCode: null },
    ]);
  });

  it('returns nothing for empty or malformed output', () => {
    expect(parseComposePs('')).toEqual([]);
    expect(parseComposePs('not json')).toEqual([]);
  });
});

describe('lastErrorLine', () => {
  it('prefers the JVM root cause over the wrapper exception above it', () => {
    const logs = [
      'org.springframework.beans.factory.BeanCreationException: Error creating bean',
      'Caused by: org.flywaydb.core.api.FlywayException: Found more than one migration with version 256',
      '\tat org.flywaydb.core.Flyway.execute(Flyway.java:1)',
    ].join('\n');
    expect(lastErrorLine(logs)).toBe(
      'Caused by: org.flywaydb.core.api.FlywayException: Found more than one migration with version 256',
    );
  });

  it('falls back to the last non-empty line when nothing looks like an error', () => {
    expect(lastErrorLine('starting\nlistening on 8080\n\n')).toBe('listening on 8080');
  });

  it('returns null for empty logs', () => {
    expect(lastErrorLine('   \n\n')).toBeNull();
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

  it('uses neutral localhost when no rendered compose or project DNS domain is available', async () => {
    const url = await uatFrontendUrl(gen('uat/pan-conv-0610'), makeDeps({ composeFileExists: false }));
    expect(url).toBe('https://uat-pan-conv-0610.localhost');
  });
});
