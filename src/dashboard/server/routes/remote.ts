import { jsonResponse } from "../http-helpers.js";
/**
 * Remote route module — Effect HttpRouter.Layer (PAN-428 B14)
 *
 * Implements all /api/remote/* endpoints from the Express server:
 *   GET  /api/remote/status
 *   GET  /api/remote/workspaces
 *   GET  /api/remote/workspaces/:issueId
 *   POST /api/remote/workspaces/:issueId/start
 *   POST /api/remote/workspaces/:issueId/stop
 *   POST /api/remote/workspaces/:issueId/agent/start
 *   POST /api/remote/workspaces/:issueId/agent/stop
 *   GET  /api/remote/workspaces/:issueId/agent/output
 *   POST /api/remote/workspaces/:issueId/agent/tell
 */

import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as yaml from 'yaml';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  createFlyProviderFromConfig,
  isRemoteAvailable,
  loadRemoteAgentState,
  spawnRemoteAgent,
  killRemoteAgent,
  getRemoteAgentOutput,
  sendToRemoteAgent,
} from '../../../lib/remote/index.js';
import { loadConfigSync as loadPanConfig } from '../../../lib/config.js';
import { EventStoreService } from '../services/domain-services.js';
import { httpHandler } from './http-handler.js';

// ─── Local helpers ────────────────────────────────────────────────────────────

async function loadRemoteWorkspaceMetadata(issueId: string): Promise<unknown | null> {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadataPath = join(homedir(), '.panopticon', 'workspaces', `${normalizedId}.yaml`);
  const content = await readFile(metadataPath, 'utf-8').catch(() => null);
  if (!content) return null;
  try {
    return yaml.parse(content);
  } catch {
    return null;
  }
}

async function listRemoteWorkspaceMetadata(): Promise<unknown[]> {
  const workspacesDir = join(homedir(), '.panopticon', 'workspaces');
  const files = await readdir(workspacesDir).catch(() => [] as string[]);
  const yamlFiles = files.filter(f => f.endsWith('.yaml'));

  const workspaces: unknown[] = [];
  for (const file of yamlFiles) {
    const content = await readFile(join(workspacesDir, file), 'utf-8').catch(() => null);
    if (!content) continue;
    try {
      const metadata = yaml.parse(content) as { location?: string };
      if (metadata.location === 'remote') workspaces.push(metadata);
    } catch {
      // Skip invalid files
    }
  }
  return workspaces;
}

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: GET /api/remote/status ───────────────────────────────────────────

const getRemoteStatusRoute = HttpRouter.add(
  'GET',
  '/api/remote/status',
  httpHandler(Effect.gen(function* () {
    const config = loadPanConfig();
    const remoteConfig = config.remote;
    const enabled = remoteConfig?.enabled ?? false;

    if (!enabled) {
      return jsonResponse({
        enabled: false,
        available: false,
        reason: 'Remote workspaces not enabled. Run: pan remote setup',
      });
    }

    const availability = yield* Effect.tryPromise({
      try: () => isRemoteAvailable(),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (!availability.available) {
      return jsonResponse({ enabled: true, available: false, reason: availability.reason });
    }

    const fly = createFlyProviderFromConfig(remoteConfig);
    const vms = yield* fly.listVms().pipe(
      Effect.catch((err: unknown) => Effect.fail(new Error(err instanceof Error ? err.message : String(err)))),
    );

    return jsonResponse({
      enabled: true,
      available: true,
      provider: remoteConfig?.provider || 'fly',
      vms: (vms as Array<{ name: string; status: string }>).map(vm => ({ name: vm.name, status: vm.status })),
    });
  })),
);

// ─── Route: GET /api/remote/workspaces ───────────────────────────────────────

const listRemoteWorkspacesRoute = HttpRouter.add(
  'GET',
  '/api/remote/workspaces',
  httpHandler(Effect.gen(function* () {
    const workspaces = yield* Effect.promise(() => listRemoteWorkspaceMetadata());

    const config = loadPanConfig();
    const fly = createFlyProviderFromConfig(config.remote);

    // Best-effort: if listing VMs fails, return workspaces without status
    const vms = yield* fly.listVms().pipe(
      Effect.catch(() => Effect.succeed([] as Array<{ name: string; status: string }>)),
    );

    const enriched = (workspaces as Array<{ vmName?: string } & Record<string, unknown>>).map(ws => ({
      ...ws,
      vmStatus: (vms as Array<{ name: string; status: string }>).find(vm => vm.name === ws.vmName)?.status || 'unknown',
    }));

    return jsonResponse(enriched);
  })),
);

// ─── Route: GET /api/remote/workspaces/:issueId ───────────────────────────────

const getRemoteWorkspaceRoute = HttpRouter.add(
  'GET',
  '/api/remote/workspaces/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;

    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const config = loadPanConfig();
    const fly = createFlyProviderFromConfig(config.remote);

    // Best-effort: ignore errors when getting VM status
    const vmStatus = yield* fly.getStatus(metadata.vmName!).pipe(
      Effect.catch(() => Effect.succeed('unknown' as const)),
    );

    let agentStatus = null;
    if (vmStatus === 'running') {
      const agentId = `agent-${issueId.toLowerCase()}`;
      const agentState = loadRemoteAgentState(agentId);
      if (agentState) {
        const s = agentState as { id: string; status: string; model: string; startedAt: string };
        agentStatus = { id: s.id, status: s.status, model: s.model, startedAt: s.startedAt };
      }
    }

    return jsonResponse({ ...metadata, vmStatus, agent: agentStatus });
  })),
);

// ─── Route: POST /api/remote/workspaces/:issueId/start ───────────────────────

const startRemoteWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const eventStore = yield* EventStoreService;

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;
    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const config = loadPanConfig();
    const fly = createFlyProviderFromConfig(config.remote);

    yield* Effect.tryPromise({
      try: async () => {
        await Effect.runPromise(fly.startVm(metadata.vmName!));
        await Effect.runPromise(fly.ssh(metadata.vmName!, 'cd /workspace && docker compose up -d 2>/dev/null || true'));
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    yield* eventStore.append({ type: 'issues.updated', timestamp: new Date().toISOString(), payload: { issueId } });
    return jsonResponse({ success: true, message: `Workspace ${issueId} started` });
  })),
);

// ─── Route: POST /api/remote/workspaces/:issueId/stop ────────────────────────

const stopRemoteWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/stop',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const eventStore = yield* EventStoreService;

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;
    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const config = loadPanConfig();
    const fly = createFlyProviderFromConfig(config.remote);

    yield* Effect.tryPromise({
      try: async () => {
        await Effect.runPromise(fly.ssh(metadata.vmName!, 'docker compose down 2>/dev/null || true'));
        await Effect.runPromise(fly.stopVm(metadata.vmName!));
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    yield* eventStore.append({ type: 'issues.updated', timestamp: new Date().toISOString(), payload: { issueId } });
    return jsonResponse({ success: true, message: `Workspace ${issueId} stopped` });
  })),
);

// ─── Route: POST /api/remote/workspaces/:issueId/agent/start ─────────────────

const startRemoteAgentRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/agent/start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { prompt, model } = body as { prompt?: string; model?: string };

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;
    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const fly = createFlyProviderFromConfig(loadPanConfig().remote);

    const state = yield* Effect.tryPromise({
      try: async () => {
        await fly.syncAllCredentials(metadata.vmName!);
        return spawnRemoteAgent({ issueId, workspace: metadata as unknown as Parameters<typeof spawnRemoteAgent>[0]['workspace'], prompt, model });
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    yield* eventStore.append({ type: 'issues.updated', timestamp: new Date().toISOString(), payload: { issueId } });
    return jsonResponse(state);
  })),
);

// ─── Route: POST /api/remote/workspaces/:issueId/agent/stop ──────────────────

const stopRemoteAgentRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/agent/stop',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const eventStore = yield* EventStoreService;

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;
    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const agentId = `agent-${issueId.toLowerCase()}`;
    yield* Effect.tryPromise({
      try: () => killRemoteAgent(agentId, metadata.vmName!),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    yield* eventStore.append({ type: 'issues.updated', timestamp: new Date().toISOString(), payload: { issueId } });
    return jsonResponse({ success: true, message: `Agent ${agentId} stopped` });
  })),
);

// ─── Route: GET /api/remote/workspaces/:issueId/agent/output ─────────────────

const getRemoteAgentOutputRoute = HttpRouter.add(
  'GET',
  '/api/remote/workspaces/:issueId/agent/output',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const linesParam = Option.isSome(urlOpt) ? urlOpt.value.searchParams.get('lines') : null;
    const lines = parseInt(linesParam ?? '') || 100;

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;
    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const agentId = `agent-${issueId.toLowerCase()}`;
    const output = yield* Effect.tryPromise({
      try: () => getRemoteAgentOutput(agentId, metadata.vmName!, lines),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    return jsonResponse({ output });
  })),
);

// ─── Route: POST /api/remote/workspaces/:issueId/agent/tell ──────────────────

const tellRemoteAgentRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/agent/tell',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    const { message } = body as { message?: string };
    if (!message) {
      return jsonResponse({ error: 'Message is required' }, { status: 400 });
    }

    const metadata = yield* Effect.promise(() => loadRemoteWorkspaceMetadata(issueId)) as Effect.Effect<{ vmName?: string } & Record<string, unknown> | null>;
    if (!metadata) {
      return jsonResponse({ error: 'Remote workspace not found' }, { status: 404 });
    }

    const agentId = `agent-${issueId.toLowerCase()}`;
    yield* Effect.tryPromise({
      try: () => sendToRemoteAgent(agentId, metadata.vmName!, message),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    return jsonResponse({ success: true });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const remoteRouteLayer = Layer.mergeAll(
  getRemoteStatusRoute,
  listRemoteWorkspacesRoute,
  getRemoteWorkspaceRoute,
  startRemoteWorkspaceRoute,
  stopRemoteWorkspaceRoute,
  startRemoteAgentRoute,
  stopRemoteAgentRoute,
  getRemoteAgentOutputRoute,
  tellRemoteAgentRoute,
);

export default remoteRouteLayer;
