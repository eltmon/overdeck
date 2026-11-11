/**
 * Connector pairing requests (PAN-4927 W-CONN1; PAN-4949 D-6, D-7; PAN-5070 W-2).
 *
 * "Connect a bot" issues an ordinary one-time `odp_` pairing code and remembers,
 * by the code's pairingId, a connector request with the operator's chosen name,
 * platform and scopes. The connector exchange takes that request once; the
 * browser, machine and phone exchanges check for it and refuse a connector code.
 *
 * A request starts `pending`. `takeConnectorIntent` stamps it taken without
 * deleting it, so the dashboard can still show it while the bot process runs;
 * `markConnectorRequestPaired` moves it to `paired` once the exchange mints a
 * connector token. Requests live only in this process's memory, like the codes
 * themselves, so a dashboard restart drops both together. A pending request is
 * kept `CONNECTOR_REQUEST_RETENTION_MS` (24 h) past its code's own 30-minute
 * expiry, and a paired one for 24 h past pairing, so the "connected" notice has
 * time to be seen; `prune` removes it after that.
 */
import { randomUUID } from 'node:crypto';

import { pairingSecrets } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import { buildConnectorPairLink } from '@overdeck/contracts';

import type { AccessTokenScope } from '../../lib/access-token-records.js';
import { ensureMachineKey, publicKeyHex } from '../../lib/anywhere/machine-key.js';
import { CONNECT_PLATFORMS, type ConnectPlatform } from '../../lib/mcp/connector/connect-output.js';
import { ensureEnvironmentIdentity } from '../../lib/environment-identity.js';
import { issuePairingCredential, pairingCredentialState, revokePairingById } from './pairing-credentials.js';

export const CONNECTOR_PAIRING_TTL_MS = 30 * 60_000;
export const CONNECTOR_REQUEST_RETENTION_MS = 24 * 60 * 60_000;
export { CONNECT_PLATFORMS, type ConnectPlatform };

interface ConnectorRequest {
  id: string;
  pairingId: string;
  name: string;
  platform: ConnectPlatform;
  scopes: AccessTokenScope[];
  pairingString: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms; the code's own expiry. */
  expiresAt: number;
  /** Epoch ms; set by `takeConnectorIntent`. */
  takenAt?: number;
  status: 'pending' | 'paired';
  connectorId?: string;
  /** Epoch ms; set by `markConnectorRequestPaired`. */
  pairedAt?: number;
  /** Epoch ms; set by `dismissConnectorNotice`. */
  dismissedAt?: number;
}

/** What `GET /api/connectors` lists for one unpaired request. `pairingString` only when live. */
export interface ConnectorRequestView {
  id: string;
  name: string;
  platform: ConnectPlatform;
  scopes: AccessTokenScope[];
  createdAt: string;
  expiresAt: string;
  state: 'live' | 'expired' | 'used';
  pairingString?: string;
}

/** What `GET /api/connectors/notices` lists. Never carries a pairing string. */
export interface ConnectorNoticeView {
  id: string;
  connectorId: string;
  name: string;
  scopes: AccessTokenScope[];
  pairedAt: string;
}

/** id → request. */
const requests = new Map<string, ConnectorRequest>();
/** pairingId → id. */
const byPairingId = new Map<string, string>();

function forget(id: string, request: ConnectorRequest): void {
  requests.delete(id);
  byPairingId.delete(request.pairingId);
}

function prune(now: number): void {
  for (const [id, request] of requests) {
    if (request.status === 'pending' && now > request.expiresAt + CONNECTOR_REQUEST_RETENTION_MS) forget(id, request);
    else if (request.status === 'paired' && request.pairedAt !== undefined && now > request.pairedAt + CONNECTOR_REQUEST_RETENTION_MS) forget(id, request);
  }
}

function pendingState(request: ConnectorRequest, now: number): 'live' | 'expired' | 'used' {
  if (now > request.expiresAt) return 'expired';
  if (request.takenAt !== undefined || pairingCredentialState(request.pairingId) !== 'live') return 'used';
  return 'live';
}

/** Issue a pairing code for a connector and remember its request by pairingId (30-minute code expiry). `platform` defaults to `'other'`. */
export async function issueConnectorPairing(input: { name: string; scopes: readonly AccessTokenScope[]; platform?: ConnectPlatform }):
  Promise<{ requestId: string; pairingString: string; expiresAt: string }> {
  const identity = await ensureEnvironmentIdentity();
  const machineKeyHex = publicKeyHex(await ensureMachineKey());
  const now = Date.now();
  prune(now);
  const issued = issuePairingCredential({ ttlMs: CONNECTOR_PAIRING_TTL_MS });
  const { pairingId } = pairingSecrets(nodeCrypto, issued.credential);
  const pairingString = buildConnectorPairLink({ environmentId: identity.environmentId, machineKeyHex, code: issued.credential, machineLabel: identity.label });
  const requestId = randomUUID();
  requests.set(requestId, {
    id: requestId,
    pairingId,
    name: input.name,
    platform: input.platform ?? 'other',
    scopes: [...input.scopes],
    pairingString,
    createdAt: now,
    expiresAt: Date.parse(issued.expiresAt),
    status: 'pending',
  });
  byPairingId.set(pairingId, requestId);
  return { requestId, pairingString, expiresAt: issued.expiresAt };
}

/** The request behind `pairingId` once: null when unknown, already taken, paired, or expired. Stamps `takenAt`; never deletes. */
export function takeConnectorIntent(pairingId: string): { requestId: string; name: string; scopes: AccessTokenScope[] } | null {
  const id = byPairingId.get(pairingId);
  const request = id === undefined ? undefined : requests.get(id);
  if (request === undefined || request.status !== 'pending' || request.takenAt !== undefined || Date.now() > request.expiresAt) return null;
  request.takenAt = Date.now();
  return { requestId: request.id, name: request.name, scopes: request.scopes };
}

/** The exchange minted `connectorId` for `requestId`: status `'paired'`, `pairedAt` = now. No-op for an unknown id. */
export function markConnectorRequestPaired(requestId: string, connectorId: string): void {
  const request = requests.get(requestId);
  if (request === undefined) return;
  request.status = 'paired';
  request.connectorId = connectorId;
  request.pairedAt = Date.now();
}

/** True when `pairingId` belongs to a connector request (any status). Never removes it. */
export function hasConnectorIntent(pairingId: string): boolean {
  return byPairingId.has(pairingId);
}

/** True when the raw `odp_` code was issued for a connector. */
export function isConnectorCode(code: string): boolean {
  return hasConnectorIntent(pairingSecrets(nodeCrypto, code).pairingId);
}

/** Unpaired requests within retention, newest first. */
export function listConnectorRequests(): ConnectorRequestView[] {
  const now = Date.now();
  prune(now);
  return [...requests.values()]
    .filter((request) => request.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((request) => {
      const state = pendingState(request, now);
      return {
        id: request.id,
        name: request.name,
        platform: request.platform,
        scopes: request.scopes,
        createdAt: new Date(request.createdAt).toISOString(),
        expiresAt: new Date(request.expiresAt).toISOString(),
        state,
        ...(state === 'live' ? { pairingString: request.pairingString } : {}),
      };
    });
}

/** Burn the code and delete an unpaired request. Null for an unknown or paired id. */
export function cancelConnectorRequest(id: string): { name: string } | null {
  const request = requests.get(id);
  if (request === undefined || request.status !== 'pending') return null;
  revokePairingById(request.pairingId);
  forget(id, request);
  return { name: request.name };
}

/** Paired, undismissed requests with `pairedAt` within 24 h, oldest first. The route filters by active connector. */
export function listConnectorNotices(): ConnectorNoticeView[] {
  const now = Date.now();
  prune(now);
  return [...requests.values()]
    .filter((request): request is ConnectorRequest & { pairedAt: number; connectorId: string } =>
      request.status === 'paired' && request.dismissedAt === undefined)
    .sort((a, b) => a.pairedAt - b.pairedAt)
    .map((request) => ({
      id: request.id,
      connectorId: request.connectorId,
      name: request.name,
      scopes: request.scopes,
      pairedAt: new Date(request.pairedAt).toISOString(),
    }));
}

/** Stamp `dismissedAt` on a paired request. False for an unknown or unpaired id, or one already dismissed. */
export function dismissConnectorNotice(id: string): boolean {
  const request = requests.get(id);
  if (request === undefined || request.status !== 'paired' || request.dismissedAt !== undefined) return false;
  request.dismissedAt = Date.now();
  return true;
}

/** Test-only: forget every request. */
export function _resetConnectorPairingForTests(): void {
  requests.clear();
  byPairingId.clear();
}
