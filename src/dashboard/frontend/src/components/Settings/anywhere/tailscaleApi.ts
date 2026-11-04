/**
 * Client for the Tailscale routes (PAN-1254): status, userspace install,
 * sign-in, Serve HTTPS and tailnet peers, plus the terminal panes the setup
 * dialog runs installer commands in. Same `{ status, body }` result shape as
 * `anywhereApi.ts`.
 */
import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import type { ApiResult } from './anywhereApi';

export type TailscaleNextStep =
  | 'install'
  | 'start-daemon'
  | 'operator'
  | 'login'
  | 'enable-https'
  | 'serve'
  | 'protect'
  | 'ready';

/** Mirrors `TailscaleState` in src/lib/tailscale/state.ts (the fields the UI reads). */
export interface TailscaleState {
  installed: boolean;
  mode: 'system' | 'app' | 'userspace' | null;
  version: string | null;
  daemonRunning: boolean;
  backendState: string | null;
  authUrl: string | null;
  magicDnsName: string | null;
  serveUrl: string | null;
  loginName: string | null;
  serve: { proxiesDashboard: boolean; otherHandlerOn443: boolean; funnelOn443: boolean };
  requireTokenMint: boolean;
  nextStep: TailscaleNextStep;
}

/** Mirrors `InstallPlan` in src/lib/tailscale/installer.ts. */
export type InstallPlan =
  | { kind: 'pane'; command: string }
  | { kind: 'userspace' }
  | { kind: 'manual'; message: string; url: string; command?: string };

export interface TailscaleStatusBody {
  state: TailscaleState;
  install: InstallPlan;
  operatorCommand: string | null;
  port: number;
  platform: string;
  userspaceAvailable: boolean;
}

export type ServeResult =
  | { ok: true; url: string; selfCheck: 'passed' | 'skipped-userspace'; changed: boolean }
  | { ok: false; reason: string; message: string; adminUrl?: string };

export type UserspaceResult =
  | { ok: true }
  | { ok: false; reason: string; message: string; fallbackCommand?: string };

/** Mirrors `TailnetPeer` in src/lib/tailscale/peers.ts. */
export interface TailnetPeer {
  hostName: string;
  dnsName: string | null;
  os: string | null;
  online: boolean;
  overdeck: { environmentId: string; label: string; serverVersion: string; url: string } | null;
}

export const TAILSCALE_STATUS_QUERY_KEY = ['tailscale-status'] as const;

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

async function post<T>(url: string, body: unknown = {}): Promise<ApiResult<T>> {
  return readResult(await fetch(url, {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(body),
  }));
}

export async function fetchTailscaleStatus(userspace = false): Promise<ApiResult<TailscaleStatusBody>> {
  return readResult(await fetch(userspace ? '/api/tailscale/status?userspace=1' : '/api/tailscale/status'));
}

export function postUserspace(): Promise<ApiResult<UserspaceResult>> {
  return post('/api/tailscale/userspace');
}

export function postLogin(): Promise<ApiResult<{ authUrl: string | null }>> {
  return post('/api/tailscale/login');
}

export function postServe(): Promise<ApiResult<ServeResult>> {
  return post('/api/tailscale/serve');
}

export async function fetchPeers(): Promise<ApiResult<{ peers: TailnetPeer[] }>> {
  return readResult(await fetch('/api/tailscale/peers'));
}

/** Open a terminal pane that runs `command` (POST /api/terminals). */
export function createPane(command: string): Promise<ApiResult<{ sessionName: string }>> {
  return post('/api/terminals', { command });
}

/** Close a pane the dialog created. Idempotent on the server. */
export async function deletePane(sessionName: string): Promise<void> {
  try {
    await fetch(`/api/terminals/${encodeURIComponent(sessionName)}`, {
      method: 'DELETE',
      headers: await dashboardMutationJsonHeaders(),
    });
  } catch {
    // Best effort: an orphaned pane is harmless and the terminal list shows it.
  }
}
