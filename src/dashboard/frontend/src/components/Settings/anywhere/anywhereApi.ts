/**
 * Client for the Overdeck Anywhere routes (PAN-4445): paired devices, pairing
 * links, trusted addresses and the Anywhere status. These call the same server
 * routes as `pan pair` and `pan devices`.
 *
 * Every fetcher returns `{ status, body }` so a caller can branch on 403 (a
 * paired device's session cannot create pairing links or add addresses).
 */
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';

export interface DeviceRow {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type AnywhereVaultState = 'off' | 'locked' | 'rotation-pending' | 'ready';

export type AnywhereAction =
  | { kind: 'pair-dialog' }
  | { kind: 'settings-section'; section: 'session-vault' }
  | { kind: 'none'; docsUrl?: string };

export interface AnywhereProblem {
  code: 'identity-unreadable' | 'no-reachable-address' | 'vault-locked' | 'vault-rotation-pending';
  message: string;
  action: AnywhereAction;
}

/** Mirrors `AnywhereStatus` in src/lib/remote-access/anywhere-status.ts. */
export interface AnywhereStatus {
  machine: { environmentId: string; label: string } | null;
  addresses: Array<{ origin: string; loopback: boolean }>;
  devices: { active: number };
  vault: { state: AnywhereVaultState; backend: string | null };
  problems: AnywhereProblem[];
  /** Who is asking (PAN-4455 D-3); null when no credential resolves. */
  viewer: { kind: 'root-session' | 'device' | 'token' | 'internal-token' | null };
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
