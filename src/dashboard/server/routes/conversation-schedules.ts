/** PAN-4640 WI-3: the schedule door's HTTP surface — GET/POST /api/conversations/:name/schedules, PATCH/DELETE …/:id. */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import {
  createConversationSchedule,
  emitConversationSchedulesChanged,
  listConversationSchedules,
  MAX_SCHEDULES_PER_CONVERSATION,
  removeConversationSchedule,
  ScheduleValidationError,
  updateConversationSchedule,
  validateScheduleInput,
  validateSchedulePatch,
} from '../../../lib/overdeck/conversation-schedules.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { validateOrigin } from './origin-validation.js';

/** Invalidate the list cache and tell connected clients so the next-run badge refreshes. */
function notifySchedulesChanged(name: string): void {
  invalidateConversationListEnrichmentCache();
  emitConversationSchedulesChanged(name);
}

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

function parseScheduleId(raw: string | undefined): number | null {
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

const getConversationSchedulesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/schedules',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    if (!getConversationByName(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    return jsonResponse({ schedules: listConversationSchedules(name) });
  }),
);

const postConversationScheduleRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/schedules',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const body = yield* readJsonBody;
    const now = Date.now();
    const validated = validateScheduleInput(body, now);
    if (!validated.ok) return jsonResponse({ error: validated.error }, { status: 400 });
    const result = createConversationSchedule(name, validated.value, now);
    switch (result.status) {
      case 'created':
        notifySchedulesChanged(name);
        return jsonResponse({ schedule: result.schedule }, { status: 201 });
      case 'not-found':
        return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
      case 'refused':
        return jsonResponse({ error: result.error, code: result.code }, { status: 409 });
      case 'limit':
        return jsonResponse({ error: `Schedule limit reached (${MAX_SCHEDULES_PER_CONVERSATION})`, code: 'limit' }, { status: 409 });
    }
  }),
);

const patchConversationScheduleRoute = HttpRouter.add(
  'PATCH',
  '/api/conversations/:name/schedules/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const id = parseScheduleId(params['id']);
    if (id === null) return jsonResponse({ error: 'Invalid schedule id' }, { status: 400 });
    if (!getConversationByName(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    const body = yield* readJsonBody;
    const now = Date.now();
    const validated = validateSchedulePatch(body, now);
    if (!validated.ok) return jsonResponse({ error: validated.error }, { status: 400 });
    try {
      const schedule = updateConversationSchedule(name, id, validated.value, now);
      if (!schedule) return jsonResponse({ error: 'Schedule not found' }, { status: 404 });
      notifySchedulesChanged(name);
      return jsonResponse({ schedule });
    } catch (err) {
      if (err instanceof ScheduleValidationError) return jsonResponse({ error: err.message }, { status: 400 });
      throw err;
    }
  }),
);

const deleteConversationScheduleRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name/schedules/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const id = parseScheduleId(params['id']);
    if (id === null) return jsonResponse({ error: 'Invalid schedule id' }, { status: 400 });
    if (!removeConversationSchedule(name, id)) return jsonResponse({ error: 'Schedule not found' }, { status: 404 });
    notifySchedulesChanged(name);
    return jsonResponse({ removed: true });
  }),
);

export const conversationSchedulesRouteLayer = Layer.mergeAll(
  getConversationSchedulesRoute,
  postConversationScheduleRoute,
  patchConversationScheduleRoute,
  deleteConversationScheduleRoute,
);
