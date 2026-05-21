import { jsonResponse } from "../http-helpers.js";
/**
 * Resources route module — Effect HttpRouter.Layer (PAN-428 B12)
 *
 * Implements all /api/resources/* endpoints from the Express server:
 *   GET    /api/resources
 *   GET    /api/resources/:containerId/history
 *   GET    /api/resources/:containerId/details
 *   DELETE /api/resources/docker/container/:id
 *   POST   /api/resources/docker/prune-containers
 *   DELETE /api/resources/docker/network/:name
 *   DELETE /api/resources/docker/volume/:name
 *   POST   /api/resources/docker/prune-volumes
 */

import { exec } from 'node:child_process';
import { readdir, readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';

import { DockerStatsCollector } from '../../../lib/docker-stats.js';
import { EventStoreService } from '../services/domain-services.js';
import { httpHandler } from './http-handler.js';

const execAsync = promisify(exec);

// ─── Lazy singleton DockerStatsCollector ─────────────────────────────────────

let dockerStatsCollector: DockerStatsCollector | null = null;

export function getDockerStatsCollector(): DockerStatsCollector {
  if (!dockerStatsCollector) {
    dockerStatsCollector = new DockerStatsCollector();
    Effect.runFork(
      dockerStatsCollector.start().pipe(Effect.provide(nodeServicesLayer)),
    );
  }
  return dockerStatsCollector;
}

// ─── Local helpers ────────────────────────────────────────────────────────────

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Route: GET /api/resources ────────────────────────────────────────────────

const getResourcesRoute = HttpRouter.add(
  'GET',
  '/api/resources',
  httpHandler(Effect.gen(function* () {
    const collector = dockerStatsCollector;
    const containers = collector ? collector.getStats() : [];
    const stoppedContainers: unknown[] = [];

    // Gather active agents using async FS
    const agentsDir = join(homedir(), '.panopticon', 'agents');
    const agents: Record<string, unknown>[] = [];

    // Wrap I/O so its fallback lives in the SUCCESS channel — using
    // `Effect.tryPromise({ catch: () => fallback })` instead routes `fallback`
    // through the FAILURE channel, so `yield*` re-raises and the surrounding
    // `if (!stateText) continue;` is dead code. That bug fired on every poll
    // where any agent's state.json was missing or briefly being rewritten, and
    // since this route is polled every 5s, it manufactured a steady stream of
    // `Effect.fail(null)` defects that hit `httpHandler`'s catchCause and spammed
    // the dashboard log + stole event-loop time formatting Cause.pretty.
    const agentsDirExists = yield* Effect.promise(() =>
      access(agentsDir).then(() => true, () => false),
    );

    if (agentsDirExists) {
      const names = yield* Effect.promise(() =>
        readdir(agentsDir).catch(() => [] as string[]),
      );

      for (const name of names) {
        const stateFile = join(agentsDir, name, 'state.json');
        const stateText = yield* Effect.promise(() =>
          readFile(stateFile, 'utf-8').catch(() => null as string | null),
        );
        if (!stateText) continue;
        try {
          const state = JSON.parse(stateText) as Record<string, unknown>;
          if (state.status !== 'stopped') agents.push(state);
        } catch { /* skip malformed */ }
      }
    }

    return jsonResponse({
      containers,
      stoppedContainers,
      networks: [],
      volumes: [],
      agents,
      updatedAt: new Date().toISOString(),
    });
  })),
);

// ─── Route: GET /api/resources/:containerId/history ──────────────────────────

const getContainerHistoryRoute = HttpRouter.add(
  'GET',
  '/api/resources/:containerId/history',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const containerId = params['containerId'] ?? '';

    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      return jsonResponse({ error: 'Invalid container ID' }, { status: 400 });
    }

    const collector = dockerStatsCollector;
    const history = collector
      ? collector.getHistory(containerId)
      : { timestamps: [], cpuPercent: [], memoryPercent: [] };

    return jsonResponse(history);
  }),
);

// ─── Route: GET /api/resources/:containerId/details ──────────────────────────

const getContainerDetailsRoute = HttpRouter.add(
  'GET',
  '/api/resources/:containerId/details',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const containerId = params['containerId'] ?? '';

    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      return jsonResponse({ error: 'Invalid container ID' }, { status: 400 });
    }

    return yield* httpHandler(Effect.gen(function* () {
      // Fetch container inspect + logs in parallel
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

      // Parse ports
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

// ─── Route: DELETE /api/resources/docker/container/:id ───────────────────────

const deleteDockerContainerRoute = HttpRouter.add(
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
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true });
  })),
);

// ─── Route: POST /api/resources/docker/prune-containers ──────────────────────

const postPruneContainersRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/prune-containers',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const { stdout } = yield* Effect.tryPromise({
      try: () => execAsync('docker container prune -f 2>&1', { encoding: 'utf-8', timeout: 30000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true, output: stdout.trim() });
  })),
);

// ─── Route: DELETE /api/resources/docker/network/:name ───────────────────────

const deleteDockerNetworkRoute = HttpRouter.add(
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
      try: () => execAsync(`docker network rm "${name}" 2>&1`, { encoding: 'utf-8', timeout: 10000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true });
  })),
);

// ─── Route: DELETE /api/resources/docker/volume/:name ────────────────────────

const deleteDockerVolumeRoute = HttpRouter.add(
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
      try: () => execAsync(`docker volume rm "${name}" 2>&1`, { encoding: 'utf-8', timeout: 10000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true });
  })),
);

// ─── Route: POST /api/resources/docker/prune-volumes ─────────────────────────

const postPruneVolumesRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/prune-volumes',
  httpHandler(Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const { stdout } = yield* Effect.tryPromise({
      try: () => execAsync('docker volume prune -f 2>&1', { encoding: 'utf-8', timeout: 30000 }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true, output: stdout.trim() });
  })),
);

// ─── Route: POST /api/resources/docker/container/:id/restart ─────────────────

const postRestartContainerRoute = HttpRouter.add(
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
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true, container: id, output: stdout.trim() });
  })),
);

// ─── Route: POST /api/resources/docker/container/:id/start ───────────────────

const postStartContainerRoute = HttpRouter.add(
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
    yield* eventStore.append({ type: 'resources.updated', timestamp: new Date().toISOString(), payload: { resources: { containers: 0, networks: 0 } } });
    return jsonResponse({ ok: true, container: id, output: stdout.trim() });
  })),
);

// ─── Route: GET /api/resources/docker/container/:id/logs ─────────────────────

const getContainerLogsRoute = HttpRouter.add(
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

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const resourcesRouteLayer = Layer.mergeAll(
  getResourcesRoute,
  getContainerHistoryRoute,
  getContainerDetailsRoute,
  deleteDockerContainerRoute,
  postPruneContainersRoute,
  deleteDockerNetworkRoute,
  deleteDockerVolumeRoute,
  postPruneVolumesRoute,
  postRestartContainerRoute,
  postStartContainerRoute,
  getContainerLogsRoute,
);

export default resourcesRouteLayer;
