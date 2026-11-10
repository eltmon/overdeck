/**
 * Fleet awareness routes (PAN-4651 FR-5): what the linked machines show this
 * machine's browser, CLI and MCP. Like every fleet route they refuse a request
 * that arrives through a secure channel.
 *
 * - `GET /api/fleet/needs-you` (`read:conversations`, D-4651-15) →
 *   `{ machines: [{ environmentId, label, conversations, agents }],
 *   unreachable: [{ environmentId, label, since, reason }] }`. `machines` comes
 *   from the hash-driven cache, online links only. PAN-5111: a machine whose
 *   Needs-You fetch failed within the last hour contributes an `unreachable`
 *   entry until a fetch succeeds; a machine that goes offline without a failed
 *   fetch still contributes no rows and no error (NFR-2). A paired phone,
 *   which reaches this machine only through a channel, gets
 *   `{ machines: [], unreachable }`; every other channel caller is refused.
 * - `GET /api/fleet/search?q=&limit=` (`read:conversations`, D-4651-16) → runs
 *   `GET /api/palette/search` on every online link in parallel (2.5 s each) and
 *   answers `{ machines: [{ environmentId, label, conversations, error? }] }`
 *   with each hit's `conversationId` rewritten to `@<env>/<name>`. It never
 *   includes this machine: the palette already searches it.
 * - `GET /api/fleet/issues/:id/activity` (`read:state`, D-4651-16) → this
 *   machine plus every online link (2.5 s each): `{ machines: [{ environmentId,
 *   label, self, agents, conversations, error? }] }`, for `pan machines who`.
 */
import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import { listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentLinkSupervisor } from '../services/anywhere-boot.js';
import { type IssueActivity, issueActivity } from '../services/issue-activity.js';
import { currentLinkedNeedsYou, type LinkedNeedsYou, type LinkedNeedsYouFailure } from '../services/linked-needs-you-sync.js';
import { connectingStatusSource, type LinkStatusSource } from '../services/machine-link-service.js';
import { rejectUnauthorizedDashboardRequest, resolveRequestCredential } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';

export interface FleetAwarenessDeps {
  links: () => Promise<MachineLink[]>;
  status: LinkStatusSource['status'];
  needsYou: (environmentId: string) => LinkedNeedsYou | null;
  /** PAN-5111: the link's remembered Needs-You fetch failure. */
  needsYouFailure?: (environmentId: string) => LinkedNeedsYouFailure | null;
  now?: () => number;
}

export const defaultFleetAwarenessDeps = (): FleetAwarenessDeps => ({
  links: listLinks,
  status: (linkId) => (currentLinkSupervisor() ?? connectingStatusSource).status(linkId),
  needsYou: (environmentId) => currentLinkedNeedsYou()?.feedFor(environmentId) ?? null,
  needsYouFailure: (environmentId) => currentLinkedNeedsYou()?.failureFor(environmentId) ?? null,
  now: Date.now,
});

/** PAN-5111 D-10: a failure older than this no longer produces a "Can't reach" row. */
export const UNREACHABLE_FRESH_MS = 60 * 60 * 1000;

export interface UnreachableMachine {
  environmentId: string;
  label: string;
  since: string;
  reason: string;
}

/** Online, visible, non-revoked links in store order. */
export async function onlineLinks(deps: Pick<FleetAwarenessDeps, 'links' | 'status'>): Promise<MachineLink[]> {
  return (await deps.links()).filter((link) => !link.revokedAt && link.hidden !== true && deps.status(link.id).state === 'online');
}

export async function buildFleetNeedsYou(deps: FleetAwarenessDeps = defaultFleetAwarenessDeps()) {
  const links = await deps.links();
  const machines = [];
  for (const link of await onlineLinks({ status: deps.status, links: async () => links })) {
    const feed = deps.needsYou(link.environmentId);
    if (!feed) continue;
    machines.push({ environmentId: link.environmentId, label: link.label, conversations: feed.conversations, agents: feed.agents });
  }
  // D-10: not filtered on `offline`, so a flapping link's row does not blink;
  // a switched-off machine stops failing fetches and its row expires.
  const now = (deps.now ?? Date.now)();
  const unreachable: UnreachableMachine[] = [];
  for (const link of links) {
    if (link.revokedAt || link.hidden === true || deps.status(link.id).state === 'revoked') continue;
    const failure = deps.needsYouFailure?.(link.environmentId) ?? null;
    if (!failure || now - Date.parse(failure.lastAttemptAt) > UNREACHABLE_FRESH_MS) continue;
    unreachable.push({ environmentId: link.environmentId, label: link.label, since: failure.since, reason: failure.reason });
  }
  return { machines, unreachable };
}

export const FLEET_SEARCH_TIMEOUT_MS = 2_500;

export type PeerSearch = (environmentId: string, path: string, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;

const defaultPeerSearch: PeerSearch = (environmentId, path, signal) => linkFetch(environmentId, path, { actor: 'operator', signal });

/** One GET to a linked machine, answered within 2.5 s or turned into that machine's error. */
async function askPeer(link: MachineLink, path: string, search: PeerSearch): Promise<{ status: number; json: unknown } | { error: string }> {
  // AbortController + setTimeout rather than AbortSignal.timeout, so fake timers drive it in tests.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLEET_SEARCH_TIMEOUT_MS);
  try {
    return await Promise.race([
      search(link.environmentId, path, controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(`did not answer within ${FLEET_SEARCH_TIMEOUT_MS / 1000} s`)), { once: true })),
    ]);
  } catch (error) {
    return { error: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** One linked machine's palette conversation hits, renamed to `@<env>/<name>`; a failure is that machine's `error`. */
async function searchOne(link: MachineLink, q: string, limit: number, search: PeerSearch) {
  const base = { environmentId: link.environmentId, label: link.label };
  const answer = await askPeer(link, `/api/palette/search?q=${encodeURIComponent(q)}&limit=${limit}`, search);
  if ('error' in answer) return { ...base, conversations: [], error: answer.error };
  if (answer.status !== 200) return { ...base, conversations: [], error: `${link.label} answered ${answer.status}` };
  const hits = (answer.json as { conversations?: unknown } | null)?.conversations;
  const conversations = (Array.isArray(hits) ? hits : [])
    .filter((hit): hit is Record<string, unknown> => !!hit && typeof (hit as { conversationId?: unknown }).conversationId === 'string')
    .map((hit) => ({ ...hit, conversationId: `@${link.environmentId}/${hit['conversationId'] as string}` }));
  return { ...base, conversations };
}

export async function buildFleetSearch(
  q: string,
  limit: number,
  deps: Pick<FleetAwarenessDeps, 'links' | 'status'> & { search?: PeerSearch } = defaultFleetAwarenessDeps(),
) {
  if (q.trim().length < 2) return { machines: [] };
  const links = await onlineLinks(deps);
  return { machines: await Promise.all(links.map((link) => searchOne(link, q.trim(), limit, deps.search ?? defaultPeerSearch))) };
}

export interface IssueActivityFleetDeps extends Pick<FleetAwarenessDeps, 'links' | 'status'> {
  self: () => Promise<{ environmentId: string; label: string }>;
  local: (issueId: string) => Promise<IssueActivity>;
  search?: PeerSearch;
}

export const defaultIssueActivityFleetDeps = (): IssueActivityFleetDeps => ({
  ...defaultFleetAwarenessDeps(),
  self: async () => {
    const identity = await ensureEnvironmentIdentity();
    return { environmentId: identity.environmentId, label: identity.label };
  },
  local: (issueId) => issueActivity(issueId),
});

export async function buildFleetIssueActivity(issueId: string, deps: IssueActivityFleetDeps = defaultIssueActivityFleetDeps()) {
  const [self, local, links] = await Promise.all([deps.self(), deps.local(issueId), onlineLinks(deps)]);
  const peer = deps.search ?? defaultPeerSearch;
  const remote = await Promise.all(links.map(async (link) => {
    const base = { environmentId: link.environmentId, label: link.label, self: false };
    const answer = await askPeer(link, `/api/machines/issue-activity?issue=${encodeURIComponent(issueId)}`, peer);
    if ('error' in answer) return { ...base, agents: [], conversations: [], error: answer.error };
    if (answer.status !== 200) return { ...base, agents: [], conversations: [], error: `${link.label} answered ${answer.status}` };
    const body = answer.json as Partial<IssueActivity> | null;
    return { ...base, agents: Array.isArray(body?.agents) ? body.agents : [], conversations: Array.isArray(body?.conversations) ? body.conversations : [] };
  }));
  return { machines: [{ ...self, self: true, ...local }, ...remote] };
}

const issueActivityRoute = HttpRouter.add(
  'GET',
  '/api/fleet/issues/:id/activity',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    const issueId = (yield* HttpRouter.params)['id'] ?? '';
    if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(issueId)) return jsonResponse({ error: 'issue must be an issue id like PAN-7' }, { status: 400 });
    return jsonResponse(yield* Effect.promise(() => buildFleetIssueActivity(issueId)));
  }),
);

const searchRoute = HttpRouter.add(
  'GET',
  '/api/fleet/search',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    const url = HttpServerRequest.toURL(request);
    const query = Option.isSome(url) ? url.value.searchParams : new URLSearchParams();
    const limit = Math.max(1, Math.min(50, Number.parseInt(query.get('limit') ?? '15', 10) || 15));
    return jsonResponse(yield* Effect.promise(() => buildFleetSearch(query.get('q') ?? '', limit)));
  }),
);

const needsYouRoute = HttpRouter.add(
  'GET',
  '/api/fleet/needs-you',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const viaChannel = channelOfRequest(request) !== null;
    // PAN-5111 (D-12): a paired phone reaches this machine only through a channel. It reads
    // which linked machines this machine cannot reach, never their rows; every other channel
    // caller (a linked machine, a connector) is still refused. Same shape as fleetSpawnGate's
    // connector exception (PAN-4950 D-5).
    if (viaChannel && resolveRequestCredential(request)?.kind === 'phone') {
      const authError = rejectUnauthorizedDashboardRequest(request);
      if (authError) return authError;
      const { unreachable } = yield* Effect.promise(() => buildFleetNeedsYou());
      return jsonResponse({ machines: [], unreachable });
    }
    const refused = refuseFleetRequest(viaChannel, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    return jsonResponse(yield* Effect.promise(() => buildFleetNeedsYou()));
  }),
);

export const fleetAwarenessRouteLayer = Layer.mergeAll(needsYouRoute, searchRoute, issueActivityRoute);
