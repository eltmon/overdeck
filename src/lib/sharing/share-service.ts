/**
 * HTTP client for the Shared Sessions share service (PRD PAN-4473 WI-3), plus its URL config.
 *
 * The share service URL is read from `${OVERDECK_HOME}/config.yaml` on every share creation:
 *
 *   anywhere:
 *     share_url: https://share.overdeck.ai   # the default
 *
 * It must be `https:`, or `http:` to a loopback host for local development, with no query,
 * fragment or credentials (the same rules as `anywhere.directory_url`).
 *
 * `createRoom` authenticates with the device token and `deleteRoom` with the room's host token.
 * Neither function logs, and no failure carries a token.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { CreateRoomResponse, ShareScope } from '@overdeck/contracts';

import { getOverdeckHome } from '../paths.js';
import { isLoopbackOrigin } from '../remote-access/loopback.js';

export const DEFAULT_SHARE_URL = 'https://share.overdeck.ai';
export const SHARE_HTTP_TIMEOUT_MS = 10_000;

export type ShareUrlResult = { url: string } | { error: string };
export type ShareServiceFailure = { ok: false; status: number | null; error: string };

const SHORT_CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/;
const HOST_TOKEN_RE = /^odh_[0-9a-f]{64}$/;

/** Validates one configured value; the answer never ends in a slash. */
export function parseShareUrl(raw: unknown): ShareUrlResult {
  if (raw === undefined || raw === null || raw === '') return { url: DEFAULT_SHARE_URL };
  if (typeof raw !== 'string') return { error: 'anywhere.share_url must be a URL string' };
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: `anywhere.share_url is not a valid URL: ${raw}` };
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    return { error: 'anywhere.share_url must not carry a query, fragment or credentials' };
  }
  const insecureLoopback = parsed.protocol === 'http:' && isLoopbackOrigin(parsed.href);
  if (parsed.protocol !== 'https:' && !insecureLoopback) {
    return { error: 'anywhere.share_url must use https:, or http: to a loopback host' };
  }
  return { url: parsed.href.replace(/\/+$/, '') };
}

export async function readShareUrl(): Promise<ShareUrlResult> {
  let text: string;
  try {
    text = await readFile(join(getOverdeckHome(), 'config.yaml'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { url: DEFAULT_SHARE_URL };
    return { error: `Cannot read config.yaml: ${(error as Error).message}` };
  }
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (error) {
    return { error: `Cannot parse config.yaml: ${(error as Error).message}` };
  }
  const anywhere = typeof doc === 'object' && doc !== null ? (doc as { anywhere?: unknown }).anywhere : undefined;
  const raw = typeof anywhere === 'object' && anywhere !== null ? (anywhere as { share_url?: unknown }).share_url : undefined;
  return parseShareUrl(raw);
}

/** `https://host` → `wss://host/v1/rooms/<code>/host?v=1`; loopback `http:` → `ws:`. */
export function hostSocketUrl(base: string, shortCode: string): string {
  return `${base.replace(/^http/, 'ws')}/v1/rooms/${shortCode}/host?v=1`;
}

/** `https://host` → `wss://host/v1/rooms/<code>/join?v=1`; loopback `http:` → `ws:`. */
export function joinSocketUrl(base: string, shortCode: string): string {
  return `${base.replace(/^http/, 'ws')}/v1/rooms/${shortCode}/join?v=1`;
}

/** The origin of a parsed share URL (`https://share.overdeck.ai`), for the probe's CORS check. */
export function shareOrigin(base: string): string {
  return new URL(base).origin;
}

function isJoinUrl(value: unknown, shortCode: string): boolean {
  if (typeof value !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const schemeOk = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackOrigin(parsed.href));
  return schemeOk && parsed.pathname.endsWith(`/s/${shortCode}`);
}

function isCreateRoomResponse(value: unknown): value is CreateRoomResponse {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  if (typeof body.shortCode !== 'string' || !SHORT_CODE_RE.test(body.shortCode)) return false;
  if (typeof body.hostToken !== 'string' || !HOST_TOKEN_RE.test(body.hostToken)) return false;
  if (!isJoinUrl(body.joinUrl, body.shortCode)) return false;
  const snapshot = body.snapshot;
  if (typeof snapshot !== 'object' || snapshot === null) return false;
  const snap = snapshot as Record<string, unknown>;
  return Array.isArray(snap.participants) && Array.isArray(snap.blocked);
}

async function errorCodeOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const code = (body as { error?: unknown }).error;
      if (typeof code === 'string' && code.length > 0) return code;
    }
  } catch {
    // Not JSON; fall through to the status code.
  }
  return `http_${res.status}`;
}

/** Runs one request with a `SHARE_HTTP_TIMEOUT_MS` deadline (AbortController, so fake timers apply). */
async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ res: Response } | ShareServiceFailure> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SHARE_HTTP_TIMEOUT_MS);
  try {
    // Race the deadline as well, in case an injected fetch ignores the abort signal.
    const deadline = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const res = await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), deadline]);
    return { res };
  } catch {
    return { ok: false, status: null, error: timedOut ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export async function createRoom(
  base: string,
  deviceToken: string,
  scope: ShareScope,
  opts: { fetch?: typeof fetch } = {},
): Promise<{ ok: true; room: CreateRoomResponse } | ShareServiceFailure> {
  const result = await request(opts.fetch ?? fetch, `${base}/v1/rooms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  });
  if (!('res' in result)) return result;
  const { res } = result;
  if (res.status !== 201) return { ok: false, status: res.status, error: await errorCodeOf(res) };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: 201, error: 'bad_response' };
  }
  if (!isCreateRoomResponse(body)) return { ok: false, status: 201, error: 'bad_response' };
  return { ok: true, room: body };
}

export async function deleteRoom(
  base: string,
  shortCode: string,
  hostToken: string,
  opts: { fetch?: typeof fetch } = {},
): Promise<{ ok: true } | ShareServiceFailure> {
  const result = await request(opts.fetch ?? fetch, `${base}/v1/rooms/${shortCode}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${hostToken}` },
  });
  if (!('res' in result)) return result;
  const { res } = result;
  if (res.status === 204 || res.status === 404) return { ok: true };
  return { ok: false, status: res.status, error: await errorCodeOf(res) };
}
