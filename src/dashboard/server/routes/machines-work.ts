/**
 * Work doors (PAN-4651 D-4651-3): the owner routes through which a linked
 * machine starts work on this machine.
 *
 * Every door takes exactly a `machine` credential (403 `machine-only`
 * otherwise), resolves the project on this machine, and compares the caller's
 * git origin slug with that project's slug (case-insensitive). No project, or
 * a different slug, answers 404 `project-missing` naming this machine. The door
 * then runs the existing local path and stamps the caller's environment id on
 * what it created, so the agent fence (`link-fence.ts`) lets an agent on that
 * machine change it later. A caller never chooses a path on this machine: it
 * names a repository, and this machine decides where that repository lives.
 *
 * - `POST /api/machines/work/conversations { gitOrigin, message, model?, harness?, effort?, issueId? }`
 *   → `handleConversationCreate` in the matched project (or the default working
 *   directory, `getDefaultCwd`, when `gitOrigin` is null) → `markConversationStartedBy`. Answers 201 `{ name }`.
 * - `POST /api/machines/work/workers { gitOrigin, issueId, prompt, model?, harness?, effort?, readOnly?, name?, parentId? }`
 *   → project from the issue prefix, origin check → `startWorker` with
 *   `parentId: null` and `startedBy: { environmentId, parentId }` (the caller's
 *   parent lives on the caller's machine). Answers `{ id, cwd, branch }`.
 * - `POST /api/machines/work/issues/:id/start { gitOrigin, model?, harness?, effort? }`
 *   → project from the issue prefix, origin check → `spawnIssueAgentForRoute`,
 *   the same gates and spawn as the dashboard's Start button
 *   (`POST /api/agents`). Answers `{ issueId, agentId }`; a refusal from those
 *   gates passes through unchanged.
 * - `POST /api/machines/work/projects { gitOrigin, cloneUrl, name, issuePrefix, files: [{ path, contentBase64 }] }`
 *   (Add this project there, D-4651-14) → clone + register + write the files
 *   through `startAddProject`; 202 `{ jobId }`, followed with
 *   `GET /api/machines/work/projects/:jobId`. Project files cross only an
 *   operator-level link for the operator actor (403 `project-files-forbidden`).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from 'effect/unstable/http';

import { PARENT_ID_RE, startWorker, type StartWorkerOptions } from '../../../lib/agents/worker/start.js';
import { gitOriginOf, sameGitOrigin } from '../../../lib/anywhere/project-origin.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { markConversationStartedBy } from '../../../lib/overdeck/conversation-provenance.js';
import { generateAiTitle } from '../../../lib/overdeck/conversation-reads.js';
import { handleConversationCreate } from '../../../lib/overdeck/conversation-runtime.js';
import { listProjectsAsync, type ProjectConfig, resolveProjectFromIssue } from '../../../lib/projects.js';
import { jsonResponse } from '../http-helpers.js';
import { type AddProjectRequest, getAddProjectJob, startAddProject, type StartAddProjectResult } from '../services/fleet-add-project.js';
import { spawnIssueAgentForRoute } from './agents/spawn-issue.js';
import { conversationReadDependencies } from './conversations.js';
import { type DashboardCredential, resolveRequestCredential } from './dashboard-auth.js';
import { projectFilesRefusal } from './machines-projects.js';
import { parseStartWorkerBody } from './workers.js';

export type MachineCredential = Extract<DashboardCredential, { kind: 'machine' }>;

export interface WorkDoorDeps {
  listProjects: () => Promise<Array<{ key: string; config: ProjectConfig }>>;
  thisLabel: () => Promise<string>;
}

export const defaultWorkDoorDeps: WorkDoorDeps = {
  listProjects: listProjectsAsync,
  thisLabel: async () => (await ensureEnvironmentIdentity()).label,
};

export type WorkDoorPreflight =
  | { ok: true; credential: MachineCredential; projectKey: string | null }
  | { ok: false; response: HttpServerResponse.HttpServerResponse };

export function machineOnly(): HttpServerResponse.HttpServerResponse {
  return jsonResponse({ code: 'machine-only', error: 'work doors are for linked machines only' }, { status: 403 });
}

/** The 404 every door answers when this machine has no project for the caller's repository. */
export function projectMissing(gitOrigin: string | null, label: string): HttpServerResponse.HttpServerResponse {
  const repository = gitOrigin ?? 'this repository';
  return jsonResponse({ code: 'project-missing', gitOrigin, machine: label, error: `${label} has no project for ${repository}` }, { status: 404 });
}

/**
 * The shared guard. `target.projectKey` is the project the door already
 * resolved (workers and issue starts resolve it from the issue id); when it is
 * `undefined` the project is the local one whose slug equals `gitOrigin`, and a
 * null `gitOrigin` means "no project".
 */
export async function workDoorPreflight(
  credential: DashboardCredential | null,
  target: { gitOrigin: string | null; projectKey?: string | null },
  deps: WorkDoorDeps = defaultWorkDoorDeps,
): Promise<WorkDoorPreflight> {
  if (credential?.kind !== 'machine') {
    return { ok: false, response: machineOnly() };
  }
  const { gitOrigin } = target;
  if (target.projectKey === undefined && gitOrigin === null) return { ok: true, credential, projectKey: null };
  const projects = await deps.listProjects();
  const match = target.projectKey === undefined
    ? projects.filter(({ config }) => sameGitOrigin(gitOriginOf(config), gitOrigin)).sort((a, b) => (a.key < b.key ? -1 : 1))[0]
    : projects.find(({ key, config }) => key === target.projectKey && sameGitOrigin(gitOriginOf(config), gitOrigin));
  if (!match) return { ok: false, response: projectMissing(gitOrigin, await deps.thisLabel()) };
  return { ok: true, credential, projectKey: match.key };
}

/** `gitOrigin` must be present: a slug string or null. */
export function parseGitOrigin(body: Record<string, unknown>): string | null | undefined {
  const value = body['gitOrigin'];
  if (value === null) return null;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined | false {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : false;
}

export function readJsonResponse(response: HttpServerResponse.HttpServerResponse): { status: number; body: unknown } {
  const raw = (response.body as { body?: unknown } | null)?.body;
  const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : typeof raw === 'string' ? raw : '';
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: null };
  }
}

export interface ConversationDoorDeps extends WorkDoorDeps {
  create: (body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
  markStartedBy: (name: string, environmentId: string) => void;
}

const defaultConversationDoorDeps: ConversationDoorDeps = {
  ...defaultWorkDoorDeps,
  create: async (body) => readJsonResponse(await handleConversationCreate(body, {
    generateAiTitle: (name, message) => generateAiTitle(name, message, conversationReadDependencies),
  })),
  markStartedBy: markConversationStartedBy,
};

/** `POST /api/machines/work/conversations`. */
export async function handleWorkConversation(
  credential: DashboardCredential | null,
  raw: unknown,
  deps: ConversationDoorDeps = defaultConversationDoorDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return machineOnly();
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!body) return jsonResponse({ error: 'body must be an object' }, { status: 400 });
  const gitOrigin = parseGitOrigin(body);
  if (gitOrigin === undefined) return jsonResponse({ error: 'gitOrigin must be a repository slug or null' }, { status: 400 });
  if (typeof body['message'] !== 'string') return jsonResponse({ error: 'message must be a string' }, { status: 400 });
  const fields: Record<string, unknown> = { message: body['message'] };
  for (const key of ['model', 'harness', 'effort', 'issueId']) {
    const value = optionalString(body, key);
    if (value === false) return jsonResponse({ error: `${key} must be a string` }, { status: 400 });
    if (value !== undefined) fields[key] = value;
  }
  const preflight = await workDoorPreflight(credential, { gitOrigin }, deps);
  if (!preflight.ok) return preflight.response;
  const created = await deps.create(preflight.projectKey ? { ...fields, projectKey: preflight.projectKey } : fields);
  const name = (created.body as { name?: unknown } | null)?.name;
  if (created.status !== 201 || typeof name !== 'string') return jsonResponse(created.body, { status: created.status });
  deps.markStartedBy(name, preflight.credential.environmentId);
  return jsonResponse({ name }, { status: 201 });
}

export interface WorkerDoorDeps extends WorkDoorDeps {
  projectKeyForIssue: (issueId: string) => Promise<string | null>;
  start: (options: StartWorkerOptions) => Promise<{ id: string; cwd: string; branch: string | null }>;
}

const defaultWorkerDoorDeps: WorkerDoorDeps = {
  ...defaultWorkDoorDeps,
  projectKeyForIssue: async (issueId) => (await Effect.runPromise(resolveProjectFromIssue(issueId)))?.projectKey ?? null,
  start: startWorker,
};

/** `POST /api/machines/work/workers`. */
export async function handleWorkWorker(
  credential: DashboardCredential | null,
  raw: unknown,
  deps: WorkerDoorDeps = defaultWorkerDoorDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return machineOnly();
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!body) return jsonResponse({ error: 'body must be an object' }, { status: 400 });
  const gitOrigin = parseGitOrigin(body);
  if (gitOrigin === undefined) return jsonResponse({ error: 'gitOrigin must be a repository slug or null' }, { status: 400 });
  const parentId = body['parentId'] ?? null;
  if (parentId !== null && (typeof parentId !== 'string' || !PARENT_ID_RE.test(parentId))) {
    return jsonResponse({ error: 'parentId must be an agent id or conversation' }, { status: 400 });
  }
  const { gitOrigin: _origin, parentId: _parent, ...workerBody } = body;
  const parsed = parseStartWorkerBody(workerBody);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });
  const projectKey = await deps.projectKeyForIssue(parsed.value.issueId).catch(() => null);
  const preflight = await workDoorPreflight(credential, { gitOrigin, projectKey }, deps);
  if (!preflight.ok) return preflight.response;
  try {
    const { id, cwd, branch } = await deps.start({
      ...parsed.value,
      parentId: null,
      startedBy: { environmentId: preflight.credential.environmentId, parentId },
    });
    return jsonResponse({ id, cwd, branch });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export interface IssueStartDoorDeps<R> extends WorkDoorDeps {
  projectKeyForIssue: (issueId: string) => Promise<string | null>;
  spawn: (input: { body: Record<string, unknown>; internalRequest: false }) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>;
}

const defaultIssueStartDoorDeps = {
  ...defaultWorkDoorDeps,
  projectKeyForIssue: defaultWorkerDoorDeps.projectKeyForIssue,
  spawn: spawnIssueAgentForRoute,
};

/** `POST /api/machines/work/issues/:id/start`. */
export function handleWorkIssueStart<R>(
  credential: DashboardCredential | null,
  issueId: string,
  raw: unknown,
  deps: IssueStartDoorDeps<R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R> {
  return Effect.gen(function* () {
    if (credential?.kind !== 'machine') return machineOnly();
    const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if (!body) return jsonResponse({ error: 'body must be an object' }, { status: 400 });
    const gitOrigin = parseGitOrigin(body);
    if (gitOrigin === undefined) return jsonResponse({ error: 'gitOrigin must be a repository slug or null' }, { status: 400 });
    const fields: Record<string, unknown> = { issueId };
    for (const key of ['model', 'harness', 'effort']) {
      const value = optionalString(body, key);
      if (value === false) return jsonResponse({ error: `${key} must be a string` }, { status: 400 });
      if (value !== undefined) fields[key] = value;
    }
    const projectKey = yield* Effect.promise(() => deps.projectKeyForIssue(issueId).catch(() => null));
    const preflight = yield* Effect.promise(() => workDoorPreflight(credential, { gitOrigin, projectKey }, deps));
    if (!preflight.ok) return preflight.response;
    const response = yield* deps.spawn({ body: fields, internalRequest: false });
    if (response.status !== 200) return response;
    return jsonResponse({ issueId: issueId.toUpperCase(), agentId: `agent-${issueId.toLowerCase()}` });
  });
}

export interface ProjectDoorDeps {
  start: (request: AddProjectRequest) => Promise<StartAddProjectResult>;
}

/** A relative path without `..` (the writer re-checks symlinks and escapes). */
function isRelativeFilePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\0') || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split(/[\\/]+/).includes('..');
}

/** `POST /api/machines/work/projects`. */
export async function handleWorkProject(
  credential: DashboardCredential | null,
  raw: unknown,
  deps: ProjectDoorDeps = { start: (request) => startAddProject(request) },
): Promise<HttpServerResponse.HttpServerResponse> {
  if (credential?.kind !== 'machine') return machineOnly();
  const refused = projectFilesRefusal(credential);
  if (refused) return refused;
  const body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!body || typeof body['cloneUrl'] !== 'string' || typeof body['name'] !== 'string' || typeof body['gitOrigin'] !== 'string') {
    return jsonResponse({ error: 'body must be { gitOrigin, cloneUrl, name, issuePrefix, files }' }, { status: 400 });
  }
  const rawFiles = body['files'] ?? [];
  if (!Array.isArray(rawFiles)) return jsonResponse({ error: 'files must be a list' }, { status: 400 });
  const files: AddProjectRequest['files'] = [];
  for (const file of rawFiles as Array<{ path?: unknown; contentBase64?: unknown }>) {
    if (typeof file?.path !== 'string' || !isRelativeFilePath(file.path) || typeof file.contentBase64 !== 'string') {
      return jsonResponse({ code: 'bad-path', error: `files[].path must be a relative path without ..; got ${JSON.stringify(file?.path)}` }, { status: 400 });
    }
    files.push({ path: file.path, contents: Buffer.from(file.contentBase64, 'base64') });
  }
  const issuePrefix = typeof body['issuePrefix'] === 'string' ? body['issuePrefix'] : null;
  const started = await deps.start({ cloneUrl: body['cloneUrl'], name: body['name'], issuePrefix, files });
  return started.ok ? jsonResponse({ jobId: started.jobId }, { status: 202 }) : jsonResponse(started.body, { status: started.status });
}

/** `GET /api/machines/work/projects/:jobId`: the add job a linked machine started here. */
export function handleWorkProjectJob(credential: DashboardCredential | null, jobId: string): HttpServerResponse.HttpServerResponse {
  if (credential?.kind !== 'machine') return machineOnly();
  const job = getAddProjectJob(jobId);
  return job ? jsonResponse(job) : jsonResponse({ code: 'unknown-job', error: 'Unknown add job' }, { status: 404 });
}

export const readWorkDoorBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
});

const workConversationRoute = HttpRouter.add(
  'POST',
  '/api/machines/work/conversations',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readWorkDoorBody;
    return yield* Effect.promise(() => handleWorkConversation(resolveRequestCredential(request), body));
  }),
);

const workWorkerRoute = HttpRouter.add(
  'POST',
  '/api/machines/work/workers',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readWorkDoorBody;
    return yield* Effect.promise(() => handleWorkWorker(resolveRequestCredential(request), body));
  }),
);

const workIssueStartRoute = HttpRouter.add(
  'POST',
  '/api/machines/work/issues/:id/start',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const body = yield* readWorkDoorBody;
    return yield* handleWorkIssueStart(resolveRequestCredential(request), params['id'] ?? '', body, defaultIssueStartDoorDeps);
  }),
);

const workProjectRoute = HttpRouter.add(
  'POST',
  '/api/machines/work/projects',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readWorkDoorBody;
    return yield* Effect.promise(() => handleWorkProject(resolveRequestCredential(request), body));
  }),
);

const workProjectJobRoute = HttpRouter.add(
  'GET',
  '/api/machines/work/projects/:jobId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return handleWorkProjectJob(resolveRequestCredential(request), (yield* HttpRouter.params)['jobId'] ?? '');
  }),
);

export const machinesWorkRouteLayer = Layer.mergeAll(workConversationRoute, workWorkerRoute, workIssueStartRoute, workProjectRoute, workProjectJobRoute);
