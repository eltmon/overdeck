import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { httpHandler } from '../http-handler.js';
import { getCurrentDockerStats } from './shared.js';

const execFileAsync = promisify(execFile);

export const postPruneContainersRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/prune-containers',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const { stdout } = yield* Effect.tryPromise({
      try: () => execFileAsync('docker', ['container', 'prune', '-f'], { encoding: 'utf-8', timeout: 30000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true, output: stdout.trim() });
  })),
);

export const deleteDockerNetworkRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/docker/network/:name',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const eventStore = yield* EventStoreService;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return jsonResponse({ error: 'Invalid network name' }, { status: 400 });
    }

    yield* Effect.tryPromise({
      try: () => execFileAsync('docker', ['network', 'rm', name], { encoding: 'utf-8', timeout: 10000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true });
  })),
);

export const deleteDockerVolumeRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/docker/volume/:name',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';
    const eventStore = yield* EventStoreService;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return jsonResponse({ error: 'Invalid volume name' }, { status: 400 });
    }

    yield* Effect.tryPromise({
      try: () => execFileAsync('docker', ['volume', 'rm', name], { encoding: 'utf-8', timeout: 10000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true });
  })),
);

export const postPruneVolumesRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/prune-volumes',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const { stdout } = yield* Effect.tryPromise({
      try: () => execFileAsync('docker', ['volume', 'prune', '-f'], { encoding: 'utf-8', timeout: 30000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: getCurrentDockerStats() } } });
    return jsonResponse({ ok: true, output: stdout.trim() });
  })),
);
