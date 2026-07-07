import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { httpHandler } from '../http-handler.js';
import { formatUptime, getContainerHistory, getCurrentDockerStats } from './shared.js';

const execAsync = promisify(exec);

export const getContainerHistoryRoute = HttpRouter.add(
  'GET',
  '/api/resources/:containerId/history',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const containerId = params['containerId'] ?? '';

    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      return jsonResponse({ error: 'Invalid container ID' }, { status: 400 });
    }

    return jsonResponse(getContainerHistory(containerId));
  }),
);

export const getContainerDetailsRoute = HttpRouter.add(
  'GET',
  '/api/resources/:containerId/details',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const containerId = params['containerId'] ?? '';

    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      return jsonResponse({ error: 'Invalid container ID' }, { status: 400 });
    }

    return yield* httpHandler(Effect.gen(function* () {
      const [inspectResult, logsResult] = yield* Effect.tryPromise({
        try: () => Promise.all([
          execAsync(`docker inspect --format '{{json .}}' "${containerId}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 })
            .catch(() => ({ stdout: 'null' })),
          execAsync(`docker logs --tail 100 "${containerId}" 2>&1`, { encoding: 'utf-8', timeout: 5000 })
            .catch(() => ({ stdout: '' })),
        ]),
        catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
      });

      const inspect = JSON.parse(inspectResult.stdout || 'null') as {
        Id?: string; Name?: string; Created?: string;
        Config?: { Image?: string; Env?: string[] };
        State?: { Status?: string; StartedAt?: string };
        HostConfig?: { PortBindings?: Record<string, Array<{ HostPort?: string }>> };
      } | null;

      if (!inspect) {
        return jsonResponse({ error: 'Container not found' }, { status: 404 });
      }

      const ports: Array<{ host: string; container: string; protocol: string }> = [];
      const portBindings = inspect.HostConfig?.PortBindings ?? {};
      for (const [containerPort, bindings] of Object.entries(portBindings)) {
        const [port, protocol] = containerPort.split('/');
        for (const binding of bindings ?? []) {
          ports.push({ host: binding.HostPort ?? '', container: port ?? '', protocol: protocol ?? 'tcp' });
        }
      }

      const env: string[] = (inspect.Config?.Env ?? []).filter((e: string) => e.includes('='));

      const details = {
        id: inspect.Id?.slice(0, 12) ?? containerId,
        name: (inspect.Name ?? '').replace(/^\//, ''),
        image: inspect.Config?.Image ?? '',
        status: inspect.State?.Status ?? '',
        created: inspect.Created ?? '',
        uptime: inspect.State?.Status === 'running' && inspect.State?.StartedAt
          ? formatUptime(inspect.State.StartedAt)
          : '',
        ports,
        env,
        logs: logsResult.stdout,
        networkIn: 0,
        networkOut: 0,
      };

      return jsonResponse(details);
    }));
  }),
);

export const deleteDockerContainerRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/docker/container/:id',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    if (!/^[a-f0-9]{12,64}$/.test(id)) {
      return jsonResponse({ error: 'Invalid container ID' }, { status: 400 });
    }

    yield* Effect.tryPromise({
      try: () => execAsync(`docker rm "${id}" 2>&1`, { encoding: 'utf-8', timeout: 10000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true });
  })),
);

export const postRestartContainerRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/container/:id/restart',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    if (!id) {
      return jsonResponse({ error: 'Container ID required' }, { status: 400 });
    }

    const { stdout } = yield* Effect.tryPromise({
      try: () => execAsync(`docker restart "${id}"`, { encoding: 'utf-8', timeout: 30000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true, container: id, output: stdout.trim() });
  })),
);

export const postStartContainerRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/container/:id/start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const eventStore = yield* EventStoreService;

    if (!id) {
      return jsonResponse({ error: 'Container ID required' }, { status: 400 });
    }

    const { stdout } = yield* Effect.tryPromise({
      try: () => execAsync(`docker start "${id}"`, { encoding: 'utf-8', timeout: 30000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true, container: id, output: stdout.trim() });
  })),
);

export const getContainerLogsRoute = HttpRouter.add(
  'GET',
  '/api/resources/docker/container/:id/logs',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    if (!id) {
      return jsonResponse({ error: 'Container ID required' }, { status: 400 });
    }

    const { stdout } = yield* Effect.tryPromise({
      try: () => execAsync(`docker logs --tail 200 --timestamps "${id}"`, { encoding: 'utf-8', timeout: 10000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse({ logs: stdout });
  })),
);
