/**
 * HTTP client for the overdeck.ai account service: base URL resolution, the RFC 8628 device
 * flow, `/v1/me` and device revocation (PRD PAN-4330 W-3, D-2, D-3, D-5).
 *
 * Every poll wait is a `setTimeout` promise so fake timers in tests drive them; nothing here
 * waits on real wall-clock time. No error message or thrown value ever includes the device
 * token. This module imports only Node built-ins so the standalone `pan account` CLI can load
 * it without the dashboard or Effect runtime layers.
 */

export const DEFAULT_ACCOUNT_BASE_URL = 'https://account.overdeck.ai';

const PLATFORM_ARCH_RE = /^(linux|darwin|win32)-(x64|arm64)$/;
const LOCAL_HTTP_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class AccountClientError extends Error {}

export interface ClientOptions {
  fetch?: typeof fetch;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type PollOutcome =
  | { ok: true; accessToken: string; deviceId: string; label: string }
  | { ok: false; reason: 'access_denied' | 'expired_token' | 'unreachable' | 'failed'; detail: string };

export interface Entitlement {
  plan: 'free' | 'tester';
  storageBytesCap: number;
  maxDevices: number | null;
}

export interface Me {
  userId: string;
  githubId: number;
  githubLogin: string;
  deviceId: string;
  entitlement: Entitlement;
  access: { status: 'active' | 'grant_expired'; expiresAt: number | null };
}

export type MeResult =
  | { ok: true; me: Me }
  | { ok: false; kind: 'unauthorized'; error: string }
  | { ok: false; kind: 'unreachable'; detail: string };

export type RevokeResult = { ok: true; status: 204 | 401 | 404 } | { ok: false; detail: string };

/** D-2: flag > OVERDECK_ACCOUNT_URL > default; https only, http only for loopback hosts, no path/query/fragment. */
export function resolveBaseUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const raw = flag ?? env.OVERDECK_ACCOUNT_URL ?? DEFAULT_ACCOUNT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AccountClientError(`Invalid account service URL: ${raw}`);
  }
  const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname));
  const pathOk = url.pathname === '/' || url.pathname === '';
  const bareOk = url.search === '' && url.hash === '';
  if (!schemeOk || !pathOk || !bareOk) {
    throw new AccountClientError(`Invalid account service URL: ${raw}`);
  }
  return url.origin;
}

/** D-3: null unless `${platform}-${arch}` matches the service's PLATFORM_RE. */
export function platformString(platform: string = process.platform, arch: string = process.arch): string | null {
  const value = `${platform}-${arch}`;
  return PLATFORM_ARCH_RE.test(value) ? value : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function postForm(baseUrl: string, path: string, body: URLSearchParams, doFetch: typeof fetch): Promise<Response> {
  return doFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

/** POST /oauth/device/code */
export async function requestDeviceCode(
  baseUrl: string,
  input: { platform: string; environmentId: string },
  opts: ClientOptions = {},
): Promise<DeviceCode> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await postForm(baseUrl, '/oauth/device/code', new URLSearchParams({ platform: input.platform, environment_id: input.environmentId }), doFetch);
  } catch (error) {
    throw new AccountClientError(`Cannot reach ${baseUrl}: ${describeError(error)}`);
  }
  if (!res.ok) {
    throw new AccountClientError(`Cannot start sign-in at ${baseUrl}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: body.verification_uri_complete,
    expiresIn: body.expires_in,
    interval: body.interval,
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** D-5: POST /oauth/token in a loop, waiting one `interval` before the first poll. */
export async function pollForToken(
  baseUrl: string,
  code: DeviceCode,
  opts: ClientOptions & { onWait?: (seconds: number) => void } = {},
): Promise<PollOutcome> {
  const doFetch = opts.fetch ?? fetch;
  let interval = code.interval;
  let waitSeconds = interval;
  let elapsedSeconds = 0;
  let consecutiveFailures = 0;

  while (true) {
    opts.onWait?.(waitSeconds);
    await sleep(waitSeconds * 1000);
    elapsedSeconds += waitSeconds;
    if (elapsedSeconds >= code.expiresIn) {
      return { ok: false, reason: 'expired_token', detail: 'The sign-in code expired.' };
    }

    let res: Response;
    try {
      res = await postForm(
        baseUrl,
        '/oauth/token',
        new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.deviceCode }),
        doFetch,
      );
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) return { ok: false, reason: 'unreachable', detail: describeError(error) };
      waitSeconds = interval;
      continue;
    }

    if (res.status >= 500) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) return { ok: false, reason: 'unreachable', detail: `HTTP ${res.status}` };
      waitSeconds = interval;
      continue;
    }
    if (res.status === 429) {
      consecutiveFailures = 0;
      waitSeconds = parseRetryAfter(res.headers.get('Retry-After')) ?? interval;
      continue;
    }
    consecutiveFailures = 0;

    if (res.ok) {
      const body = (await res.json()) as { access_token: string; device_id: string; label: string };
      return { ok: true, accessToken: body.access_token, deviceId: body.device_id, label: body.label };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: string; interval?: number };
    switch (body.error) {
      case 'authorization_pending':
        waitSeconds = interval;
        continue;
      case 'slow_down':
        interval = typeof body.interval === 'number' ? body.interval : interval + 5;
        waitSeconds = interval;
        continue;
      case 'access_denied':
        return { ok: false, reason: 'access_denied', detail: 'access_denied' };
      case 'expired_token':
        return { ok: false, reason: 'expired_token', detail: 'expired_token' };
      default:
        return { ok: false, reason: 'failed', detail: body.error ?? `HTTP ${res.status}` };
    }
  }
}

/** GET /v1/me */
export async function getMe(baseUrl: string, token: string, opts: ClientOptions = {}): Promise<MeResult> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    return { ok: false, kind: 'unreachable', detail: describeError(error) };
  }
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, kind: 'unauthorized', error: body.error ?? 'invalid_token' };
  }
  if (!res.ok) {
    return { ok: false, kind: 'unreachable', detail: `HTTP ${res.status}` };
  }
  const me = (await res.json()) as Me;
  return { ok: true, me };
}

/** DELETE /v1/devices/:id */
export async function revokeDevice(baseUrl: string, token: string, deviceId: string, opts: ClientOptions = {}): Promise<RevokeResult> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${baseUrl}/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
  if (res.status === 204 || res.status === 401 || res.status === 404) {
    return { ok: true, status: res.status };
  }
  return { ok: false, detail: `HTTP ${res.status}` };
}
