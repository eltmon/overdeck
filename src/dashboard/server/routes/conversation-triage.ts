/**
 * PAN-4639 WI-2: the triage write door — POST /api/conversations/triage.
 * PAN-4653: GET/POST /api/conversations/auto-settle-on-merge read and write the
 * global auto-settle-on-merge setting.
 * PAN-4655 WI-4: GET/PUT /api/conversations/triage/auto-settle — the idle-settle days setting.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { applyTriageUpdate, parseTriageUpdates } from '../../../lib/overdeck/conversation-triage-store.js';
import {
  getConversationsAutoSettleIdleDays,
  isConversationsAutoSettleOnMerge,
  parseAutoSettleIdleDays,
  setConversationsAutoSettleIdleDays,
  setConversationsAutoSettleOnMerge,
} from '../../../lib/overdeck/control-settings.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { validateOrigin } from './origin-validation.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

const postConversationTriageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/triage',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });

    const body = yield* readJsonBody;
    const parsed = parseTriageUpdates(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    const conversations: Array<{ name: string; settledAt: string | null; settleReason: string | null; snoozedUntil: string | null }> = [];
    const notFound: string[] = [];
    const rejected: Array<{ name: string; reason: 'vault-browse-row' }> = [];
    let wrote = false;

    for (const update of parsed.updates) {
      const conversation = getConversationByName(update.name);
      if (!conversation) {
        notFound.push(update.name);
        continue;
      }
      if (conversation.origin === 'vault') {
        rejected.push({ name: update.name, reason: 'vault-browse-row' });
        continue;
      }
      const triage = applyTriageUpdate(update);
      if (!triage) {
        notFound.push(update.name);
        continue;
      }
      wrote = true;
      conversations.push({ name: update.name, ...triage });
    }

    if (wrote) invalidateConversationListEnrichmentCache();
    return jsonResponse({ conversations, notFound, rejected });
  }),
);

const getAutoSettleOnMergeRoute = HttpRouter.add(
  'GET',
  '/api/conversations/auto-settle-on-merge',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    return jsonResponse({ enabled: isConversationsAutoSettleOnMerge() });
  }),
);

const postAutoSettleOnMergeRoute = HttpRouter.add(
  'POST',
  '/api/conversations/auto-settle-on-merge',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const body = yield* readJsonBody;
    if (typeof body['enabled'] !== 'boolean') return jsonResponse({ error: 'enabled must be a boolean' }, { status: 400 });
    setConversationsAutoSettleOnMerge(body['enabled']);
    return jsonResponse({ enabled: isConversationsAutoSettleOnMerge() });
  }),
);

const getAutoSettleRoute = HttpRouter.add(
  'GET',
  '/api/conversations/triage/auto-settle',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    return jsonResponse({ idleDays: getConversationsAutoSettleIdleDays() });
  }),
);

const putAutoSettleRoute = HttpRouter.add(
  'PUT',
  '/api/conversations/triage/auto-settle',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });

    const body = yield* readJsonBody;
    const days = parseAutoSettleIdleDays(body.idleDays);
    if (days === null) return jsonResponse({ error: 'idleDays must be a whole number from 0 to 365' }, { status: 400 });
    setConversationsAutoSettleIdleDays(days);
    return jsonResponse({ idleDays: days });
  }),
);

export const conversationTriageRouteLayer = Layer.mergeAll(
  postConversationTriageRoute,
  getAutoSettleOnMergeRoute,
  postAutoSettleOnMergeRoute,
  getAutoSettleRoute,
  putAutoSettleRoute,
);
