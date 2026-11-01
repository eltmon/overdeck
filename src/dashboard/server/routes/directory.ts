/**
 * `GET /api/directory` (PRD PAN-2356 WI-9): the directory client's state for the Settings
 * directory panel, the status card and `pan machines directory`.
 *
 * Admin only, and never from a channel: a linked machine must not list this account's machines.
 * Without a running client (a peer dashboard, or before boot) the answer is the signed-out view.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import type { DirectoryResponse } from '@overdeck/contracts';

import { channelOfRequest } from '../channel-peer.js';
import { jsonResponse } from '../http-helpers.js';
import { currentDirectoryClient } from '../services/directory-client.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';

export const OFF_DIRECTORY: DirectoryResponse = {
  signedIn: false,
  state: 'off',
  url: null,
  plan: null,
  refusal: null,
  machines: [],
  approvals: [],
  joins: [],
  relay: null,
};

export function buildDirectoryResponse(): DirectoryResponse {
  return currentDirectoryClient()?.status() ?? OFF_DIRECTORY;
}

const statusRoute = HttpRouter.add(
  'GET',
  '/api/directory',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (channelOfRequest(request) !== null) {
      return jsonResponse({ error: 'a linked machine cannot read the directory here' }, { status: 403 });
    }
    const refused = rejectUnauthorizedDashboardRequest(request);
    if (refused) return refused;
    return jsonResponse(buildDirectoryResponse());
  }),
);

export const directoryRouteLayer = Layer.mergeAll(statusRoute);
