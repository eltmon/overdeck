/**
 * PAN-4927 W-BOT1 (PAN-4951): client for the Bots panel and the "Connect a bot" dialog —
 * connectors, pairing, and the public MCP route (W-FUN1, not yet landed; a 404 reads as off).
 */
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { apiError, type ApiResult, isOk } from './anywhereApi';

export const BOTS_CONNECTORS_QUERY_KEY = ['anywhere-connectors'] as const;
export const PUBLIC_MCP_QUERY_KEY = ['anywhere-public-mcp'] as const;

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

/** A 403 from any connectors route. */
export class BotsForbiddenError extends Error {}

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

/** Query function for `['anywhere-connectors']`: the active connector rows; a 403 throws `BotsForbiddenError`. */
export async function loadConnectors(): Promise<ConnectorRow[]> {
  const result = await readResult<{ connectors: ConnectorRow[] }>(await fetch('/api/connectors'));
  if (result.status === 403) throw new BotsForbiddenError(apiError(result));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body.connectors;
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
): Promise<ApiResult<{ pairingString: string; expiresAt: string }>> {
  return readResult(await fetch('/api/connectors/pairing', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ name, scopes }),
  }));
}

export interface PublicMcpState {
  available: boolean;
  enabled: boolean;
  url: string | null;
}

/** D-6: a 404 (W-FUN1 not landed) reads the same as "off". */
export async function loadPublicMcp(): Promise<PublicMcpState> {
  const response = await fetch('/api/mcp/public');
  if (response.status === 404) return { available: false, enabled: false, url: null };
  const result = await readResult<{ enabled: boolean; baseUrl: string | null }>(response);
  if (!isOk(result)) throw new Error(apiError(result));
  return { available: true, enabled: result.body.enabled, url: result.body.baseUrl ?? null };
}
