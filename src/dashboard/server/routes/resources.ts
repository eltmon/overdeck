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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http';

import { DockerStatsCollector } from '../../../lib/docker-stats.js';

const execAsync = promisify(exec);

// ─── Lazy singleton DockerStatsCollector ─────────────────────────────────────

let dockerStatsCollector: DockerStatsCollector | null = null;

export function getDockerStatsCollector(): DockerStatsCollector {
  if (!dockerStatsCollector) {
    dockerStatsCollector = new DockerStatsCollector();
    dockerStatsCollector.start().catch((err: unknown) => {
      console.error('[resources-route] DockerStatsCollector.start() failed:', err);
    });
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
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const collector = dockerStatsCollector;
        const containers = collector ? collector.getStats() : [];
        const stoppedContainers: unknown[] = [];

        // Gather active agents
        const agentsDir = join(homedir(), '.panopticon', 'agents');
        const agents: Record<string, unknown>[] = [];
        if (existsSync(agentsDir)) {
          for (const name of readdirSync(agentsDir)) {
            const stateFile = join(agentsDir, name, 'state.json');
            if (!existsSync(stateFile)) continue;
            try {
              const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
              if (state.status !== 'stopped') agents.push(state);
            } catch { /* skip */ }
          }
        }

        return HttpServerResponse.json({
          containers,
          stoppedContainers,
          networks: [],
          volumes: [],
          agents,
          updatedAt: new Date().toISOString(),
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: 'Failed to fetch resources: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/resources/:containerId/history ──────────────────────────

const getContainerHistoryRoute = HttpRouter.add(
  'GET',
  '/api/resources/:containerId/history',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const containerId = params['containerId'] ?? '';

    if (!/^[a-f0-9]{12,64}$/.test(containerId)) {
      return HttpServerResponse.json({ error: 'Invalid container ID' }, { status: 400 });
    }

    const collector = dockerStatsCollector;
    const history = collector
      ? collector.getHistory(containerId)
      : { timestamps: [], cpuPercent: [], memoryPercent: [] };

    return HttpServerResponse.json(history);
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
      return HttpServerResponse.json({ error: 'Invalid container ID' }, { status: 400 });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        // Fetch container inspect + logs in parallel
        const [inspectResult, logsResult] = await Promise.all([
          execAsync(`docker inspect --format '{{json .}}' "${containerId}" 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 })
            .catch(() => ({ stdout: 'null' })),
          execAsync(`docker logs --tail 100 "${containerId}" 2>&1`, { encoding: 'utf-8', timeout: 5000 })
            .catch(() => ({ stdout: '' })),
        ]);

        const inspect = JSON.parse(inspectResult.stdout || 'null');
        if (!inspect) {
          return HttpServerResponse.json({ error: 'Container not found' }, { status: 404 });
        }

        // Parse ports
        const ports: Array<{ host: string; container: string; protocol: string }> = [];
        const portBindings = (inspect as any).HostConfig?.PortBindings ?? {};
        for (const [containerPort, bindings] of Object.entries(portBindings)) {
          const [port, protocol] = containerPort.split('/');
          for (const binding of (bindings as Array<{ HostPort?: string }>) ?? []) {
            ports.push({ host: binding.HostPort ?? '', container: port ?? '', protocol: protocol ?? 'tcp' });
          }
        }

        // Filter env: skip empty lines
        const env: string[] = ((inspect as any).Config?.Env ?? []).filter((e: string) => e.includes('='));

        const details = {
          id: (inspect as any).Id?.slice(0, 12) ?? containerId,
          name: ((inspect as any).Name ?? '').replace(/^\//, ''),
          image: (inspect as any).Config?.Image ?? '',
          status: (inspect as any).State?.Status ?? '',
          created: (inspect as any).Created ?? '',
          uptime: (inspect as any).State?.Status === 'running' && (inspect as any).State?.StartedAt
            ? formatUptime((inspect as any).State.StartedAt)
            : '',
          ports,
          env,
          logs: logsResult.stdout,
          networkIn: 0,
          networkOut: 0,
        };

        return HttpServerResponse.json(details);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: 'Failed to fetch container details: ' + msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: DELETE /api/resources/docker/container/:id ───────────────────────

const deleteDockerContainerRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/docker/container/:id',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';

    if (!/^[a-f0-9]{12,64}$/.test(id)) {
      return HttpServerResponse.json({ error: 'Invalid container ID' }, { status: 400 });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        await execAsync(`docker rm "${id}" 2>&1`, { encoding: 'utf-8', timeout: 10000 });
        return HttpServerResponse.json({ ok: true });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/resources/docker/prune-containers ──────────────────────

const postPruneContainersRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/prune-containers',
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const { stdout } = await execAsync('docker container prune -f 2>&1', { encoding: 'utf-8', timeout: 30000 });
        return HttpServerResponse.json({ ok: true, output: stdout.trim() });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: DELETE /api/resources/docker/network/:name ───────────────────────

const deleteDockerNetworkRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/docker/network/:name',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return HttpServerResponse.json({ error: 'Invalid network name' }, { status: 400 });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        await execAsync(`docker network rm "${name}" 2>&1`, { encoding: 'utf-8', timeout: 10000 });
        return HttpServerResponse.json({ ok: true });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: DELETE /api/resources/docker/volume/:name ────────────────────────

const deleteDockerVolumeRoute = HttpRouter.add(
  'DELETE',
  '/api/resources/docker/volume/:name',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const name = params['name'] ?? '';

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return HttpServerResponse.json({ error: 'Invalid volume name' }, { status: 400 });
    }

    return yield* Effect.tryPromise({
      try: async () => {
        await execAsync(`docker volume rm "${name}" 2>&1`, { encoding: 'utf-8', timeout: 10000 });
        return HttpServerResponse.json({ ok: true });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/resources/docker/prune-volumes ─────────────────────────

const postPruneVolumesRoute = HttpRouter.add(
  'POST',
  '/api/resources/docker/prune-volumes',
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const { stdout } = await execAsync('docker volume prune -f 2>&1', { encoding: 'utf-8', timeout: 30000 });
        return HttpServerResponse.json({ ok: true, output: stdout.trim() });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
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
);

export default resourcesRouteLayer;
