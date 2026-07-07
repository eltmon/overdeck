import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventStoreService } from '../../../../src/dashboard/server/services/domain-services.js';
import {
  dockerContainerActionEffect,
  resetDockerContainerExecForTests,
  setDockerContainerExecForTests,
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

afterEach(() => {
  appendedEvents.length = 0;
  resetDockerContainerExecForTests();
  vi.useRealTimers();
});

describe('container verb resources routes', () => {
  it('stop invokes docker stop with 30s grace and returns success JSON', async () => {
    const exec = vi.fn(async () => ({ stdout: 'abc\n', stderr: '' }));
    setDockerContainerExecForTests(exec);

    const body = await runAction('abc', 'stop');

    expect(exec).toHaveBeenCalledWith('docker', ['stop', '--time', '30', 'abc'], {
      encoding: 'utf-8',
      timeout: 35000,
    });
    expect(body).toMatchObject({ ok: true, container: 'abc', action: 'stop', output: 'abc' });
    expect(appendedEvents).toHaveLength(1);
  });

  it('pause and unpause invoke docker and return refreshed container markers', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => ({ stdout: args.includes('unpause') ? 'unpaused\n' : 'paused\n', stderr: '' }));
    setDockerContainerExecForTests(exec);

    const paused = await runAction('abc', 'pause');
    const unpaused = await runAction('abc', 'unpause');

    expect(exec).toHaveBeenNthCalledWith(1, 'docker', ['pause', 'abc'], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    expect(exec).toHaveBeenNthCalledWith(2, 'docker', ['unpause', 'abc'], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    expect(paused).toMatchObject({ ok: true, action: 'pause', containers: expect.any(Array) });
    expect(unpaused).toMatchObject({ ok: true, action: 'unpause', containers: expect.any(Array) });
  });

  it('returns HTTP 500 JSON with docker stderr when exec fails', async () => {
    vi.useFakeTimers();
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('docker failed'), { stderr: 'permission denied\n' });
    });
    setDockerContainerExecForTests(exec);

    const response = await Effect.runPromise(
      dockerContainerActionEffect('abc', 'pause').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'permission denied' });
  });

  it('rejects shell-shaped container IDs before invoking docker', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    setDockerContainerExecForTests(exec);

    const response = await Effect.runPromise(
      dockerContainerActionEffect('abc";touch /tmp/pwned', 'pause').pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid container ID' });
    expect(exec).not.toHaveBeenCalled();
    expect(appendedEvents).toHaveLength(0);
  });
});

async function runAction(
  id: string,
  action: 'stop' | 'pause' | 'unpause',
): Promise<Record<string, unknown>> {
  const response = await Effect.runPromise(
    dockerContainerActionEffect(id, action).pipe(Effect.provide(EventStoreTest)),
  );
  return readJsonBody(response);
}

async function readJsonBody(response: Awaited<ReturnType<typeof Effect.runPromise>>) {
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}
