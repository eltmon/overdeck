/**
 * Fleet awareness routes (PAN-4651 FR-5): what the linked machines show this
 * machine's browser, CLI and MCP. Like every fleet route they refuse a request
 * that arrives through a secure channel.
 *
 * - `GET /api/fleet/needs-you` (`read:conversations`, D-4651-15) →
 *   `{ machines: [{ environmentId, label, conversations, agents }] }` from the
 *   hash-driven cache, online links only. An offline machine contributes no
 *   rows and no error (NFR-2).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentLinkSupervisor } from '../services/anywhere-boot.js';
import { currentLinkedNeedsYou, type LinkedNeedsYou } from '../services/linked-needs-you-sync.js';
import { connectingStatusSource, type LinkStatusSource } from '../services/machine-link-service.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
import { refuseFleetRequest } from './machines-fleet.js';

export interface FleetAwarenessDeps {
  links: () => Promise<MachineLink[]>;
  status: LinkStatusSource['status'];
  needsYou: (environmentId: string) => LinkedNeedsYou | null;
}

export const defaultFleetAwarenessDeps = (): FleetAwarenessDeps => ({
  links: listLinks,
  status: (linkId) => (currentLinkSupervisor() ?? connectingStatusSource).status(linkId),
  needsYou: (environmentId) => currentLinkedNeedsYou()?.feedFor(environmentId) ?? null,
});

/** Online, visible, non-revoked links in store order. */
export async function onlineLinks(deps: Pick<FleetAwarenessDeps, 'links' | 'status'>): Promise<MachineLink[]> {
  return (await deps.links()).filter((link) => !link.revokedAt && link.hidden !== true && deps.status(link.id).state === 'online');
}

export async function buildFleetNeedsYou(deps: FleetAwarenessDeps = defaultFleetAwarenessDeps()) {
  const machines = [];
  for (const link of await onlineLinks(deps)) {
    const feed = deps.needsYou(link.environmentId);
    if (!feed) continue;
    machines.push({ environmentId: link.environmentId, label: link.label, conversations: feed.conversations, agents: feed.agents });
  }
  return { machines };
}

const needsYouRoute = HttpRouter.add(
  'GET',
  '/api/fleet/needs-you',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const refused = refuseFleetRequest(channelOfRequest(request) !== null, () => rejectUnauthorizedDashboardRequest(request));
    if (refused) return refused;
    return jsonResponse(yield* Effect.promise(() => buildFleetNeedsYou()));
  }),
);

export const fleetAwarenessRouteLayer = Layer.mergeAll(needsYouRoute);
