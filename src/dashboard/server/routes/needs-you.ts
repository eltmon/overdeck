/**
 * `GET /api/needs-you` (PAN-4944, PAN-4927 W-APPR1, D-1–D-3): this machine's
 * Needs-You feed for any token with `read:conversations` — unlike `GET
 * /api/machines/needs-you`, which answers only a machine credential. Agent
 * rows are enriched with the ids `list_pending_input`'s answer tools need:
 * `pendingAskUserQuestion` (from the read-model snapshot) and
 * `permissionRequests` (from the read model's open channel permission
 * requests, preview redacted). `buildNeedsYou()` itself is untouched (NFR-6);
 * enrichment happens only here.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import type { ChannelPermissionRequestSnapshot } from '@overdeck/contracts';

import { jsonResponse } from '../http-helpers.js';
import { ReadModelService } from '../read-model.js';
import { buildNeedsYou, type NeedsYouAgent, type NeedsYouFeed } from '../services/needs-you-feed.js';
import { redactPermissionInputPreview } from './agent-permissions.js';

export interface LocalNeedsYouSnapshot {
  agents: ReadonlyArray<{ id: string; issueId?: string | null; pendingAskUserQuestion?: unknown }>;
  channelPermissionRequests?: ReadonlyArray<ChannelPermissionRequestSnapshot>;
}

export interface LocalNeedsYouDeps {
  build: () => Promise<NeedsYouFeed>;
  snapshot: () => Promise<LocalNeedsYouSnapshot>;
}

export interface LocalNeedsYouPermissionRequest {
  requestId: string;
  toolName: string;
  description: string;
  inputPreview: string;
  createdAt: string;
}

export interface LocalNeedsYouAgent extends NeedsYouAgent {
  pendingAskUserQuestion?: unknown;
  permissionRequests?: LocalNeedsYouPermissionRequest[];
}

export async function localNeedsYou(
  deps: LocalNeedsYouDeps,
): Promise<{ conversations: unknown[]; agents: LocalNeedsYouAgent[] }> {
  const [feed, snapshot] = await Promise.all([deps.build(), deps.snapshot()]);

  const requestsByAgent = new Map<string, LocalNeedsYouPermissionRequest[]>();
  const issueIdByAgent = new Map<string, string>();
  for (const request of snapshot.channelPermissionRequests ?? []) {
    const entry: LocalNeedsYouPermissionRequest = {
      requestId: request.requestId,
      toolName: request.toolName,
      description: request.description,
      inputPreview: redactPermissionInputPreview(request.inputPreview),
      createdAt: request.createdAt,
    };
    const existing = requestsByAgent.get(request.agentId);
    if (existing) existing.push(entry);
    else requestsByAgent.set(request.agentId, [entry]);
    if (request.issueId && !issueIdByAgent.has(request.agentId)) issueIdByAgent.set(request.agentId, request.issueId);
  }
  for (const list of requestsByAgent.values()) list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const snapshotAgentsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const seenIds = new Set<string>();
  const agents: LocalNeedsYouAgent[] = [];

  for (const agentRow of feed.agents) {
    seenIds.add(agentRow.id);
    const agent: LocalNeedsYouAgent = { ...agentRow };
    const snapshotAgent = snapshotAgentsById.get(agentRow.id);
    if (snapshotAgent?.pendingAskUserQuestion) agent.pendingAskUserQuestion = snapshotAgent.pendingAskUserQuestion;
    const permissionRequests = requestsByAgent.get(agentRow.id);
    if (permissionRequests) {
      agent.permissionRequests = permissionRequests;
      if (!agent.pendingInputKinds.includes('permissionRequest')) agent.pendingInputKinds = [...agent.pendingInputKinds, 'permissionRequest'];
    }
    agents.push(agent);
  }

  for (const [agentId, permissionRequests] of requestsByAgent) {
    if (seenIds.has(agentId)) continue;
    const snapshotAgent = snapshotAgentsById.get(agentId);
    agents.push({
      id: agentId,
      issueId: issueIdByAgent.get(agentId) ?? snapshotAgent?.issueId ?? null,
      pendingInputKinds: ['permissionRequest'],
      permissionRequests,
    });
  }

  agents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { conversations: feed.conversations, agents };
}

export async function handleLocalNeedsYou(deps: LocalNeedsYouDeps): Promise<ReturnType<typeof jsonResponse>> {
  try {
    return jsonResponse(await localNeedsYou(deps));
  } catch (error) {
    console.error('[needs-you] local feed failed:', error instanceof Error ? error.message : String(error));
    return jsonResponse({ error: 'the Needs-You feed could not be built' }, { status: 500 });
  }
}

const needsYouRoute = HttpRouter.add(
  'GET',
  '/api/needs-you',
  Effect.gen(function* () {
    const readModel = yield* ReadModelService;
    return yield* Effect.promise(() =>
      handleLocalNeedsYou({ build: () => buildNeedsYou(), snapshot: () => Effect.runPromise(readModel.getSnapshot) }),
    );
  }),
);

export const needsYouRouteLayer = Layer.mergeAll(needsYouRoute);
