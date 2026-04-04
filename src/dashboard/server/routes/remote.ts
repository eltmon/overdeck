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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as yaml from 'yaml';
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  createFlyProviderFromConfig,
  isRemoteAvailable,
  loadRemoteAgentState,
  spawnRemoteAgent,
  killRemoteAgent,
  getRemoteAgentOutput,
  sendToRemoteAgent,
} from '../../../lib/remote/index.js';
import { loadConfig as loadPanConfig } from '../../../lib/config.js';

// ─── Local helpers ────────────────────────────────────────────────────────────

function loadRemoteWorkspaceMetadata(issueId: string): any | null {
  const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metadataPath = join(homedir(), '.panopticon', 'workspaces', `${normalizedId}.yaml`);

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8');
    return yaml.parse(content);
  } catch {
    return null;
  }
}

function listRemoteWorkspaceMetadata(): unknown[] {
  const workspacesDir = join(homedir(), '.panopticon', 'workspaces');

  if (!existsSync(workspacesDir)) {
    return [];
  }

  try {
    const files = readdirSync(workspacesDir).filter(f => f.endsWith('.yaml'));
    const workspaces: unknown[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(workspacesDir, file), 'utf-8');
        const metadata = yaml.parse(content);
        if (metadata.location === 'remote') {
          workspaces.push(metadata);
        }
      } catch {
        // Skip invalid files
      }
    }

    return workspaces;
  } catch {
    return [];
  }
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
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const config = loadPanConfig();
        const remoteConfig = config.remote;
        const enabled = remoteConfig?.enabled ?? false;

        if (!enabled) {
          return HttpServerResponse.json({
            enabled: false,
            available: false,
            reason: 'Remote workspaces not enabled. Run: pan remote setup',
          });
        }

        const availability = await isRemoteAvailable();

        if (!availability.available) {
          return HttpServerResponse.json({
            enabled: true,
            available: false,
            reason: availability.reason,
          });
        }

        const fly = createFlyProviderFromConfig(remoteConfig);
        const vms = await fly.listVms();

        return HttpServerResponse.json({
          enabled: true,
          available: true,
          provider: remoteConfig?.provider || 'fly',
          vms: vms.map((vm: any) => ({
            name: vm.name,
            status: vm.status,
          })),
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/remote/workspaces ───────────────────────────────────────

const listRemoteWorkspacesRoute = HttpRouter.add(
  'GET',
  '/api/remote/workspaces',
  Effect.gen(function* () {
    return yield* Effect.tryPromise({
      try: async () => {
        const workspaces = listRemoteWorkspaceMetadata();

        const config = loadPanConfig();
        const fly = createFlyProviderFromConfig(config.remote);

        let vms: any[] = [];
        try {
          vms = await fly.listVms();
        } catch {
          // Can't get VM status - return workspaces without status
        }

        const enriched = (workspaces as any[]).map(ws => {
          const vmInfo = vms.find((vm: any) => vm.name === ws.vmName);
          return {
            ...ws,
            vmStatus: vmInfo?.status || 'unknown',
          };
        });

        return HttpServerResponse.json(enriched);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/remote/workspaces/:issueId ───────────────────────────────

const getRemoteWorkspaceRoute = HttpRouter.add(
  'GET',
  '/api/remote/workspaces/:issueId',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        const metadata = loadRemoteWorkspaceMetadata(issueId);

        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        const config = loadPanConfig();
        const fly = createFlyProviderFromConfig(config.remote);

        let vmStatus = 'unknown';
        try {
          vmStatus = await fly.getStatus(metadata.vmName);
        } catch {
          // Ignore - status unknown
        }

        let agentStatus = null;
        if (vmStatus === 'running') {
          const agentId = `agent-${issueId.toLowerCase()}`;
          const agentState = loadRemoteAgentState(agentId);
          if (agentState) {
            agentStatus = {
              id: agentState.id,
              status: agentState.status,
              model: agentState.model,
              startedAt: agentState.startedAt,
            };
          }
        }

        return HttpServerResponse.json({
          ...metadata,
          vmStatus,
          agent: agentStatus,
        });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/remote/workspaces/:issueId/start ───────────────────────

const startRemoteWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/start',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        const metadata = loadRemoteWorkspaceMetadata(issueId);

        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        const config = loadPanConfig();
        const fly = createFlyProviderFromConfig(config.remote);

        await fly.startVm(metadata.vmName);

        // Start containers
        await fly.ssh(metadata.vmName, 'cd /workspace && docker compose up -d 2>/dev/null || true');

        return HttpServerResponse.json({ success: true, message: `Workspace ${issueId} started` });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/remote/workspaces/:issueId/stop ────────────────────────

const stopRemoteWorkspaceRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/stop',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        const metadata = loadRemoteWorkspaceMetadata(issueId);

        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        const config = loadPanConfig();
        const fly = createFlyProviderFromConfig(config.remote);

        // Stop containers first
        await fly.ssh(metadata.vmName, 'docker compose down 2>/dev/null || true');

        // Stop VM
        await fly.stopVm(metadata.vmName);

        return HttpServerResponse.json({ success: true, message: `Workspace ${issueId} stopped` });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/remote/workspaces/:issueId/agent/start ─────────────────

const startRemoteAgentRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/agent/start',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.tryPromise({
      try: async () => {
        const { prompt, model } = body as { prompt?: string; model?: string };

        const metadata = loadRemoteWorkspaceMetadata(issueId);
        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        // Sync all credentials before spawning (tokens may have expired)
        const fly = createFlyProviderFromConfig(loadPanConfig().remote);
        await fly.syncAllCredentials(metadata.vmName);

        const state = await spawnRemoteAgent({
          issueId,
          workspace: metadata,
          prompt,
          model,
        });

        return HttpServerResponse.json(state);
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/remote/workspaces/:issueId/agent/stop ──────────────────

const stopRemoteAgentRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/agent/stop',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    return yield* Effect.tryPromise({
      try: async () => {
        const metadata = loadRemoteWorkspaceMetadata(issueId);

        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        const agentId = `agent-${issueId.toLowerCase()}`;
        await killRemoteAgent(agentId, metadata.vmName);

        return HttpServerResponse.json({ success: true, message: `Agent ${agentId} stopped` });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: GET /api/remote/workspaces/:issueId/agent/output ─────────────────

const getRemoteAgentOutputRoute = HttpRouter.add(
  'GET',
  '/api/remote/workspaces/:issueId/agent/output',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const linesParam = Option.isSome(urlOpt)
      ? urlOpt.value.searchParams.get('lines')
      : null;
    const lines = parseInt(linesParam ?? '') || 100;

    return yield* Effect.tryPromise({
      try: async () => {
        const metadata = loadRemoteWorkspaceMetadata(issueId);
        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        const agentId = `agent-${issueId.toLowerCase()}`;
        const output = await getRemoteAgentOutput(agentId, metadata.vmName, lines);

        return HttpServerResponse.json({ output });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
);

// ─── Route: POST /api/remote/workspaces/:issueId/agent/tell ──────────────────

const tellRemoteAgentRoute = HttpRouter.add(
  'POST',
  '/api/remote/workspaces/:issueId/agent/tell',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    return yield* Effect.tryPromise({
      try: async () => {
        const { message } = body as { message?: string };

        if (!message) {
          return HttpServerResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        const metadata = loadRemoteWorkspaceMetadata(issueId);
        if (!metadata) {
          return HttpServerResponse.json({ error: 'Remote workspace not found' }, { status: 404 });
        }

        const agentId = `agent-${issueId.toLowerCase()}`;
        await sendToRemoteAgent(agentId, metadata.vmName, message);

        return HttpServerResponse.json({ success: true });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return HttpServerResponse.json({ error: msg }, { status: 500 });
      },
    });
  }),
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
