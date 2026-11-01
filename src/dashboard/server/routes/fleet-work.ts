/**
 * Fleet work routes (PAN-4651 D-4651-10, D-4651-12): this machine's browser,
 * CLI and MCP start work on any machine through them. Every fleet route
 * refuses a request that arrives through a secure channel (no chained hops,
 * `refuseFleetRequest`) and then applies the usual dashboard auth.
 *
 * - `POST /api/fleet/placement { gitOrigin: string | null, needs: string[] }`
 *   → Auto placement over this machine and its links: `{ ok: true,
 *   environmentId, label, self, reason, rejections }` or `{ ok: false, rejections }`.
 * - `POST /api/fleet/conversations { machine?, needs?, projectKey?, message, model?, harness?, effort?, issueId? }`
 *   → this machine: `handleConversationCreate`; another machine: its
 *   conversation work door with the local project's git origin slug, then one
 *   linked-list fetch so the new row lists at once. Answers 201
 *   `{ conversation: '<name>' | '@<env>/<name>', machine: { environmentId, label, self }, reason }`.
 *
 * - `POST /api/fleet/workers { machine, needs?, issueId, prompt, model?, harness?, effort?, readOnly?, name?, parentId? }`
 *   → this machine: `startWorker`; another machine: a stand-in directory with
 *   a local id, the owner's worker work door, then `remote.json` and the
 *   follower. Answers `{ id, machine, reason, remote }`.
 *
 * - `POST /api/fleet/workers/:id/stop` → stops the worker a stand-in stands
 *   for on its owner, then marks the stand-in `stopped`.
 *
 * The actor a forwarded call carries: `operator` for the browser and operator
 * CLIs, `{ agentId }` for an agent sender (`x-overdeck-sender`), and for an
 * `odk_` token credential `operator` with a ceiling of the token's scopes
 * (D-4651-17), derived from the resolved credential, never from a header.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import type { AccessTokenScope } from '../../../lib/access-tokens.js';
import { agentsRoot, allocateWorkerId, workerDir } from '../../../lib/agents/worker/ids.js';
import { readRemoteStandIn, type RemoteStandIn, writeRemoteStandIn } from '../../../lib/agents/worker/remote-standin.js';
import { PARENT_ID_RE, startWorker, type StartWorkerOptions } from '../../../lib/agents/worker/start.js';
import { removeAgentStateDir } from '../../../lib/agents/state-dir-removal.js';
import { type LinkActorInit, linkFetch } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { TAG_PATTERN } from '../../../lib/anywhere/machine-capabilities.js';
import { gitOriginOf } from '../../../lib/anywhere/project-origin.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { getProjectSync, resolveProjectFromIssue } from '../../../lib/projects.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { actorForSender, SENDER_HEADER } from '../linked-conversation-proxy.js';
import { defaultFleetTargetDeps, type FleetTarget, type FleetTargetDeps, placeAuto, resolveTargetMachine } from '../services/fleet-target.js';
import { currentLinkedConversationsSync } from '../services/linked-conversations-sync.js';
import { currentRemoteWorkerFollower } from '../services/remote-worker-follower.js';
import { credentialScopes, type DashboardCredential, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';
import { readJsonResponse } from './machines-work.js';
import { parseStartWorkerBody } from './workers.js';

/** `needs` as a list of capability tags; a comma-separated string is accepted too. */
export function parseNeeds(raw: unknown): string[] | string {
  if (raw === undefined || raw === null) return [];
  const list = typeof raw === 'string' ? raw.split(',') : raw;
  if (!Array.isArray(list) || !list.every((tag) => typeof tag === 'string')) return 'needs must be a list of tags';
  const tags = [...new Set(list.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''))];
  const invalid = tags.find((tag) => !TAG_PATTERN.test(tag));
  return invalid === undefined ? tags : `needs: ${JSON.stringify(invalid)} is not a valid tag`;
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

/** `POST /api/fleet/placement`. */
export async function handleFleetPlacement(raw: unknown, deps: FleetTargetDeps = defaultFleetTargetDeps()): Promise<HttpServerResponse.HttpServerResponse> {
  const body = asObject(raw) ?? {};
  const gitOrigin = body['gitOrigin'] ?? null;
  if (gitOrigin !== null && typeof gitOrigin !== 'string') return jsonResponse({ error: 'gitOrigin must be a repository slug or null' }, { status: 400 });
  const needs = parseNeeds(body['needs']);
  if (typeof needs === 'string') return jsonResponse({ error: needs }, { status: 400 });
  return jsonResponse(await placeAuto(gitOrigin, needs, deps));
}

/** Who a forwarded fleet call acts for; null for a malformed sender. */
export interface FleetCaller {
  actor: LinkActorInit;
  ceiling?: AccessTokenScope[];
}

export function fleetCaller(credential: DashboardCredential | null, sender: string | undefined): FleetCaller | null {
  if (credential?.kind === 'token') {
    return { actor: 'operator', ceiling: credentialScopes(credential).filter((scope): scope is AccessTokenScope => scope !== 'admin') as AccessTokenScope[] };
  }
  const actor = actorForSender(sender);
  return actor === null ? null : { actor };
}

/** A work door gets this long to create the conversation or worker on the owner. */
export const WORK_DOOR_TIMEOUT_MS = 30_000;

export interface FleetSpawnDeps {
  resolveTarget: (machine: string | undefined, gitOrigin: string | null, needs: readonly string[]) => Promise<FleetTarget>;
  projectOrigin: (projectKey: string) => { gitOrigin: string | null } | null;
  thisLabel: () => Promise<string>;
  createLocal: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  fetchPeer: (environmentId: string, path: string, init: { method: string; body: unknown; actor: LinkActorInit; ceiling?: AccessTokenScope[]; signal: AbortSignal }) => Promise<{ status: number; json: unknown }>;
  refreshLinked: (link: MachineLink) => Promise<void>;
}

async function defaultCreateLocal(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const [{ handleConversationCreate }, { generateAiTitle }, { conversationReadDependencies }] = await Promise.all([
    import('../../../lib/overdeck/conversation-runtime.js'),
    import('../../../lib/overdeck/conversation-reads.js'),
    import('./conversations.js'),
  ]);
  return readJsonResponse(await handleConversationCreate(body, {
    generateAiTitle: (name, message) => generateAiTitle(name, message, conversationReadDependencies),
  }));
}

export const defaultFleetSpawnDeps = (): FleetSpawnDeps => ({
  resolveTarget: (machine, gitOrigin, needs) => resolveTargetMachine(machine, gitOrigin, needs),
  projectOrigin: (projectKey) => {
    const project = getProjectSync(projectKey);
    return project ? { gitOrigin: gitOriginOf(project) } : null;
  },
  thisLabel: async () => (await ensureEnvironmentIdentity()).label,
  createLocal: defaultCreateLocal,
  fetchPeer: (environmentId, path, init) => linkFetch(environmentId, path, init),
  refreshLinked: async (link) => { await currentLinkedConversationsSync()?.onConnect(link); },
});

/** Post to a work door on the owner with the caller's actor; a timeout answers as an unreachable machine. */
export async function postWorkDoor(
  deps: Pick<FleetSpawnDeps, 'fetchPeer'>,
  link: MachineLink,
  path: string,
  body: unknown,
  caller: FleetCaller,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORK_DOOR_TIMEOUT_MS);
  try {
    return await deps.fetchPeer(link.environmentId, path, { method: 'POST', body, actor: caller.actor, ...(caller.ceiling ? { ceiling: caller.ceiling } : {}), signal: controller.signal });
  } catch (error) {
    const message = controller.signal.aborted ? `did not answer within ${WORK_DOOR_TIMEOUT_MS / 1000} s` : (error as Error).message;
    return { status: 503, json: { code: 'machine-unreachable', error: `${link.label}: ${message}` } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An owner's refusal, passed through: `project-missing` gains the command that
 * adds the project there; an owner without work doors (404 without a code, or
 * the older gate's `403 insufficient_scope admin`) answers `peer-too-old`.
 */
export function ownerRefusal(status: number, json: unknown, link: MachineLink, context: { thisLabel: string; projectKey: string | null }): HttpServerResponse.HttpServerResponse {
  const body = (json ?? {}) as { code?: unknown; error?: unknown; missingScope?: unknown; gitOrigin?: unknown };
  if (status === 404 && body.code === 'project-missing') {
    const key = context.projectKey ?? '<project>';
    const error = `${link.label} has no project for ${String(body.gitOrigin ?? 'this repository')}. Add it with: pan machines add-project ${context.thisLabel} ${key} --to ${link.label}`;
    return jsonResponse({ ...body, error }, { status: 404 });
  }
  if ((status === 404 && body.code === undefined) || (status === 403 && body.error === 'insufficient_scope' && body.missingScope === 'admin')) {
    return jsonResponse({ code: 'peer-too-old', error: `${link.label} needs a newer Overdeck to start work for another machine` }, { status: 409 });
  }
  return jsonResponse(json, { status });
}

function optionalStrings(body: Record<string, unknown>, keys: readonly string[]): Record<string, string> | string {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') return `${key} must be a string`;
    fields[key] = value;
  }
  return fields;
}

const machineOf = (target: Extract<FleetTarget, { ok: true }>) => ({ environmentId: target.environmentId, label: target.label, self: target.self });

/** `POST /api/fleet/conversations`. */
export async function handleFleetConversation(raw: unknown, caller: FleetCaller, deps: FleetSpawnDeps = defaultFleetSpawnDeps()): Promise<HttpServerResponse.HttpServerResponse> {
  const body = asObject(raw);
  if (!body) return jsonResponse({ error: 'body must be an object' }, { status: 400 });
  if (typeof body['message'] !== 'string') return jsonResponse({ error: 'message must be a string' }, { status: 400 });
  const fields = optionalStrings(body, ['machine', 'projectKey', 'model', 'harness', 'effort', 'issueId']);
  if (typeof fields === 'string') return jsonResponse({ error: fields }, { status: 400 });
  const needs = parseNeeds(body['needs']);
  if (typeof needs === 'string') return jsonResponse({ error: needs }, { status: 400 });
  const { machine, projectKey, ...options } = fields;
  const project = projectKey ? deps.projectOrigin(projectKey) : null;
  if (projectKey && !project) return jsonResponse({ code: 'unknown-project', error: `No project ${projectKey} on this machine` }, { status: 404 });
  const gitOrigin = project?.gitOrigin ?? null;

  const target = await deps.resolveTarget(machine, gitOrigin, needs);
  if (!target.ok) return jsonResponse(target.body, { status: target.status });
  const message = body['message'];
  if (target.self) {
    const created = await deps.createLocal({ ...options, message, ...(projectKey ? { projectKey } : {}) });
    const name = (created.body as { name?: unknown } | null)?.name;
    if (created.status !== 201 || typeof name !== 'string') return jsonResponse(created.body, { status: created.status });
    return jsonResponse({ conversation: name, machine: machineOf(target), reason: target.reason }, { status: 201 });
  }
  if (projectKey && gitOrigin === null) {
    return jsonResponse({ code: 'project-has-no-origin', error: `${projectKey} has no github_repo or gitlab_repo, so ${target.label} cannot find it` }, { status: 409 });
  }
  const answer = await postWorkDoor(deps, target.link, '/api/machines/work/conversations', { ...options, message, gitOrigin }, caller);
  const name = (answer.json as { name?: unknown } | null)?.name;
  if (answer.status !== 201 || typeof name !== 'string') {
    return ownerRefusal(answer.status, answer.json, target.link, { thisLabel: await deps.thisLabel(), projectKey: projectKey ?? null });
  }
  await deps.refreshLinked(target.link).catch(() => undefined);
  return jsonResponse({ conversation: `@${target.environmentId}/${name}`, machine: machineOf(target), reason: target.reason }, { status: 201 });
}

export interface FleetWorkerDeps extends FleetSpawnDeps {
  issueOrigin: (issueId: string) => Promise<{ gitOrigin: string | null } | null>;
  startLocal: (options: StartWorkerOptions) => Promise<{ id: string }>;
  allocate: (issueId: string) => Promise<string>;
  writeStandIn: (localId: string, standIn: RemoteStandIn) => Promise<void>;
  dropStandIn: (localId: string) => Promise<void>;
  follow: (localId: string) => void;
  now: () => Date;
}

export const defaultFleetWorkerDeps = (): FleetWorkerDeps => ({
  ...defaultFleetSpawnDeps(),
  issueOrigin: async (issueId) => {
    const resolved = await Effect.runPromise(resolveProjectFromIssue(issueId)).catch(() => null);
    const project = resolved ? getProjectSync(resolved.projectKey) : null;
    return project ? { gitOrigin: gitOriginOf(project) } : null;
  },
  startLocal: (options) => startWorker(options),
  allocate: allocateWorkerId,
  writeStandIn: writeRemoteStandIn,
  dropStandIn: (localId) => removeAgentStateDir(workerDir(localId), agentsRoot()).then(() => undefined),
  follow: (localId) => currentRemoteWorkerFollower()?.track(localId),
  now: () => new Date(),
});

/** `POST /api/fleet/workers`. */
export async function handleFleetWorker(raw: unknown, caller: FleetCaller, deps: FleetWorkerDeps = defaultFleetWorkerDeps()): Promise<HttpServerResponse.HttpServerResponse> {
  const body = asObject(raw);
  if (!body) return jsonResponse({ error: 'body must be an object' }, { status: 400 });
  const { machine, needs: rawNeeds, parentId: rawParent, ...workerFields } = body;
  if (machine !== undefined && machine !== null && typeof machine !== 'string') return jsonResponse({ error: 'machine must be a string' }, { status: 400 });
  const needs = parseNeeds(rawNeeds);
  if (typeof needs === 'string') return jsonResponse({ error: needs }, { status: 400 });
  const parentId = rawParent ?? null;
  if (parentId !== null && (typeof parentId !== 'string' || !PARENT_ID_RE.test(parentId))) {
    return jsonResponse({ error: 'parentId must be an agent id or conversation' }, { status: 400 });
  }
  const parsed = parseStartWorkerBody(workerFields);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
  const { issueId } = parsed.value;
  const project = await deps.issueOrigin(issueId);
  const gitOrigin = project?.gitOrigin ?? null;

  const target = await deps.resolveTarget(typeof machine === 'string' ? machine : undefined, gitOrigin, needs);
  if (!target.ok) return jsonResponse(target.body, { status: target.status });
  if (target.self) {
    try {
      const { id } = await deps.startLocal({ ...parsed.value, parentId });
      return jsonResponse({ id, machine: machineOf(target), reason: target.reason, remote: false });
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
  if (!project || gitOrigin === null) {
    return jsonResponse({ code: 'project-has-no-origin', error: `${issueId}'s project has no github_repo or gitlab_repo here, so ${target.label} cannot find it` }, { status: 409 });
  }
  const localId = await deps.allocate(issueId);
  const { parentId: _ignored, ...door } = parsed.value;
  const answer = await postWorkDoor(deps, target.link, '/api/machines/work/workers', { ...door, gitOrigin, parentId }, caller);
  const remoteId = (answer.json as { id?: unknown } | null)?.id;
  if (answer.status !== 200 || typeof remoteId !== 'string') {
    await deps.dropStandIn(localId).catch(() => undefined);
    return ownerRefusal(answer.status, answer.json, target.link, { thisLabel: await deps.thisLabel(), projectKey: null });
  }
  await deps.writeStandIn(localId, {
    v: 1, environmentId: target.environmentId, label: target.label, remoteId, parentId, issueId: issueId.toUpperCase(),
    createdAt: deps.now().toISOString(), state: 'running', lastSeq: 0, lastSeenAt: null, lastAssistantMessage: null, idleAgeMs: null, unreachableSince: null,
  });
  deps.follow(localId);
  return jsonResponse({ id: localId, machine: machineOf(target), reason: target.reason, remote: true });
}

export interface FleetWorkerStopDeps {
  read: (localId: string) => Promise<RemoteStandIn | null>;
  write: (localId: string, standIn: RemoteStandIn) => Promise<void>;
  fetchPeer: FleetSpawnDeps['fetchPeer'];
}

const defaultFleetWorkerStopDeps = (): FleetWorkerStopDeps => ({
  read: readRemoteStandIn,
  write: writeRemoteStandIn,
  fetchPeer: (environmentId, path, init) => linkFetch(environmentId, path, init),
});

/** `POST /api/fleet/workers/:id/stop`. */
export async function handleFleetWorkerStop(localId: string, caller: FleetCaller, deps: FleetWorkerStopDeps = defaultFleetWorkerStopDeps()): Promise<HttpServerResponse.HttpServerResponse> {
  const standIn = await deps.read(localId);
  if (!standIn) return jsonResponse({ code: 'unknown-stand-in', error: `${localId} is not a worker on another machine; stop it with POST /api/workers/${localId}/stop` }, { status: 404 });
  const link = { environmentId: standIn.environmentId, label: standIn.label } as MachineLink;
  const answer = await postWorkDoor({ fetchPeer: deps.fetchPeer }, link, `/api/workers/${encodeURIComponent(standIn.remoteId)}/stop`, {}, caller);
  if (answer.status !== 200 && !(answer.status === 404 && (answer.json as { code?: unknown } | null)?.code === 'unknown-worker')) {
    return jsonResponse(answer.json, { status: answer.status });
  }
  await deps.write(localId, { ...standIn, state: 'stopped' });
  return jsonResponse({ stopped: true });
}

export const readFleetBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
});

/** The gate every fleet write route shares: no channel caller, then auth with CSRF for cookies. */
export const fleetWriteGate = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnsafeDashboardMutationRequest(request));
});

const placementRoute = HttpRouter.add(
  'POST',
  '/api/fleet/placement',
  Effect.gen(function* () {
    const refused = yield* fleetWriteGate;
    if (refused) return refused;
    const body = yield* readFleetBody;
    return yield* Effect.promise(() => handleFleetPlacement(body));
  }),
);

/** The caller of a fleet spawn route from its credential and sender header. */
export const fleetCallerOf = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const raw = (request.headers as Record<string, string | string[] | undefined>)[SENDER_HEADER];
  return fleetCaller(resolveRequestCredential(request), Array.isArray(raw) ? raw[0] : raw);
});

const conversationsRoute = HttpRouter.add(
  'POST',
  '/api/fleet/conversations',
  Effect.gen(function* () {
    const refused = yield* fleetWriteGate;
    if (refused) return refused;
    const caller = yield* fleetCallerOf;
    if (!caller) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
    const body = yield* readFleetBody;
    return yield* Effect.promise(() => handleFleetConversation(body, caller));
  }),
);

const workersRoute = HttpRouter.add(
  'POST',
  '/api/fleet/workers',
  Effect.gen(function* () {
    const refused = yield* fleetWriteGate;
    if (refused) return refused;
    const caller = yield* fleetCallerOf;
    if (!caller) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
    const body = yield* readFleetBody;
    return yield* Effect.promise(() => handleFleetWorker(body, caller));
  }),
);

const workerStopRoute = HttpRouter.add(
  'POST',
  '/api/fleet/workers/:id/stop',
  Effect.gen(function* () {
    const refused = yield* fleetWriteGate;
    if (refused) return refused;
    const caller = yield* fleetCallerOf;
    if (!caller) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
    const params = yield* HttpRouter.params;
    return yield* Effect.promise(() => handleFleetWorkerStop(params['id'] ?? '', caller));
  }),
);

export const fleetWorkRouteLayer = Layer.mergeAll(placementRoute, conversationsRoute, workersRoute, workerStopRoute);
