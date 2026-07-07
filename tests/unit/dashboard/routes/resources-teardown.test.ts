import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventStoreService } from '../../../../src/dashboard/server/services/domain-services.js';
import {
  getStackTeardownEstimateEffect,
  postStackTeardownEffect,
  resetCurrentDockerStatsReaderForTests,
  resetStackTeardownForTests,
  setCurrentDockerStatsReaderForTests,
  setStackTeardownActivityEmitterForTests,
  setStackTeardownDockerExecForTests,
  setStackTeardownTokenGeneratorForTests,
} from '../../../../src/dashboard/server/routes/resources.js';

const appendedEvents: unknown[] = [];
const activityEntries: unknown[] = [];
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
  setCurrentDockerStatsReaderForTests(() => [
    {
      id: 'c-api',
      name: 'feature-pan-2464-api-1',
      memoryUsage: 300,
      diskUsage: 700,
      labels: {
        'com.docker.compose.project': 'feature-pan-2464',
        'com.docker.compose.service': 'api',
      },
    },
    {
      id: 'c-worker',
      name: 'feature-pan-2464-worker-1',
      memoryUsage: 200,
      diskUsage: 1100,
      labels: {
        'com.docker.compose.project': 'feature-pan-2464',
        'com.docker.compose.service': 'worker',
      },
    },
  ]);
  setStackTeardownTokenGeneratorForTests(() => 'token-1');
  setStackTeardownActivityEmitterForTests((entry) => {
    activityEntries.push(entry);
  });
});

afterEach(() => {
  appendedEvents.length = 0;
  activityEntries.length = 0;
  resetCurrentDockerStatsReaderForTests();
  resetStackTeardownForTests();
  vi.useRealTimers();
});

describe('stack teardown resources routes', () => {
  it('returns a short-lived typed-confirm estimate for the stack', async () => {
    const response = await Effect.runPromise(getStackTeardownEstimateEffect('PAN-2464'));
    const body = await readJsonBody(response);

    expect(body).toMatchObject({
      issueId: 'PAN-2464',
      composeProject: 'feature-pan-2464',
      ramBytes: 500,
      diskBytes: 1800,
      confirmToken: 'token-1',
      expiresAt: '2026-07-07T12:05:00.000Z',
    });
  });

  it('rejects wrong typed confirmation without executing docker commands', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    setStackTeardownDockerExecForTests(exec);
    await Effect.runPromise(getStackTeardownEstimateEffect('PAN-2464'));

    const response = await Effect.runPromise(
      postStackTeardownEffect('PAN-2464', { confirmToken: 'token-1', typedText: 'pan-2464' })
        .pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(422);
    expect(body).toMatchObject({ ok: false });
    expect(exec).not.toHaveBeenCalled();
    expect(appendedEvents).toHaveLength(0);
    expect(activityEntries).toHaveLength(0);
  });

  it('rejects expired confirmation tokens under fake timers', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    setStackTeardownDockerExecForTests(exec);
    await Effect.runPromise(getStackTeardownEstimateEffect('PAN-2464'));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

    const response = await Effect.runPromise(
      postStackTeardownEffect('PAN-2464', { confirmToken: 'token-1', typedText: 'feature-pan-2464' })
        .pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);

    expect(response.status).toBe(422);
    expect(body).toMatchObject({ ok: false, error: 'Invalid or expired confirmation token.' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('tears down only docker resources and emits reclaim activity', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'network' && args[1] === 'ls') return { stdout: 'feature-pan-2464_default\n', stderr: '' };
      if (args[0] === 'volume' && args[1] === 'ls') return { stdout: 'feature-pan-2464_data\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    setStackTeardownDockerExecForTests(exec);
    await Effect.runPromise(getStackTeardownEstimateEffect('PAN-2464'));

    const response = await Effect.runPromise(
      postStackTeardownEffect('PAN-2464', { confirmToken: 'token-1', typedText: 'feature-pan-2464' })
        .pipe(Effect.provide(EventStoreTest)),
    );
    const body = await readJsonBody(response);
    const commands = exec.mock.calls.map(([file, args]) => [file, args]);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      issueId: 'PAN-2464',
      composeProject: 'feature-pan-2464',
      ramBytes: 500,
      diskBytes: 1800,
      removedContainers: ['c-api', 'c-worker'],
      removedNetworks: ['feature-pan-2464_default'],
      removedVolumes: ['feature-pan-2464_data'],
    });
    expect(commands).toEqual([
      ['docker', ['stop', '--time', '30', 'c-api']],
      ['docker', ['stop', '--time', '30', 'c-worker']],
      ['docker', ['rm', '-f', 'c-api']],
      ['docker', ['rm', '-f', 'c-worker']],
      ['docker', ['network', 'ls', '--filter', 'label=com.docker.compose.project=feature-pan-2464', '--format', '{{.Name}}']],
      ['docker', ['network', 'rm', 'feature-pan-2464_default']],
      ['docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project=feature-pan-2464', '--format', '{{.Name}}']],
      ['docker', ['volume', 'rm', 'feature-pan-2464_data']],
    ]);
    const commandText = JSON.stringify(commands);
    expect(commandText).not.toContain('/workspaces/feature-pan-2464');
    expect(commandText).not.toContain('git worktree');
    expect(commandText).not.toContain('rm -rf');
    expect(appendedEvents).toHaveLength(1);
    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]).toMatchObject({
      source: 'dashboard',
      level: 'info',
      issueId: 'PAN-2464',
    });
    expect(JSON.parse((activityEntries[0] as { details: string }).details)).toMatchObject({
      issueId: 'PAN-2464',
      ramBytes: 500,
      diskBytes: 1800,
    });
  });

  it('rejects shell-shaped listed docker resource names before removing them', async () => {
    const exec = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'network' && args[1] === 'ls') return { stdout: 'bad";touch /tmp/pwned\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    setStackTeardownDockerExecForTests(exec);
    await Effect.runPromise(getStackTeardownEstimateEffect('PAN-2464'));

    await expect(Effect.runPromise(
      postStackTeardownEffect('PAN-2464', { confirmToken: 'token-1', typedText: 'feature-pan-2464' })
        .pipe(Effect.provide(EventStoreTest)),
    )).rejects.toThrow('Invalid network name');

    expect(exec.mock.calls).not.toContainEqual([
      'docker',
      ['network', 'rm', 'bad";touch /tmp/pwned'],
      expect.any(Object),
    ]);
    expect(appendedEvents).toHaveLength(0);
    expect(activityEntries).toHaveLength(0);
  });
});

async function readJsonBody(response: Awaited<ReturnType<typeof Effect.runPromise>>) {
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return JSON.parse(text) as Record<string, unknown>;
}
