/**
 * HTTP remote control of a linked conversation (PAN-4650 WI-6, D-4650-4,
 * D-4650-6).
 *
 * A global middleware catches `/api/conversations/@<envOrLabel>/<ownerName>[/<rest>]`
 * (raw or percent-encoded as `%40<env>%2F<name>`), resolves the link, and
 * forwards `METHOD /api/conversations/<ownerName><rest>?<query>` to the owner
 * through the link with the link token and an actor stamp. Status,
 * `content-type` and body come back unchanged; bodies are buffered up to
 * 32 MiB. So every frontend call that builds `/api/conversations/${name}/…`
 * works unchanged for a linked row, and the owner's own scope table decides
 * what is allowed.
 *
 * It acts only on requests the remote request gate admits (it re-checks, so
 * it never depends on middleware order). That prefix is in no route-scope row,
 * so it needs `admin`: a machine credential arriving over a channel cannot use
 * it, and no request hops through two links. Channel callers are refused here
 * as well.
 *
 * A write (anything but GET/HEAD) goes to the owner as the operator, so it is
 * refused unless it carries a header-borne credential (the CLI's internal
 * token or an API token, which no cross-site page can attach) or a trusted
 * Origin/Referer (the dashboard's own fetches). A loopback browser request
 * passes the remote gate without a credential; this is what stops another
 * web page from writing to a linked conversation.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import type { AccessTokenScope } from '../../lib/access-tokens.js';
import {
  LinkForwardTooLargeError,
  linkForward,
  LinkUnavailableError,
  type LinkActorInit,
  type LinkForwardInit,
  type LinkForwardResponse,
} from '../../lib/anywhere/link-client.js';
import { getLink, type MachineLink } from '../../lib/anywhere/link-store.js';
import type { LinkActor } from '../../lib/anywhere/link-actor.js';
import { isOperatorConversation } from '../../lib/terminal-backends/prompt-guard.js';
import { type ChannelMarker, channelOfRequest } from './channel-peer.js';
import { jsonResponse } from './http-helpers.js';
import { remoteGateRejection } from './remote-request-gate.js';
import { credentialScopes, type DashboardCredential, resolveDashboardCredential, resolveRequestCredential } from './routes/dashboard-auth.js';
import { type HeaderMap, validateOriginHeaders } from './routes/origin-validation.js';

const PREFIX = '/api/conversations/';
/** Header the CLI sets to its `senderFromEnv().id` (D-4650-6). */
export const SENDER_HEADER = 'x-overdeck-sender';
const AGENT_ID = /^[A-Za-z0-9._:/-]{1,200}$/;

export interface LinkedTarget {
  /** Environment id or label. */
  target: string;
  ownerName: string;
  /** The rest of the path after the owner name, still percent-encoded ('' or '/…'). */
  rest: string;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Parse a raw (still-encoded) request path; null when it is not a linked conversation path. */
export function parseLinkedConversationPath(rawPath: string): LinkedTarget | null {
  if (!rawPath.startsWith(PREFIX)) return null;
  const segments = rawPath.slice(PREFIX.length).split('/');
  const first = decode(segments[0] ?? '');
  if (!first?.startsWith('@')) return null;
  let target: string;
  let ownerName: string | null;
  let restSegments: string[];
  if (first.includes('/')) {
    // `%40<env>%2F<name>`: target and name arrive as one encoded segment.
    const slash = first.indexOf('/');
    target = first.slice(1, slash);
    ownerName = first.slice(slash + 1);
    restSegments = segments.slice(1);
  } else {
    target = first.slice(1);
    ownerName = decode(segments[1] ?? '');
    restSegments = segments.slice(2);
  }
  if (!target || !ownerName || ownerName.includes('/')) return null;
  // Dot segments would let a proxied path climb out of the conversation on the owner.
  if (restSegments.some((segment) => { const value = decode(segment); return value === null || value === '.' || value === '..'; })) return null;
  return { target, ownerName, rest: restSegments.length > 0 ? `/${restSegments.join('/')}` : '' };
}

/** D-4650-6: the browser and operator CLIs act as `operator`; any other sender as that agent. */
export function actorForSender(sender: string | undefined): LinkActor | null {
  if (!sender || sender.startsWith('conv-operator-') || isOperatorConversation({ id: sender })) return 'operator';
  return AGENT_ID.test(sender) ? { agentId: sender } : null;
}

/** PAN-4927 D-9: an agent-kind agent token acts as its agent; a plain or conversation token as the operator (a conversation's `pan` does too). */
export function tokenLinkActor(credential: Extract<DashboardCredential, { kind: 'token' }>): LinkActorInit {
  return credential.agentKind === 'agent' && credential.agentId ? { agentId: credential.agentId } : 'operator';
}

export interface LinkedProxyDeps {
  getLink: (idOrEnvOrLabel: string) => Promise<MachineLink | null>;
  forward: (environmentId: string, init: LinkForwardInit) => Promise<LinkForwardResponse>;
}

const defaultDeps: LinkedProxyDeps = { getLink, forward: linkForward };

function header(request: HttpServerRequest.HttpServerRequest, name: string): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The refusal for a cross-site write through the proxy, or null when the request may be forwarded. */
export function crossSiteWriteRefusal(headers: HeaderMap, method: string): HttpServerResponse.HttpServerResponse | null {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD') return null;
  const kind = resolveDashboardCredential(headers)?.kind;
  if (kind === 'internal-token' || kind === 'token') return null;
  const origin = validateOriginHeaders(headers, method);
  return origin.ok ? null : jsonResponse({ error: origin.error }, { status: 403 });
}

/** Forward one admitted request for `target`; always answers. */
export async function forwardLinkedConversationRequest(
  input: { method: string; target: LinkedTarget; query: string; contentType?: string; sender?: string; body?: Buffer; credential?: DashboardCredential | null },
  deps: LinkedProxyDeps = defaultDeps,
): Promise<HttpServerResponse.HttpServerResponse> {
  // PAN-4651 D-4651-17: an `odk_` token is limited to its own scopes on the owner
  // (derived from the resolved credential, never a header). PAN-4927 D-9: an
  // agent-kind agent token acts as its agent there; any other token as the operator.
  const tokenCeiling = input.credential?.kind === 'token'
    ? credentialScopes(input.credential).filter((scope): scope is AccessTokenScope => scope !== 'admin') as AccessTokenScope[]
    : null;
  const actor = input.credential?.kind === 'token' ? tokenLinkActor(input.credential) : actorForSender(input.sender);
  if (actor === null) return jsonResponse({ error: `invalid ${SENDER_HEADER} header` }, { status: 400 });
  const link = await deps.getLink(input.target.target);
  if (!link || link.revokedAt !== null) {
    return jsonResponse({ error: `No machine link named ${input.target.target}`, code: 'no-link' }, { status: 503 });
  }
  const path = `${PREFIX}${encodeURIComponent(input.target.ownerName)}${input.target.rest}${input.query}`;
  try {
    const response = await deps.forward(link.environmentId, {
      method: input.method,
      path,
      ...(input.contentType ? { headers: { 'content-type': input.contentType } } : {}),
      ...(input.body && input.body.length > 0 ? { body: input.body } : {}),
      actor,
      ...(tokenCeiling ? { ceiling: tokenCeiling } : {}),
    });
    const contentType = response.headers['content-type'];
    return HttpServerResponse.uint8Array(new Uint8Array(response.body), {
      status: response.status,
      ...(typeof contentType === 'string' ? { contentType } : {}),
    });
  } catch (error) {
    if (error instanceof LinkUnavailableError) return jsonResponse({ error: error.message, code: error.code }, { status: 503 });
    if (error instanceof LinkForwardTooLargeError) {
      return jsonResponse({ error: error.message, code: 'too-large' }, { status: error.side === 'request' ? 413 : 502 });
    }
    return jsonResponse({ error: `${link.label} could not be reached: ${(error as Error).message}`, code: 'machine-unreachable' }, { status: 502 });
  }
}

/** A request that arrived through a secure channel never reaches a third machine (PAN-4651 D-4651-17). */
export function chainedHopRefusal(channel: ChannelMarker | null): HttpServerResponse.HttpServerResponse | null {
  return channel === null
    ? null
    : jsonResponse({ code: 'no-chained-hops', error: 'a linked machine cannot reach a third machine through this one' }, { status: 403 });
}

export const linkedConversationProxyLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(request.url, 'http://localhost');
      const target = parseLinkedConversationPath(url.pathname);
      if (!target) return yield* httpEffect;
      // PAN-4651 D-4651-17: first, because token scopes now reach this prefix — no chained hops.
      const chained = chainedHopRefusal(channelOfRequest(request));
      if (chained) return chained;
      // Only requests the gate admits; the gate itself answers the rest.
      if (remoteGateRejection(request) !== null) return yield* httpEffect;
      const refused = crossSiteWriteRefusal(request.headers as HeaderMap, request.method);
      if (refused) return refused;
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const body = hasBody ? Buffer.from(yield* Effect.orElseSucceed(request.arrayBuffer, () => new ArrayBuffer(0))) : undefined;
      return yield* Effect.promise(() => forwardLinkedConversationRequest({
        method: request.method,
        target,
        query: url.search,
        contentType: header(request, 'content-type'),
        sender: header(request, SENDER_HEADER),
        credential: resolveRequestCredential(request),
        ...(body ? { body } : {}),
      }));
    }),
  { global: true },
);
