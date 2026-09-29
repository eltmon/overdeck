/**
 * GET /api/environment — the public environment descriptor (PAN-3762 FR-1, FR-11).
 *
 * Unauthenticated by design: a client reads it before it holds any credential,
 * to learn which machine it is talking to and whether it speaks the same
 * protocol. The body therefore contains no paths, usernames, tokens or secrets
 * (`/api/health` stays separate because it exposes `serverPath`).
 *
 * The identity comes from `environment-id.json`. A corrupt file answers 503
 * naming the file; it is never re-minted (see `lib/environment-identity.ts`).
 */
import { arch, platform } from 'node:os';

import { Effect, Schema } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { ENVIRONMENT_PROTOCOL_VERSION, EnvironmentDescriptor } from '@overdeck/contracts';

import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { jsonResponse } from '../http-helpers.js';
import { WS_UPGRADE_REQUIRES_CREDENTIAL } from '../ws-auth.js';
import { getOverdeckVersion } from './misc/shared.js';


const decodeDescriptor = Schema.decodeUnknownSync(EnvironmentDescriptor);

export async function buildEnvironmentDescriptor(): Promise<EnvironmentDescriptor> {
  const identity = await ensureEnvironmentIdentity();
  return decodeDescriptor({
    descriptorVersion: 1,
    environmentId: identity.environmentId,
    label: identity.label,
    platform: { os: platform(), arch: arch() },
    serverVersion: await getOverdeckVersion(),
    protocolVersion: ENVIRONMENT_PROTOCOL_VERSION,
    capabilities: { pairing: true, deviceSessions: true, terminalAuth: WS_UPGRADE_REQUIRES_CREDENTIAL },
  });
}

export const environmentRouteLayer = HttpRouter.add(
  'GET',
  '/api/environment',
  Effect.promise(async () => {
    try {
      return jsonResponse(await buildEnvironmentDescriptor());
    } catch (error) {
      return jsonResponse({ error: (error as Error).message }, 503);
    }
  }),
);
