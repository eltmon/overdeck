/**
 * RFC 8628 device authorization grant for the CLI, SSH and headless machines (PRD PAN-4293 §7.7; D-11, D-12, D-13).
 *
 * POST /oauth/device/code mints a device code and an 8-letter user code (both stored as hashes); the user types
 * the code at /activate, confirms, and completes the GitHub leg; the CLI polls POST /oauth/token with
 * grant_type=urn:ietf:params:oauth:grant-type:device_code and gets authorization_pending, slow_down,
 * access_denied, expired_token or the token.
 */
import { randomHex, sha256Hex, userCode } from './crypto.ts';
import { defaultLabel, isValidEnvironmentId, isValidPlatform, mintDevice } from './devices.ts';
import type { Handler, RequestContext } from './env.ts';
import type { GitHubIdentity } from './github.ts';
import { isAllowed } from './grants.ts';
import { html, json, readForm } from './http.ts';
import { errorPage, escapeHtml, inviteOnlyPage, layout, messagePage, rateLimitedPage } from './pages.ts';
import { hit, peek } from './rate-limit.ts';
import { resolveSignIn, startGitHubLeg, type Payload } from './sign-in.ts';

export const DEVICE_GRANT_TTL_MS = 900_000;
export const DEVICE_POLL_INTERVAL_S = 5;
export const INVALID_CODE_MESSAGE = 'That code is not valid or has expired.';
export const TOO_MANY_WRONG_CODES_MESSAGE = 'Too many wrong codes. Wait 15 minutes and try again.';
export const CODE_EXPIRED_MESSAGE = 'This code expired. Run the sign-in command again.';
export const DEVICE_CONNECTED_MESSAGE = 'Device connected. You can close this tab and return to your terminal.';
export const ACCOUNT_DELETING_MESSAGE = 'This account is being deleted. Try again after deletion finishes.';
export const REQUEST_REJECTED_MESSAGE = 'Request rejected.';

/**
 * The /activate POSTs must come from the activate page itself: a cross-site form post could otherwise walk a
 * victim's browser through the GitHub leg and approve an attacker's device code with the victim's account.
 */
function sameOrigin(req: Request, rc: RequestContext): boolean {
  return req.headers.get('Origin') === new URL(rc.config.publicBaseUrl).origin;
}

type GrantStatus = 'pending' | 'approved' | 'denied';

interface DeviceGrantRow {
  device_code_hash: string;
  user_code_hash: string;
  platform: string;
  environment_id: string;
  status: GrantStatus;
  user_id: string | null;
  interval_s: number;
  last_polled_at: number | null;
  created_at: number;
  expires_at: number;
}

export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Uppercase; drop dashes and spaces. */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** POST /oauth/device/code */
export const issueCode: Handler = async (req, rc) => {
  const form = await readForm(req);
  const platform = form?.get('platform') ?? '';
  const environmentId = form?.get('environment_id') ?? '';
  if (!form || !isValidPlatform(platform) || !isValidEnvironmentId(environmentId)) return json({ error: 'invalid_request' }, 400);

  const deviceCode = `oddc_${randomHex(32)}`;
  const deviceCodeHash = await sha256Hex(deviceCode);
  const now = rc.deps.now();
  let code = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    code = userCode();
    try {
      await rc.env.DB.prepare(
        `INSERT INTO device_grants (device_code_hash, user_code_hash, platform, environment_id, status, interval_s, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
        .bind(deviceCodeHash, await sha256Hex(code), platform, environmentId, DEVICE_POLL_INTERVAL_S, now, now + DEVICE_GRANT_TTL_MS)
        .run();
      break;
    } catch (error) {
      if (attempt === 2 || !/UNIQUE/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  const base = rc.config.publicBaseUrl;
  return json({
    device_code: deviceCode,
    user_code: formatUserCode(code),
    verification_uri: `${base}/activate`,
    verification_uri_complete: `${base}/activate?user_code=${code}`,
    expires_in: DEVICE_GRANT_TTL_MS / 1000,
    interval: DEVICE_POLL_INTERVAL_S,
  });
};

function activateForm(prefill: string, error: string | null): string {
  const notice = error ? `<p class="warn">${escapeHtml(error)}</p>` : '';
  return layout(
    'Connect a device',
    `<h1>Connect a device</h1>
<p>Enter the code shown in your terminal.</p>
${notice}
<form method="post" action="/activate">
  <label>Code <input name="user_code" value="${escapeHtml(prefill)}" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
  <button type="submit">Continue</button>
</form>`,
  );
}

/** GET /activate[?user_code=…] */
export const activatePage: Handler = async (req, _rc) => {
  const raw = new URL(req.url).searchParams.get('user_code') ?? '';
  const normalized = normalizeUserCode(raw);
  return html(activateForm(normalized.length === 8 ? formatUserCode(normalized) : raw, null));
};

async function findPendingGrantByUserCode(rc: RequestContext, rawCode: string): Promise<DeviceGrantRow | null> {
  const normalized = normalizeUserCode(rawCode);
  if (normalized.length !== 8) return null;
  return rc.env.DB.prepare("SELECT * FROM device_grants WHERE user_code_hash = ? AND status = 'pending' AND expires_at > ?")
    .bind(await sha256Hex(normalized), rc.deps.now())
    .first<DeviceGrantRow>();
}

/** POST /activate: look the code up; wrong codes count against `activate-fail` (D-12), and an exhausted window refuses before any lookup. */
export const activateSubmit: Handler = async (req, rc) => {
  if (!sameOrigin(req, rc)) return errorPage(403, REQUEST_REJECTED_MESSAGE, 'Request rejected');
  const exhausted = await peek(rc, 'activate-fail');
  if (!exhausted.ok) return rateLimitedPage(exhausted.retryAfterS, TOO_MANY_WRONG_CODES_MESSAGE);
  const form = await readForm(req);
  const raw = form?.get('user_code') ?? '';
  const grant = await findPendingGrantByUserCode(rc, raw);
  if (!grant) {
    const verdict = await hit(rc, 'activate-fail');
    if (!verdict.ok) return rateLimitedPage(verdict.retryAfterS, TOO_MANY_WRONG_CODES_MESSAGE);
    return html(activateForm(raw, INVALID_CODE_MESSAGE), 400);
  }
  const normalized = normalizeUserCode(raw);
  return html(
    layout(
      'Connect a device',
      `<h1>Connect a device</h1>
<p>Connect a <strong>${escapeHtml(defaultLabel(grant.platform))}</strong> to your Overdeck account?</p>
<p class="muted">Code ${escapeHtml(formatUserCode(normalized))}. If you did not start this sign-in, close this tab.</p>
<form method="post" action="/activate/confirm">
  <input type="hidden" name="user_code" value="${escapeHtml(normalized)}">
  <button type="submit">Continue with GitHub</button>
</form>`,
    ),
  );
};

/** POST /activate/confirm: re-validate, then start the GitHub leg bound to this device code. */
export const activateConfirm: Handler = async (req, rc) => {
  if (!sameOrigin(req, rc)) return errorPage(403, REQUEST_REJECTED_MESSAGE, 'Request rejected');
  const form = await readForm(req);
  const grant = await findPendingGrantByUserCode(rc, form?.get('user_code') ?? '');
  if (!grant) return html(activateForm('', INVALID_CODE_MESSAGE), 400);
  return startGitHubLeg(rc, 'device', { deviceCodeHash: grant.device_code_hash });
};

async function findPendingGrantByHash(rc: RequestContext, payload: Payload): Promise<DeviceGrantRow | null> {
  const hash = payload.deviceCodeHash;
  if (typeof hash !== 'string') return null;
  return rc.env.DB.prepare("SELECT * FROM device_grants WHERE device_code_hash = ? AND status = 'pending' AND expires_at > ?")
    .bind(hash, rc.deps.now())
    .first<DeviceGrantRow>();
}

function setStatus(rc: RequestContext, hash: string, status: GrantStatus, userId: string | null = null) {
  return rc.env.DB.prepare('UPDATE device_grants SET status = ?, user_id = ? WHERE device_code_hash = ?').bind(status, userId, hash).run();
}

/** GitHub leg continuation for purpose 'device' (§7.7 step 5). */
export async function onGitHubIdentity(rc: RequestContext, payload: Payload, identity: GitHubIdentity): Promise<Response> {
  const grant = await findPendingGrantByHash(rc, payload);
  if (!grant) return errorPage(400, CODE_EXPIRED_MESSAGE, 'Code expired');
  const resolution = await resolveSignIn(rc, identity, 'device');
  if (!resolution.allowed) {
    await setStatus(rc, grant.device_code_hash, 'denied');
    return resolution.reason === 'account_deleting' ? errorPage(403, ACCOUNT_DELETING_MESSAGE, 'Account deletion in progress') : inviteOnlyPage();
  }
  await setStatus(rc, grant.device_code_hash, 'approved', resolution.userId);
  return messagePage(200, 'Device connected', DEVICE_CONNECTED_MESSAGE);
}

/** The user cancelled on github.com: the CLI's next poll gets access_denied. */
export async function onGitHubDenied(rc: RequestContext, payload: Payload): Promise<Response> {
  const grant = await findPendingGrantByHash(rc, payload);
  if (grant) await setStatus(rc, grant.device_code_hash, 'denied');
  return errorPage(400, 'Sign-in was cancelled on GitHub. Run the sign-in command again.', 'Sign-in cancelled');
}

/** POST /oauth/token with grant_type=urn:ietf:params:oauth:grant-type:device_code (§7.7 step 6, RFC 8628 §3.5). */
export async function exchangeDeviceCode(rc: RequestContext, form: URLSearchParams): Promise<Response> {
  const deviceCode = form.get('device_code') ?? '';
  if (deviceCode === '') return json({ error: 'invalid_request' }, 400);
  const db = rc.env.DB;
  const hash = await sha256Hex(deviceCode);
  const row = await db.prepare('SELECT * FROM device_grants WHERE device_code_hash = ?').bind(hash).first<DeviceGrantRow>();
  if (!row) return json({ error: 'invalid_grant' }, 400);
  const now = rc.deps.now();
  const remove = () => db.prepare('DELETE FROM device_grants WHERE device_code_hash = ?').bind(hash).run();

  if (row.expires_at <= now) {
    await remove();
    return json({ error: 'expired_token' }, 400);
  }
  if (row.last_polled_at !== null && now - row.last_polled_at < row.interval_s * 1000) {
    const interval = row.interval_s + 5;
    await db.prepare('UPDATE device_grants SET interval_s = ?, last_polled_at = ? WHERE device_code_hash = ?').bind(interval, now, hash).run();
    return json({ error: 'slow_down', interval }, 400);
  }
  await db.prepare('UPDATE device_grants SET last_polled_at = ? WHERE device_code_hash = ?').bind(now, hash).run();

  if (row.status === 'pending') return json({ error: 'authorization_pending' }, 400);
  if (row.status === 'denied' || row.user_id === null) {
    await remove();
    return json({ error: 'access_denied' }, 400);
  }
  // Consume atomically: two concurrent polls cannot both mint from one approved grant.
  const consumed = await db.prepare("DELETE FROM device_grants WHERE device_code_hash = ? AND status = 'approved' RETURNING *").bind(hash).first<DeviceGrantRow>();
  if (!consumed || consumed.user_id === null) return json({ error: 'invalid_grant' }, 400);
  const user = await db.prepare('SELECT github_id, deleted_at FROM users WHERE user_id = ?').bind(consumed.user_id).first<{ github_id: number; deleted_at: number | null }>();
  if (!user || user.deleted_at !== null || !(await isAllowed(rc, user.github_id))) return json({ error: 'access_denied' }, 400);
  const minted = await mintDevice(rc, consumed.user_id, consumed.platform, consumed.environment_id);
  return json({ access_token: minted.token, token_type: 'Bearer', device_id: minted.deviceId, label: minted.label });
}
