import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventStoreService } from '../../../../src/dashboard/server/services/domain-services.js';
import {
  dockerStackVerbEffect,
  resetCurrentDockerStatsReaderForTests,
  resetDockerStackVerbExecForTests,
  setCurrentDockerStatsReaderForTests,
  setDockerStackVerbExecForTests,
} from '../../../../src/dashboard/server/routes/resources.js';

const appendedEvents: unknown[] = [];
const EventStoreTest = Layer.succeed(EventStoreService, {
  append: (event: unknown) => Effect.sync(() => {
    appendedEvents.push(event);
    return 'event-1';
  }),
  queryByType: () => Effect.succeed([]),
  queryById: () => Effect.succeed(null),
  subscribe: () => Effect.succeed({ unsubscribe: () => undefined }),
});

beforeEach(() => {
  setCurrentDockerStatsReaderForTests(() => [
    container('c-api', 'feature-min-857-api-1'),
    container('c-web', 'feature-min-857-web-1'),
    container('c-worker', 'feature-min-857-worker-1'),
  ]);
});

afterEach(() => {
  appendedEvents.length = 0;
  resetCurrentDockerStatsReaderForTests();
  resetDockerStackVerbExecForTests();
});

describe('stack verb resources routes', () => {
  it('stops every service container with 30s grace and returns per-container results', async () => {
    const exec = vi.fn(async (file: string, args: string[]) => ({ stdout: `${file} ${args.join(' ')}\n`, stderr: '' }));
    setDockerStackVerbExecForTests(exec);

    const response = await Effect.runPromise(
      dockerStackVerbEffect('MIN-857', 'stop').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec).toHaveBeenNthCalledWith(1, 'docker', ['stop', '--time', '30', 'c-api'], { encoding: 'utf-8', timeout: 35000 });
    expect(exec).toHaveBeenNthCalledWith(2, 'docker', ['stop', '--time', '30', 'c-web'], { encoding: 'utf-8', timeout: 35000 });
    expect(exec).toHaveBeenNthCalledWith(3, 'docker', ['stop', '--time', '30', 'c-worker'], { encoding: 'utf-8', timeout: 35000 });
    expect(body).toMatchObject({
      ok: true,
      issueId: 'MIN-857',
      action: 'stop',
      results: [
        { containerId: 'c-api', ok: true },
        { containerId: 'c-web', ok: true },
        { containerId: 'c-worker', ok: true },
      ],
    });
    expect((body.results as unknown[])).toHaveLength(3);
    expect(appendedEvents).toHaveLength(1);
  });

  it('reports partial failures while continuing the remaining services', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => {
      if (args.includes('c-web')) {
        throw Object.assign(new Error('docker failed'), { stderr: 'already paused\n' });
      }
      return { stdout: 'ok\n', stderr: '' };
    });
    setDockerStackVerbExecForTests(exec);

    const response = await Effect.runPromise(
      dockerStackVerbEffect('min-857', 'pause').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(exec).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({
      ok: false,
      issueId: 'MIN-857',
      action: 'pause',
      results: [
        { containerId: 'c-api', ok: true },
        { containerId: 'c-web', ok: false, error: 'already paused' },
        { containerId: 'c-worker', ok: true },
      ],
    });
    expect(appendedEvents).toHaveLength(1);
  });

  it('unpauses paused services when starting a stack', async () => {
    setCurrentDockerStatsReaderForTests(() => [
      container('c-api', 'feature-min-857-api-1', 'paused'),
      container('c-web', 'feature-min-857-web-1', 'running'),
    ]);
    const exec = vi.fn(async () => ({ stdout: 'ok\n', stderr: '' }));
    setDockerStackVerbExecForTests(exec);

    const response = await Effect.runPromise(
      dockerStackVerbEffect('MIN-857', 'start').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, action: 'start' });
    expect(exec).toHaveBeenNthCalledWith(1, 'docker', ['unpause', 'c-api'], { encoding: 'utf-8', timeout: 30000 });
    expect(exec).toHaveBeenNthCalledWith(2, 'docker', ['start', 'c-web'], { encoding: 'utf-8', timeout: 30000 });
  });

  it('rejects shell-shaped service IDs before invoking docker for that service', async () => {
    setCurrentDockerStatsReaderForTests(() => [
      container('c-api', 'feature-min-857-api-1'),
      container('bad";touch /tmp/pwned', 'feature-min-857-web-1'),
    ]);
    const exec = vi.fn(async () => ({ stdout: 'ok\n', stderr: '' }));
    setDockerStackVerbExecForTests(exec);

    const response = await Effect.runPromise(
      dockerStackVerbEffect('MIN-857', 'pause').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('docker', ['pause', 'c-api'], { encoding: 'utf-8', timeout: 30000 });
    expect(body).toMatchObject({
      ok: false,
      results: [
        { containerId: 'c-api', ok: true },
        { containerId: 'bad";touch /tmp/pwned', ok: false, error: 'Invalid container ID' },
      ],
    });
  });

  it('returns 404 when the issue has no stack', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    setDockerStackVerbExecForTests(exec);

    const response = await Effect.runPromise(
      dockerStackVerbEffect('MIN-999', 'stop').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({ ok: false, error: 'Stack not found for MIN-999' });
    expect(exec).not.toHaveBeenCalled();
    expect(appendedEvents).toHaveLength(0);
  });
});

function container(id: string, name: string, status = 'running') {
  return {
    id,
    name,
    status,
    labels: {
      'com.docker.compose.project': 'feature-min-857',
      'com.docker.compose.service': name,
    },
  };
}

async function readJsonBody(response: Awaited<ReturnType<typeof Effect.runPromise>>) {
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}
