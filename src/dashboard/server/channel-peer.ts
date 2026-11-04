/**
 * Channel marker lookup for dashboard requests (PAN-4645 WI-3). A leaf module:
 * it imports nothing from the dashboard so auth, gates and routes can all use it.
 *
 * A request that arrived through a secure channel has a `ChannelSocket` as its
 * socket; its marker names the mode (`link` or `pairing`) and the peer's
 * machine key. Everything else (plain TCP, loopback, Traefik) yields `null`.
 */
import type { IncomingMessage } from 'node:http';

import type { HttpServerRequest } from 'effect/unstable/http';

import { type ChannelMarker, isChannelSocket } from '../../lib/anywhere/channel/channel-socket.js';

export type { ChannelMarker } from '../../lib/anywhere/channel/channel-socket.js';

export function channelOfIncoming(req: Pick<IncomingMessage, 'socket'>): ChannelMarker | null {
  return isChannelSocket(req.socket) ? req.socket.channel : null;
}

/**
 * The marker of an Effect request, or `null` when the request is not backed
 * by a Node `IncomingMessage` (for example one built with `fromWeb` in tests).
 */
export function channelOfRequest(request: HttpServerRequest.HttpServerRequest): ChannelMarker | null {
  const source = (request as { source?: unknown }).source;
  if (typeof source !== 'object' || source === null || !('socket' in source)) return null;
  return channelOfIncoming(source as Pick<IncomingMessage, 'socket'>);
}
