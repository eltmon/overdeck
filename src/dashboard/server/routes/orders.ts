import type {
  OrderBook,
  OrderBookItem,
  OrderBookLane,
  OrderBookSettings,
} from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { backlogCandidates, computeBookProgress, getBook, getBookAsync, listBooks, liveOrderIssueLookup } from '../../../lib/orders/resolver.js';
import type { OrderIssueLookup, OrderIssueState } from '../../../lib/orders/types.js';
import { createOrderPrdLookup, hasOrderIssuePrd, validateBookForStart } from '../../../lib/orders/validate.js';
import {
  addItems,
  createBook,
  moveItem,
  removeItem,
  renameBook,
  setItemRequirements,
  setSettings,
  setStatus,
  type NewOrderBookItem,
} from '../../../lib/orders/writer.js';
import { findProjectByPathSync, getProjectSync, listProjectsSync, resolveProjectPath, type ProjectConfig } from '../../../lib/projects.js';
import { projectKey as resolveCanonicalProjectKey } from '../../../lib/project-key.js';
import { resolveStateReadHomeAsync, resolveStateReadHomeSync } from '../../../lib/state-read-home.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

interface RouteResult {
  status: number;
  body: unknown;
}

interface StartOrderBookResult {
  runId: string;
}

export interface OrdersRouteDeps {
  stateRoot?: () => string;
  issueLookup?: OrderIssueLookup;
  hasPrd?: (issueId: string) => boolean;
  now?: () => Date;
  actor?: () => string;
  startOrderBook?: (book: OrderBook) => Promise<StartOrderBookResult>;
}

interface OrdersReadSnapshot {
  stateRoot: string;
  project?: string;
  books: OrderBook[];
  issueState: ReadonlyMap<string, OrderIssueState>;
  issueLookup: OrderIssueLookup;
  hasPrd: (issueId: string) => boolean;
}

interface JsonBodyResult {
  ok: boolean;
  body: Record<string, unknown>;
}

interface OrdersStateRoot {
  stateRoot: string;
  project?: string;
  projectConfig?: ProjectConfig;
}

function resolveOrdersStateRoot(deps: OrdersRouteDeps, projectKey?: string): OrdersStateRoot {
  if (deps.stateRoot) return { stateRoot: deps.stateRoot() };
  if (projectKey !== undefined) {
    const project = getProjectSync(projectKey);
    if (!project) throw new Error(`Unknown project: ${projectKey}`);
    return {
      stateRoot: resolveStateReadHomeSync(project, projectKey).root,
      project: projectKey,
      projectConfig: project,
    };
  }
  const project = findProjectByPathSync(process.cwd());
  if (!project) throw new Error(`No configured project contains ${process.cwd()}`);
  return {
    stateRoot: resolveStateReadHomeSync(project).root,
    project: resolveCanonicalProjectKey(project),
    projectConfig: project,
  };
}

function errorResult(error: unknown): RouteResult {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return { status: 404, body: { error: message } };
  if (/already (exists|belongs|running|active)|multiple non-complete/i.test(message)) {
    return { status: 409, body: { error: message } };
  }
  if (/invalid|required|must be|cannot be empty|positive integer|server-controlled|may only transition|unknown project/i.test(message)) {
    return { status: 400, body: { error: message } };
  }
  return { status: 500, body: { error: message } };
}

async function routeResult(action: () => Promise<unknown>): Promise<RouteResult> {
  try {
    return { status: 200, body: await action() };
  } catch (error) {
    return errorResult(error);
  }
}

function resultResponse(result: RouteResult) {
  return jsonResponse(result.body, { status: result.status });
}

function requireBook(stateRoot: string, bookId: string): OrderBook {
  const book = getBook(stateRoot, bookId);
  if (!book) throw new Error(`Order book not found: ${bookId}`);
  return book;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
  return value;
}

function lane(value: unknown, fallback?: OrderBookLane): OrderBookLane {
  if (value === undefined && fallback) return fallback;
  if (value !== 'A' && value !== 'B') throw new Error('lane must be A or B');
  return value;
}

function positiveInteger(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`);
  return Number(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value.map((entry) => entry.trim().toUpperCase());
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function settingsPatch(value: unknown): Partial<OrderBookSettings> {
  const raw = record(value, 'settings');
  if ('postureSetAt' in raw || 'postureSetBy' in raw) {
    throw new Error('postureSetAt and postureSetBy are server-controlled');
  }
  const result: Partial<OrderBookSettings> = {};
  if ('laneAConcurrency' in raw) {
    result.laneAConcurrency = positiveInteger(raw['laneAConcurrency'], 'laneAConcurrency');
  }
  if ('briefOverlay' in raw) result.briefOverlay = optionalString(raw['briefOverlay'], 'briefOverlay');
  if ('posture' in raw) {
    if (raw['posture'] !== 'open' && raw['posture'] !== 'drain') {
      throw new Error('posture must be open or drain');
    }
    result.posture = raw['posture'];
  }
  if ('postureReason' in raw) result.postureReason = optionalString(raw['postureReason'], 'postureReason');
  return result;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'order-book';
}

function nextBookId(stateRoot: string, name: string, now: Date): string {
  const base = `${now.toISOString().slice(0, 10)}-${slugify(name)}`;
  if (!getBook(stateRoot, base)) return base;
  let suffix = 2;
  while (getBook(stateRoot, `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function buildOrdersReadSnapshot(deps: OrdersRouteDeps, projectKey?: string): OrdersReadSnapshot {
  const { stateRoot, project } = resolveOrdersStateRoot(deps, projectKey);
  const books = listBooks(stateRoot);
  const issueIds = [...new Set(books.flatMap((book) => book.items.flatMap((item) => [item.issue, ...item.prereqs])))];
  const issueState = (deps.issueLookup ?? liveOrderIssueLookup)(issueIds);
  const issueLookup: OrderIssueLookup = (requested) => new Map(requested.flatMap((issueId) => {
    const state = issueState.get(issueId.toUpperCase());
    return state ? [[issueId.toUpperCase(), state] as const] : [];
  }));
  return {
    stateRoot,
    project,
    books,
    issueState,
    issueLookup,
    hasPrd: deps.hasPrd ?? createOrderPrdLookup(stateRoot),
  };
}

function enrichedBook(book: OrderBook, deps: OrdersRouteDeps, snapshot?: OrdersReadSnapshot, projectKey?: string) {
  const resolved = snapshot ?? resolveOrdersStateRoot(deps, projectKey);
  const stateRoot = resolved.stateRoot;
  const hasPrd = snapshot?.hasPrd ?? deps.hasPrd ?? ((issueId: string) => hasOrderIssuePrd(stateRoot, issueId));
  const issueLookup = snapshot?.issueLookup ?? deps.issueLookup;
  const prerequisiteIds = [...new Set(book.items.flatMap((item) => item.prereqs.map((prereq) => prereq.toUpperCase())))];
  const prerequisiteState = snapshot?.issueState ?? issueLookup?.(prerequisiteIds) ?? new Map();
  return {
    ...book,
    ...(resolved.project !== undefined ? { project: resolved.project } : {}),
    progress: computeBookProgress(book, issueLookup),
    validation: validateBookForStart(stateRoot, book, {
      issueLookup,
      hasPrd,
      books: snapshot?.books,
    }),
    itemReadiness: Object.fromEntries(book.items.map((item) => [item.issue, { hasPrd: hasPrd(item.issue) }])),
    prerequisiteTerminal: Object.fromEntries(prerequisiteIds.map((issue) => {
      const state = prerequisiteState.get(issue);
      return [issue, state ? !state.open || state.parked : false];
    })),
  };
}

function parseItems(book: OrderBook, value: unknown): NewOrderBookItem[] {
  const rawItems = Array.isArray(value) ? value : [value];
  if (rawItems.length === 0) throw new Error('items is required');
  const laneCounts = new Map<OrderBookLane, number>([
    ['A', book.items.filter((item) => item.lane === 'A').length],
    ['B', book.items.filter((item) => item.lane === 'B').length],
  ]);

  return rawItems.map((entry, index) => {
    const raw = record(entry, `items[${index}]`);
    const itemLane = lane(raw['lane'], 'A');
    const nextOrder = (laneCounts.get(itemLane) ?? 0) + 1;
    laneCounts.set(itemLane, nextOrder);
    const planAtPickup = optionalBoolean(raw['planAtPickup'], 'planAtPickup');
    return {
      issue: requireString(raw['issue'], 'issue').toUpperCase(),
      lane: itemLane,
      order: positiveInteger(raw['order'], 'order', nextOrder),
      prereqs: stringArray(raw['prereqs'], 'prereqs'),
      reVerify: optionalBoolean(raw['reVerify'], 'reVerify') ?? false,
      ...(planAtPickup === undefined ? {} : { planAtPickup }),
    };
  });
}

function previewBrief(book: OrderBook): string {
  const lines = [
    `# Special orders: ${book.name}`,
    '',
    `Order book: ${book.id}`,
    `Posture: ${book.settings.posture.toUpperCase()}`,
    '',
    'This order book defines the operator-released scope. Standard flywheel doctrine and the standard brief remain in force.',
  ];
  for (const laneName of ['A', 'B'] as const) {
    lines.push('', `## Lane ${laneName}`);
    const items = book.items
      .filter((item) => item.lane === laneName)
      .sort((left, right) => left.order - right.order);
    if (items.length === 0) {
      lines.push('- Empty');
      continue;
    }
    for (const item of items) {
      const flags = [
        item.prereqs.length > 0 ? `after ${item.prereqs.join(', ')}` : '',
        item.reVerify ? 're-verify PRD' : '',
        item.planAtPickup ? 'plan at pickup' : '',
      ].filter(Boolean);
      lines.push(`- ${laneName}${item.order} ${item.issue}${flags.length ? ` — ${flags.join('; ')}` : ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function defaultStartOrderBook(book: OrderBook, project: ProjectConfig): Promise<StartOrderBookResult> {
  const { startFlywheelRun } = await import('../../../cli/commands/flywheel.js');
  return startFlywheelRun({ cwd: resolveProjectPath(project), orders: book.id });
}

export async function getOrdersPayload(deps: OrdersRouteDeps = {}, projectKey?: string): Promise<RouteResult> {
  return routeResult(async () => {
    const snapshot = buildOrdersReadSnapshot(deps, projectKey);
    return {
      ...(snapshot.project !== undefined ? { project: snapshot.project } : {}),
      books: snapshot.books.map((book) => enrichedBook(book, deps, snapshot)),
    };
  });
}

export async function postOrderPayload(
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const { stateRoot } = resolveOrdersStateRoot(deps, projectKey);
    const name = requireString(body['name'], 'name');
    const id = body['id'] === undefined
      ? nextBookId(stateRoot, name, (deps.now ?? (() => new Date()))())
      : requireString(body['id'], 'id');
    const settings = body['settings'] === undefined ? undefined : settingsPatch(body['settings']);
    return enrichedBook(await createBook(stateRoot, { id, name, settings }), deps, undefined, projectKey);
  });
}

export async function getOrderPayload(
  bookId: string,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const primary = resolveOrdersStateRoot(deps, projectKey);
    const book = getBook(primary.stateRoot, bookId);
    if (book) return enrichedBook(book, deps, undefined, projectKey);
    if (deps.stateRoot || projectKey !== undefined) {
      throw new Error(`Order book not found: ${bookId}`);
    }
    // Scan sequentially (not in parallel) to preserve registry-order first-match
    // behavior, and via async fs reads so N candidate projects cannot stall the
    // dashboard's shared HTTP/WebSocket event loop.
    for (const { key, config } of listProjectsSync()) {
      if (key === primary.project) continue;
      const scanRoot = (await resolveStateReadHomeAsync(config, key)).root;
      const scannedBook = await getBookAsync(scanRoot, bookId);
      if (scannedBook) return enrichedBook(scannedBook, deps, undefined, key);
    }
    throw new Error(`Order book not found: ${bookId}`);
  });
}

export async function patchOrderPayload(
  bookId: string,
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const { stateRoot } = resolveOrdersStateRoot(deps, projectKey);
    const patch = body['settings'] === undefined ? undefined : settingsPatch(body['settings']);
    if (patch?.posture !== undefined) {
      patch.postureSetAt = (deps.now ?? (() => new Date()))().toISOString();
      patch.postureSetBy = (deps.actor ?? (() => 'dashboard'))();
    }
    if (body['status'] !== undefined) {
      if (body['status'] !== 'ready') throw new Error('status may only transition to ready through this route');
      if (body['runId'] !== undefined) throw new Error('runId is server-controlled');
      const book = requireBook(stateRoot, bookId);
      if (book.status !== 'draft') throw new Error(`Order book ${bookId} must be draft before it can be queued`);
    }

    let changed = false;
    if (body['name'] !== undefined) {
      await renameBook(stateRoot, bookId, requireString(body['name'], 'name'));
      changed = true;
    }
    if (patch !== undefined) {
      await setSettings(stateRoot, bookId, patch);
      changed = true;
    }
    if (body['status'] !== undefined) {
      await setStatus(stateRoot, bookId, 'ready');
      changed = true;
    }
    if (!changed) throw new Error('name, settings, or status is required');
    return enrichedBook(requireBook(stateRoot, bookId), deps, undefined, projectKey);
  });
}

export async function postOrderItemsPayload(
  bookId: string,
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const { stateRoot } = resolveOrdersStateRoot(deps, projectKey);
    const book = requireBook(stateRoot, bookId);
    const input = body['items'] ?? body['item'];
    if (input === undefined) throw new Error('items is required');
    const actor = (deps.actor ?? (() => 'dashboard'))();
    return enrichedBook(await addItems(stateRoot, bookId, parseItems(book, input), actor), deps, undefined, projectKey);
  });
}

export async function deleteOrderItemPayload(
  bookId: string,
  issueId: string,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => enrichedBook(
    await removeItem(resolveOrdersStateRoot(deps, projectKey).stateRoot, bookId, issueId),
    deps,
    undefined,
    projectKey,
  ));
}

export async function patchOrderItemPayload(
  bookId: string,
  issueId: string,
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const { stateRoot } = resolveOrdersStateRoot(deps, projectKey);
    const existing = requireBook(stateRoot, bookId).items.find(
      (item) => item.issue.toUpperCase() === issueId.toUpperCase(),
    );
    if (!existing) throw new Error(`Issue ${issueId.toUpperCase()} is not in order book ${bookId}`);

    let changed = false;
    if (body['lane'] !== undefined || body['order'] !== undefined) {
      await moveItem(
        stateRoot,
        bookId,
        issueId,
        lane(body['lane'], existing.lane),
        positiveInteger(body['order'], 'order', existing.order),
      );
      changed = true;
    }
    if (body['prereqs'] !== undefined || body['reVerify'] !== undefined || body['planAtPickup'] !== undefined) {
      await setItemRequirements(stateRoot, bookId, issueId, {
        prereqs: body['prereqs'] === undefined ? undefined : stringArray(body['prereqs'], 'prereqs'),
        reVerify: optionalBoolean(body['reVerify'], 'reVerify'),
        planAtPickup: optionalBoolean(body['planAtPickup'], 'planAtPickup'),
      });
      changed = true;
    }
    if (!changed) throw new Error('lane, order, prereqs, reVerify, or planAtPickup is required');
    return enrichedBook(requireBook(stateRoot, bookId), deps, undefined, projectKey);
  });
}

export async function getBacklogCandidatesPayload(
  limit: number,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => ({
    candidates: backlogCandidates(resolveOrdersStateRoot(deps, projectKey).stateRoot, Math.max(1, Math.min(100, limit))),
  }));
}

export async function postOrderStartPayload(
  bookId: string,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const resolved = resolveOrdersStateRoot(deps, projectKey);
    const book = requireBook(resolved.stateRoot, bookId);
    const validation = validateBookForStart(resolved.stateRoot, book, {
      issueLookup: deps.issueLookup,
      hasPrd: deps.hasPrd,
    });
    if (validation.blocks.length > 0) {
      return {
        __routeStatus: 422,
        error: `Order book ${bookId} cannot start`,
        findings: validation.blocks,
        warnings: validation.warns,
      };
    }
    let result: StartOrderBookResult;
    if (deps.startOrderBook) {
      result = await deps.startOrderBook(book);
    } else {
      if (!resolved.projectConfig) throw new Error(`No configured project contains ${process.cwd()}`);
      result = await defaultStartOrderBook(book, resolved.projectConfig);
    }
    return { ok: true, runId: result.runId, warnings: validation.warns };
  }).then((result) => {
    if (
      result.status === 200
      && result.body
      && typeof result.body === 'object'
      && '__routeStatus' in result.body
    ) {
      const { __routeStatus, ...body } = result.body as Record<string, unknown>;
      return { status: Number(__routeStatus), body };
    }
    return result;
  });
}

export async function getPreviewBriefPayload(
  bookId: string,
  deps: OrdersRouteDeps = {},
  projectKey?: string,
): Promise<RouteResult> {
  return routeResult(async () => {
    const book = requireBook(resolveOrdersStateRoot(deps, projectKey).stateRoot, bookId);
    return { bookId: book.id, brief: previewBrief(book) };
  });
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  if (!text) return { ok: true, body: {} } satisfies JsonBodyResult;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, body: {} } satisfies JsonBodyResult;
    }
    return { ok: true, body: parsed as Record<string, unknown> } satisfies JsonBodyResult;
  } catch {
    return { ok: false, body: {} } satisfies JsonBodyResult;
  }
});

function mutationAuth(request: HttpServerRequest.HttpServerRequest) {
  return rejectUnsafeDashboardMutationRequest(request);
}

function projectParam(request: HttpServerRequest.HttpServerRequest): string | undefined {
  const url = HttpServerRequest.toURL(request);
  return url._tag === 'Some' ? (url.value.searchParams.get('project') ?? undefined) : undefined;
}

export function makeOrdersRouteLayer(deps: OrdersRouteDeps = {}) {
  const getBacklogCandidatesRoute = HttpRouter.add(
    'GET',
    '/api/orders/backlog-candidates',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = HttpServerRequest.toURL(request);
      const rawLimit = url._tag === 'Some' ? url.value.searchParams.get('limit') : null;
      const limit = rawLimit === null ? 10 : Number.parseInt(rawLimit, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        return jsonResponse({ error: 'limit must be a positive integer' }, { status: 400 });
      }
      return resultResponse(yield* Effect.promise(() => getBacklogCandidatesPayload(limit, deps, projectParam(request))));
    })),
  );

  const getOrdersRoute = HttpRouter.add(
    'GET',
    '/api/orders',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return resultResponse(yield* Effect.promise(() => getOrdersPayload(deps, projectParam(request))));
    })),
  );

  const postOrderRoute = HttpRouter.add(
    'POST',
    '/api/orders',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = mutationAuth(request);
      if (authError) return authError;
      const parsed = yield* readJsonBody;
      if (!parsed.ok) return jsonResponse({ error: 'Request body must be a JSON object' }, { status: 400 });
      return resultResponse(yield* Effect.promise(() => postOrderPayload(parsed.body, deps, projectParam(request))));
    })),
  );

  const getOrderRoute = HttpRouter.add(
    'GET',
    '/api/orders/:id',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => getOrderPayload(id, deps, projectParam(request))));
    })),
  );

  const patchOrderRoute = HttpRouter.add(
    'PATCH',
    '/api/orders/:id',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = mutationAuth(request);
      if (authError) return authError;
      const parsed = yield* readJsonBody;
      if (!parsed.ok) return jsonResponse({ error: 'Request body must be a JSON object' }, { status: 400 });
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => patchOrderPayload(id, parsed.body, deps, projectParam(request))));
    })),
  );

  const postOrderItemsRoute = HttpRouter.add(
    'POST',
    '/api/orders/:id/items',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = mutationAuth(request);
      if (authError) return authError;
      const parsed = yield* readJsonBody;
      if (!parsed.ok) return jsonResponse({ error: 'Request body must be a JSON object' }, { status: 400 });
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => postOrderItemsPayload(id, parsed.body, deps, projectParam(request))));
    })),
  );

  const deleteOrderItemRoute = HttpRouter.add(
    'DELETE',
    '/api/orders/:id/items/:issue',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = mutationAuth(request);
      if (authError) return authError;
      const params = yield* HttpRouter.params;
      return resultResponse(yield* Effect.promise(() => deleteOrderItemPayload(
        params['id'] ?? '',
        params['issue'] ?? '',
        deps,
        projectParam(request),
      )));
    })),
  );

  const patchOrderItemRoute = HttpRouter.add(
    'PATCH',
    '/api/orders/:id/items/:issue',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = mutationAuth(request);
      if (authError) return authError;
      const parsed = yield* readJsonBody;
      if (!parsed.ok) return jsonResponse({ error: 'Request body must be a JSON object' }, { status: 400 });
      const params = yield* HttpRouter.params;
      return resultResponse(yield* Effect.promise(() => patchOrderItemPayload(
        params['id'] ?? '',
        params['issue'] ?? '',
        parsed.body,
        deps,
        projectParam(request),
      )));
    })),
  );

  const postOrderStartRoute = HttpRouter.add(
    'POST',
    '/api/orders/:id/start',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = mutationAuth(request);
      if (authError) return authError;
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => postOrderStartPayload(id, deps, projectParam(request))));
    })),
  );

  const getPreviewBriefRoute = HttpRouter.add(
    'GET',
    '/api/orders/:id/preview-brief',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => getPreviewBriefPayload(id, deps, projectParam(request))));
    })),
  );

  return Layer.mergeAll(
    getBacklogCandidatesRoute,
    getOrdersRoute,
    postOrderRoute,
    getPreviewBriefRoute,
    postOrderStartRoute,
    postOrderItemsRoute,
    deleteOrderItemRoute,
    patchOrderItemRoute,
    getOrderRoute,
    patchOrderRoute,
  );
}

export const ordersRouteLayer = makeOrdersRouteLayer();

export default ordersRouteLayer;
