/**
 * Client for the Overdeck Anywhere routes (PAN-4445): paired devices, pairing
 * links, trusted addresses and the Anywhere status. These call the same server
 * routes as `pan pair` and `pan devices`. Webhook triggers (PAN-4648) use
 * `/api/triggers`, the routes behind `pan triggers`.
 *
 * Every fetcher returns `{ status, body }` so a caller can branch on 403 (a
 * paired device's session cannot create pairing links or add addresses).
 */
import type { EnvironmentDescriptor } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { AccessTokensForbiddenError, type AccessTokenRecord } from '../sections/accessTokensShared';

export interface DeviceRow {
  id: string;
  name: string;
  /** 'phone' for a paired phone app record (PAN-4835); absent on an older server. */
  kind?: 'device' | 'phone';
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type AnywhereVaultState = 'off' | 'locked' | 'rotation-pending' | 'ready';

export type AnywhereAction =
  | { kind: 'pair-dialog' }
  | { kind: 'settings-section'; section: 'session-vault' }
  | { kind: 'tailscale-setup' }
  | { kind: 'none'; docsUrl?: string };

/** Mirrors `TailscaleNextStep` in src/lib/tailscale/state.ts, plus `not-installed`. */
export type AnywhereTailscaleStep =
  | 'not-installed'
  | 'install'
  | 'start-daemon'
  | 'operator'
  | 'login'
  | 'enable-https'
  | 'serve'
  | 'protect'
  | 'ready';

export interface AnywhereProblem {
  code: 'identity-unreadable' | 'no-reachable-address' | 'vault-locked' | 'vault-rotation-pending' | 'tailscale-serve-unprotected';
  message: string;
  action: AnywhereAction;
}

/** Mirrors `AnywhereStatus` in src/lib/remote-access/anywhere-status.ts. */
export interface AnywhereStatus {
  machine: { environmentId: string; label: string } | null;
  addresses: Array<{ origin: string; loopback: boolean }>;
  devices: { active: number };
  vault: { state: AnywhereVaultState; backend: string | null };
  /** PAN-4645: the enforced require_token_mint and why it is on by itself; absent on older servers. */
  tokenMint?: { effective: boolean; configured: boolean; autoReasons: string[] };
  problems: AnywhereProblem[];
  /** Tailscale on this machine (PAN-1254 FR-9). */
  tailscale: { nextStep: AnywhereTailscaleStep; serveUrl: string | null; magicDnsName: string | null };
  /** Who is asking (PAN-4455 D-3); null when no credential resolves. */
  viewer: { kind: 'root-session' | 'device' | 'token' | 'internal-token' | 'machine' | null };
  /** The overdeck.ai directory (PAN-2356); null when signed out; absent on older servers. */
  directory?: { state: 'off' | 'connecting' | 'online' | 'refused'; plan: 'free' | 'tester' | null; url: string | null; refusal: string | null } | null;
  /** The relay add-on (PAN-2356); null when the plan has no relay; absent on older servers. */
  relay?: { using: boolean; bytesUsed: number; capBytes: number; stopped: boolean } | null;
}

export interface PairingLinkBody {
  credential: string;
  expiresAt: string;
  pairingPath: string;
}

export interface ApiResult<T> {
  status: number;
  body: T | { error?: string } | null;
}

export const ANYWHERE_DEVICES_QUERY_KEY = ['anywhere-devices'] as const;
export const ANYWHERE_STATUS_QUERY_KEY = ['anywhere-status'] as const;
export const ANYWHERE_ENVIRONMENT_QUERY_KEY = ['anywhere-environment'] as const;
/** Shared with `sections/AccessTokensSection` so a revoke or mint refreshes both surfaces. */
export const ANYWHERE_ACCESS_TOKENS_QUERY_KEY = ['access-tokens'] as const;
export const ANYWHERE_TRIGGERS_QUERY_KEY = ['anywhere-triggers'] as const;

/** The default scopes of an MCP token (PAN-4649 D-4649-3); mirrors MCP_DEFAULT_SCOPES in src/lib/mcp/server.ts. */
export const MCP_DEFAULT_SCOPES = ['read:state', 'read:conversations', 'operate'] as const;

export interface CreatedAccessToken {
  token: string;
  record: { id: string; name: string; scopes: string[] };
}

/** Mirrors `PublicTrigger` in src/lib/triggers/store.ts. No secret ever reaches the client in a list. */
export interface TriggerRow {
  id: string;
  name: string;
  target:
    | { kind: 'conversation'; conversation: string }
    | { kind: 'project'; projectKey: string; model?: string; harness?: string; effort?: string };
  template: string | null;
  verify: 'none' | 'github' | 'stripe';
  signingSecretSet: boolean;
  createdAt: string;
  /** The overdeck.ai inbox that holds events while this machine is offline (PAN-2356). */
  inbox?: { id: string; createdAt: string } | null;
}

export interface TriggersList {
  triggers: TriggerRow[];
  funnel: { port: number; baseUrl: string | null; command: string };
}

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

/** The `error` text of a failed result, or a fallback naming the status. */
export function apiError(result: ApiResult<unknown>): string {
  const body = result.body as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `Request failed (${result.status})`;
}

export function isOk<T>(result: ApiResult<T>): result is { status: number; body: T } {
  return result.status >= 200 && result.status < 300 && result.body !== null;
}

export async function fetchDevices(): Promise<ApiResult<{ devices: DeviceRow[] }>> {
  return readResult(await fetch('/api/devices'));
}

export async function revokeDevice(id: string): Promise<ApiResult<{ ok: true; device: DeviceRow }>> {
  return readResult(await fetch(`/api/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function fetchAnywhereStatus(): Promise<ApiResult<AnywhereStatus>> {
  return readResult(await fetch('/api/anywhere/status'));
}

export async function fetchEnvironment(): Promise<ApiResult<EnvironmentDescriptor>> {
  return readResult(await fetch('/api/environment'));
}

/** Query function for `['anywhere-environment']`: this machine's descriptor, or a thrown error. */
export async function loadEnvironment(): Promise<EnvironmentDescriptor> {
  const result = await fetchEnvironment();
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** "Expires in N minutes · works once" for a pairing code. */
export function pairingExpiresInText(expiresAt: number): string {
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  return `Expires in ${minutes} minute${minutes === 1 ? '' : 's'} · works once`;
}

export async function issuePairingLink(): Promise<ApiResult<PairingLinkBody>> {
  return readResult(await fetch('/api/pairing/credentials', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({}),
  }));
}

export async function addTrustedAddress(origin: string): Promise<ApiResult<{ origin: string; added: boolean }>> {
  return readResult(await fetch('/api/anywhere/trusted-origins', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ origin }),
  }));
}

/** Query function for `['anywhere-devices']`: the device rows, or a thrown error. */
export async function loadDevices(): Promise<DeviceRow[]> {
  const result = await fetchDevices();
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body.devices;
}

/** Query function for `['anywhere-status']`: the status, or a thrown error. */
export async function loadAnywhereStatus(): Promise<AnywhereStatus> {
  const result = await fetchAnywhereStatus();
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body;
}

/** Mint a `kind: 'token'` access token (PAN-4649). Only a root browser may; a paired device gets 403. */
export async function createAccessToken(name: string, scopes: readonly string[]): Promise<ApiResult<CreatedAccessToken>> {
  return readResult(await fetch('/api/access-tokens', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ name, scopes }),
  }));
}

/** A client config carrying the MCP URL and its Authorization header; the token never goes in the URL. */
export function mcpClientConfig(url: string, token: string): string {
  return JSON.stringify({ mcpServers: { overdeck: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** Query function for the access-token rows (`kind: 'token'` only); a 403 throws `AccessTokensForbiddenError`. */
export async function loadAccessTokens(): Promise<AccessTokenRecord[]> {
  const result = await readResult<{ tokens: AccessTokenRecord[] }>(await fetch('/api/access-tokens'));
  if (result.status === 403) throw new AccessTokensForbiddenError(apiError(result));
  if (!isOk(result)) throw new Error(apiError(result));
  return result.body.tokens ?? [];
}

export async function revokeAccessToken(id: string): Promise<ApiResult<{ ok: true }>> {
  return readResult(await fetch(`/api/access-tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export async function fetchTriggers(): Promise<ApiResult<TriggersList>> {
  return readResult(await fetch('/api/triggers'));
}

export async function removeTrigger(id: string): Promise<ApiResult<{ removed: true }>> {
  return readResult(await fetch(`/api/triggers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

export interface CreateTriggerInput {
  name: string;
  target: { kind: 'conversation'; conversation: string } | { kind: 'project'; projectKey: string };
  template: string | null;
  verify: TriggerRow['verify'];
  signingSecret: string | null;
  /** Ask the overdeck.ai directory for an inbox (PAN-2356). */
  inbox?: boolean;
}

/** The create response: the only time the URL secret and a generated signing secret are shown. */
export interface CreatedTriggerBody {
  trigger: TriggerRow;
  hookPath: string;
  url: string | null;
  urlSecretShownOnce: true;
  generatedSigningSecret: string | null;
  /** The inbox URL, shown once, when the trigger was created with `inbox: true`. */
  inboxUrl?: string | null;
}

export async function createTrigger(input: CreateTriggerInput): Promise<ApiResult<CreatedTriggerBody>> {
  return readResult(await fetch('/api/triggers', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

export async function setTriggerSigningSecret(id: string, secret: string): Promise<ApiResult<{ trigger: TriggerRow }>> {
  return readResult(await fetch(`/api/triggers/${encodeURIComponent(id)}/signing-secret`, {
    method: 'PUT',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ secret }),
  }));
}

/** Query function for `['anywhere-triggers']`: the triggers and Funnel facts, or a thrown error. */
export async function loadTriggers(): Promise<TriggersList> {
  const result = await fetchTriggers();
  if (!isOk(result)) throw new Error(apiError(result));
  return { ...result.body, triggers: result.body.triggers ?? [] };
}
