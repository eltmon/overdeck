/**
 * PAN-4927 W-BOT1 (PAN-4951): client for the Bots panel and the "Connect a bot" dialog —
 * connectors and pairing. The public MCP route (W-FUN1, PAN-4947) has one client,
 * `loadPublicMcp` + `ANYWHERE_PUBLIC_MCP_QUERY_KEY` in `anywhereApi.ts`, shared with the
 * Public MCP panel: React Query keys data by query key, so one key must have one shape.
 */
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { apiError, type ApiResult, isOk } from './anywhereApi';
import type { ConnectPlatformId } from './connectMessage';

export const BOTS_CONNECTORS_QUERY_KEY = ['anywhere-connectors'] as const;
export const BOTS_CONNECTOR_NOTICES_QUERY_KEY = ['anywhere-connector-notices'] as const;

/** Mirrors CONNECTOR_SCOPE_CHOICES and BOT_DEFAULT_SCOPES in src/lib/access-tokens.ts (PAN-4927 D-4). */
export const BOT_SCOPE_CHOICES = ['read:state', 'read:conversations', 'tell', 'operate', 'approve'] as const;
export type BotScope = (typeof BOT_SCOPE_CHOICES)[number];
export const BOT_DEFAULT_SCOPES: readonly BotScope[] = ['read:state', 'read:conversations', 'tell'];

/** D-3: filters to the bot scope choices, always adds `read:state`, in choice order. */
export function botScopes(chosen: Iterable<string>): BotScope[] {
  const picked = new Set(chosen);
  return BOT_SCOPE_CHOICES.filter((scope) => scope === 'read:state' || picked.has(scope));
}

export interface ConnectorRow {
  id: string;
  name: string;
  scopes: string[];
  clientId?: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ConnectorRequestRow {
  id: string;
  name: string;
  platform: ConnectPlatformId;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  state: 'live' | 'expired' | 'used';
  pairingString?: string;
}

export interface ConnectorNoticeRow {
  id: string;
  connectorId: string;
  name: string;
  scopes: string[];
  pairedAt: string;
}

/** Decision 11: "Read" + optional "Tell" / "Operate" / "Approve", joined by " + ". */
export function connectorAccessLabel(scopes: readonly string[]): string {
  const parts = ['Read'];
  if (scopes.includes('tell')) parts.push('Tell');
  if (scopes.includes('operate')) parts.push('Operate');
  if (scopes.includes('approve')) parts.push('Approve');
  return parts.join(' + ');
}

/** A 403 from any connectors route. */
export class BotsForbiddenError extends Error {}

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

/**
 * Query function for `['anywhere-connectors']`: the active connector rows and waiting requests;
 * `requests` is `[]` when the server has none (an older server sends no `requests` key). A 403
 * throws `BotsForbiddenError`.
 */
export async function loadConnectors(): Promise<{ connectors: ConnectorRow[]; requests: ConnectorRequestRow[] }> {
  const result = await readResult<{ connectors: ConnectorRow[]; requests?: ConnectorRequestRow[] }>(await fetch('/api/connectors'));
  if (result.status === 403) throw new BotsForbiddenError(apiError(result));
  if (!isOk(result)) throw new Error(apiError(result));
  return { connectors: result.body.connectors, requests: Array.isArray(result.body.requests) ? result.body.requests : [] };
}

export async function removeConnector(id: string): Promise<ApiResult<{ ok: true }>> {
  return readResult(await fetch(`/api/connectors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function createConnectorPairing(
  name: string,
  scopes: readonly BotScope[],
  platform?: ConnectPlatformId,
): Promise<ApiResult<{ requestId: string; pairingString: string; expiresAt: string }>> {
  return readResult(await fetch('/api/connectors/pairing', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(platform === undefined ? { name, scopes } : { name, scopes, platform }),
  }));
}

export async function cancelConnectorRequest(id: string): Promise<ApiResult<{ ok: true }>> {
  return readResult(await fetch(`/api/connectors/requests/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function dismissConnectorNotice(id: string): Promise<ApiResult<{ ok: true }>> {
  return readResult(await fetch(`/api/connectors/requests/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({}),
  }));
}

/** Query function for `BOTS_CONNECTOR_NOTICES_QUERY_KEY`; `[]` on any failure or a body without an array (older server). */
export async function fetchConnectorNotices(signal?: AbortSignal): Promise<ConnectorNoticeRow[]> {
  try {
    const result = await readResult<{ notices: ConnectorNoticeRow[] }>(await fetch('/api/connectors/notices', { signal }));
    return isOk(result) ? result.body.notices ?? [] : [];
  } catch {
    return [];
  }
}
