/** PAN-4639 WI-2: the triage write door — POST /api/conversations/triage. */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { applyTriageUpdate, parseTriageUpdates } from '../../../lib/overdeck/conversation-triage-store.js';
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

export const conversationTriageRouteLayer = Layer.mergeAll(postConversationTriageRoute);
