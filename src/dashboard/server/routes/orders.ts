import type {
  OrderBook,
  OrderBookItem,
  OrderBookLane,
  OrderBookSettings,
  OrderBookStatus,
} from '@overdeck/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { backlogCandidates, computeBookProgress, getBook, listBooks } from '../../../lib/orders/resolver.js';
import type { OrderIssueLookup } from '../../../lib/orders/types.js';
import { validateBookForStart } from '../../../lib/orders/validate.js';
import {
  addItems,
  createBook,
  moveItem,
  removeItem,
  renameBook,
  setItemFlags,
  setSettings,
  setStatus,
  type NewOrderBookItem,
} from '../../../lib/orders/writer.js';
import { findProjectByPathSync } from '../../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../../lib/state-read-home.js';
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

interface JsonBodyResult {
  ok: boolean;
  body: Record<string, unknown>;
}

const ORDER_BOOK_STATUSES = new Set<OrderBookStatus>([
  'draft',
  'ready',
  'running',
  'drained',
  'complete',
]);

function stateRootFor(deps: OrdersRouteDeps): string {
  if (deps.stateRoot) return deps.stateRoot();
  const project = findProjectByPathSync(process.cwd());
  if (!project) throw new Error(`No configured project contains ${process.cwd()}`);
  return resolveStateReadHomeSync(project).root;
}

function errorResult(error: unknown): RouteResult {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return { status: 404, body: { error: message } };
  if (/already (exists|belongs|running|active)|multiple non-complete/i.test(message)) {
    return { status: 409, body: { error: message } };
  }
  if (/invalid|required|must be|cannot be empty|positive integer/i.test(message)) {
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
  if ('postureSetAt' in raw) result.postureSetAt = optionalString(raw['postureSetAt'], 'postureSetAt');
  if ('postureSetBy' in raw) result.postureSetBy = optionalString(raw['postureSetBy'], 'postureSetBy');
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

function enrichedBook(book: OrderBook, deps: OrdersRouteDeps) {
  return {
    ...book,
    progress: computeBookProgress(book, deps.issueLookup),
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

async function defaultStartOrderBook(book: OrderBook): Promise<StartOrderBookResult> {
  const { startFlywheelRun } = await import('../../../cli/commands/flywheel.js');
  type OrdersStartOptions = Parameters<typeof startFlywheelRun>[0] & { orders: string };
  const startWithOrders = startFlywheelRun as (options: OrdersStartOptions) => ReturnType<typeof startFlywheelRun>;
  return startWithOrders({
    cwd: process.cwd(),
    orders: book.id,
    brief: book.settings.briefOverlay,
  });
}

export async function getOrdersPayload(deps: OrdersRouteDeps = {}): Promise<RouteResult> {
  return routeResult(async () => ({
    books: listBooks(stateRootFor(deps)).map((book) => enrichedBook(book, deps)),
  }));
}

export async function postOrderPayload(body: Record<string, unknown>, deps: OrdersRouteDeps = {}): Promise<RouteResult> {
  return routeResult(async () => {
    const stateRoot = stateRootFor(deps);
    const name = requireString(body['name'], 'name');
    const id = body['id'] === undefined
      ? nextBookId(stateRoot, name, (deps.now ?? (() => new Date()))())
      : requireString(body['id'], 'id');
    const settings = body['settings'] === undefined ? undefined : settingsPatch(body['settings']);
    return enrichedBook(await createBook(stateRoot, { id, name, settings }), deps);
  });
}

export async function getOrderPayload(bookId: string, deps: OrdersRouteDeps = {}): Promise<RouteResult> {
  return routeResult(async () => enrichedBook(requireBook(stateRootFor(deps), bookId), deps));
}

export async function patchOrderPayload(
  bookId: string,
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
): Promise<RouteResult> {
  return routeResult(async () => {
    const stateRoot = stateRootFor(deps);
    let changed = false;
    if (body['name'] !== undefined) {
      await renameBook(stateRoot, bookId, requireString(body['name'], 'name'));
      changed = true;
    }
    if (body['settings'] !== undefined) {
      await setSettings(stateRoot, bookId, settingsPatch(body['settings']));
      changed = true;
    }
    if (body['status'] !== undefined) {
      if (typeof body['status'] !== 'string' || !ORDER_BOOK_STATUSES.has(body['status'] as OrderBookStatus)) {
        throw new Error('status must be draft, ready, running, drained, or complete');
      }
      await setStatus(stateRoot, bookId, body['status'] as OrderBookStatus, {
        runId: optionalString(body['runId'], 'runId'),
      });
      changed = true;
    }
    if (!changed) throw new Error('name, settings, or status is required');
    return enrichedBook(requireBook(stateRoot, bookId), deps);
  });
}

export async function postOrderItemsPayload(
  bookId: string,
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
): Promise<RouteResult> {
  return routeResult(async () => {
    const stateRoot = stateRootFor(deps);
    const book = requireBook(stateRoot, bookId);
    const input = body['items'] ?? body['item'];
    if (input === undefined) throw new Error('items is required');
    const actor = typeof body['actor'] === 'string' && body['actor'].trim()
      ? body['actor'].trim()
      : (deps.actor ?? (() => 'dashboard'))();
    return enrichedBook(await addItems(stateRoot, bookId, parseItems(book, input), actor), deps);
  });
}

export async function deleteOrderItemPayload(
  bookId: string,
  issueId: string,
  deps: OrdersRouteDeps = {},
): Promise<RouteResult> {
  return routeResult(async () => enrichedBook(
    await removeItem(stateRootFor(deps), bookId, issueId),
    deps,
  ));
}

export async function patchOrderItemPayload(
  bookId: string,
  issueId: string,
  body: Record<string, unknown>,
  deps: OrdersRouteDeps = {},
): Promise<RouteResult> {
  return routeResult(async () => {
    const stateRoot = stateRootFor(deps);
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
    if (body['reVerify'] !== undefined || body['planAtPickup'] !== undefined) {
      await setItemFlags(stateRoot, bookId, issueId, {
        reVerify: optionalBoolean(body['reVerify'], 'reVerify'),
        planAtPickup: optionalBoolean(body['planAtPickup'], 'planAtPickup'),
      });
      changed = true;
    }
    if (!changed) throw new Error('lane, order, reVerify, or planAtPickup is required');
    return enrichedBook(requireBook(stateRoot, bookId), deps);
  });
}

export async function getBacklogCandidatesPayload(
  limit: number,
  deps: OrdersRouteDeps = {},
): Promise<RouteResult> {
  return routeResult(async () => ({
    candidates: backlogCandidates(stateRootFor(deps), Math.max(1, Math.min(100, limit))),
  }));
}

export async function postOrderStartPayload(bookId: string, deps: OrdersRouteDeps = {}): Promise<RouteResult> {
  return routeResult(async () => {
    const stateRoot = stateRootFor(deps);
    const book = requireBook(stateRoot, bookId);
    const validation = validateBookForStart(stateRoot, book, {
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
    const result = await (deps.startOrderBook ?? defaultStartOrderBook)(book);
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

export async function getPreviewBriefPayload(bookId: string, deps: OrdersRouteDeps = {}): Promise<RouteResult> {
  return routeResult(async () => {
    const book = requireBook(stateRootFor(deps), bookId);
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
      return resultResponse(yield* Effect.promise(() => getBacklogCandidatesPayload(limit, deps)));
    })),
  );

  const getOrdersRoute = HttpRouter.add(
    'GET',
    '/api/orders',
    httpHandler(Effect.gen(function* () {
      return resultResponse(yield* Effect.promise(() => getOrdersPayload(deps)));
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
      return resultResponse(yield* Effect.promise(() => postOrderPayload(parsed.body, deps)));
    })),
  );

  const getOrderRoute = HttpRouter.add(
    'GET',
    '/api/orders/:id',
    httpHandler(Effect.gen(function* () {
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => getOrderPayload(id, deps)));
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
      return resultResponse(yield* Effect.promise(() => patchOrderPayload(id, parsed.body, deps)));
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
      return resultResponse(yield* Effect.promise(() => postOrderItemsPayload(id, parsed.body, deps)));
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
      return resultResponse(yield* Effect.promise(() => postOrderStartPayload(id, deps)));
    })),
  );

  const getPreviewBriefRoute = HttpRouter.add(
    'GET',
    '/api/orders/:id/preview-brief',
    httpHandler(Effect.gen(function* () {
      const id = (yield* HttpRouter.params)['id'] ?? '';
      return resultResponse(yield* Effect.promise(() => getPreviewBriefPayload(id, deps)));
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
