/**
 * Admin screen: header, owner line, allowlisted accounts table, add form, revoke (PRD PAN-4293 §7.12 parts 1–4; D-9, D-14, D-15, D-26).
 * Server-rendered, no JavaScript; every value passes through escapeHtml().
 */
import { DEFAULT_STORAGE_CAP_BYTES } from '../entitlement.ts';
import type { Handler, RequestContext } from '../env.ts';
import { lookupUserByLogin } from '../github.ts';
import { addGrant as addGrantRow, listGrantsWithDeviceStats, revokeGrant as revokeGrantRow, type GrantWithStats } from '../grants.ts';
import { html, redirect } from '../http.ts';
import { errorPage, escapeHtml, layout } from '../pages.ts';
import { renderPendingSections } from './pending.ts';
import { requireOwnerSession, type AdminSession } from './session.ts';

const GIB = 1024 ** 3;
const USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NOTE_MAX = 200;
export const CAP_GB_MIN = 1;
export const CAP_GB_MAX = 1000;
export const USER_NOT_FOUND_MESSAGE = 'GitHub user not found.';
export const GITHUB_RATE_LIMIT_MESSAGE = 'GitHub rate limit reached; try again in a few minutes.';
export const GITHUB_LOOKUP_FAILED_MESSAGE = 'GitHub lookup failed; try again.';
export const ALLOW_SEMANTICS_MESSAGE = 'Allowing an account lets it sign in. Ask the person to sign in again.';

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export function formatCap(bytes: number | null): string {
  const value = bytes ?? DEFAULT_STORAGE_CAP_BYTES;
  const gb = value / GIB;
  return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(2)} GB`;
}

function expiresCell(expiresAt: number | null, now: number): string {
  if (expiresAt === null) return 'never';
  if (expiresAt <= now) return `<span class="warn">expired</span> ${escapeHtml(formatDate(expiresAt))}`;
  return escapeHtml(formatDate(expiresAt));
}

function grantRow(g: GrantWithStats, csrf: string, now: number): string {
  return `<tr>
<td><a href="https://github.com/${escapeHtml(g.github_login)}">${escapeHtml(g.github_login)}</a></td>
<td>${escapeHtml(g.github_id)}</td>
<td>${escapeHtml(formatDate(g.granted_at))}</td>
<td>${escapeHtml(g.entitlement)}</td>
<td>${escapeHtml(formatCap(g.storage_cap_bytes))}</td>
<td>${escapeHtml(g.note ?? '')}</td>
<td>${expiresCell(g.expires_at, now)}</td>
<td>${escapeHtml(g.active_devices)}</td>
<td>${g.last_seen_at === null ? '—' : escapeHtml(formatDateTime(g.last_seen_at))}</td>
<td><form class="inline" method="post" action="/admin/grants/${escapeHtml(g.github_id)}/revoke"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Revoke</button></form></td>
</tr>`;
}

export interface AddFormState {
  error?: string;
  values?: { username?: string; note?: string; expires?: string; cap_gb?: string };
}

function addForm(csrf: string, state: AddFormState): string {
  const v = state.values ?? {};
  const error = state.error ? `<p class="warn">${escapeHtml(state.error)}</p>` : '';
  return `<h2>Add an account</h2>
${error}
<form method="post" action="/admin/grants">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<p><label>GitHub username <input name="username" value="${escapeHtml(v.username ?? '')}" required maxlength="39" autocomplete="off"></label></p>
<p><label>Note (optional) <input name="note" value="${escapeHtml(v.note ?? '')}" maxlength="${NOTE_MAX}"></label></p>
<p><label>Expires (optional, UTC) <input name="expires" type="date" value="${escapeHtml(v.expires ?? '')}"></label></p>
<p><label>Storage cap in GB (optional, ${CAP_GB_MIN}–${CAP_GB_MAX}; default 5) <input name="cap_gb" type="number" min="${CAP_GB_MIN}" max="${CAP_GB_MAX}" step="1" value="${escapeHtml(v.cap_gb ?? '')}"></label></p>
<p><button type="submit">Add</button></p>
</form>`;
}

/** The whole admin page. `state` carries an add-form error to re-render above the form. */
export async function renderAdminPage(rc: RequestContext, session: AdminSession, state: AddFormState = {}, status = 200): Promise<Response> {
  const now = rc.deps.now();
  const grants = await listGrantsWithDeviceStats(rc);
  const rows = grants.map((g) => grantRow(g, session.csrfToken, now)).join('\n');
  const body = `<h1>Overdeck accounts (invite-only)</h1>
<p class="muted">Signed in as GitHub id ${escapeHtml(session.githubId)}.
<form class="inline" method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}"><button type="submit">Sign out</button></form></p>
<p>Owner (always allowed): GitHub id ${escapeHtml(rc.config.ownerGithubId)}</p>
<h2>Allowlisted accounts</h2>
<table>
<thead><tr><th>Login</th><th>GitHub id</th><th>Granted</th><th>Entitlement</th><th>Storage cap</th><th>Note</th><th>Expires</th><th>Active devices</th><th>Last seen</th><th></th></tr></thead>
<tbody>
${rows || '<tr><td colspan="10" class="muted">No accounts allowlisted yet.</td></tr>'}
</tbody>
</table>
${addForm(session.csrfToken, state)}
${await renderPendingSections(rc, session)}`;
  return html(layout('Overdeck accounts', body), status);
}

/** GET /admin */
export const page: Handler = async (req, rc) => {
  const owner = await requireOwnerSession(req, rc);
  if (!owner.ok) return owner.response;
  return renderAdminPage(rc, owner.session);
};

type AddInput = { ok: true; username: string; note: string | null; expiresAt: number | null; storageCapBytes: number | null } | { ok: false; error: string };

/** Validates the add form (§7.12 part 4). */
export function parseAddForm(form: URLSearchParams): AddInput {
  const username = (form.get('username') ?? '').trim();
  if (!USERNAME_RE.test(username)) return { ok: false, error: 'Enter a valid GitHub username.' };
  const noteRaw = (form.get('note') ?? '').trim();
  if (noteRaw.length > NOTE_MAX) return { ok: false, error: `The note must be ${NOTE_MAX} characters or fewer.` };
  const note = noteRaw === '' ? null : noteRaw;

  let expiresAt: number | null = null;
  const expires = (form.get('expires') ?? '').trim();
  if (expires !== '') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expires);
    const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999) : Number.NaN;
    if (!m || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== expires) return { ok: false, error: 'Enter the expiry as YYYY-MM-DD.' };
    expiresAt = ms;
  }

  let storageCapBytes: number | null = null;
  const capRaw = (form.get('cap_gb') ?? '').trim();
  if (capRaw !== '') {
    const cap = /^\d+$/.test(capRaw) ? Number(capRaw) : Number.NaN;
    if (!Number.isInteger(cap) || cap < CAP_GB_MIN || cap > CAP_GB_MAX) return { ok: false, error: `The storage cap must be a whole number of GB between ${CAP_GB_MIN} and ${CAP_GB_MAX}.` };
    storageCapBytes = cap * GIB;
  }
  return { ok: true, username, note, expiresAt, storageCapBytes };
}

/** POST /admin/grants */
export const addGrant: Handler = async (req, rc) => {
  const owner = await requireOwnerSession(req, rc);
  if (!owner.ok) return owner.response;
  const form = owner.form ?? new URLSearchParams();
  const values = { username: form.get('username') ?? '', note: form.get('note') ?? '', expires: form.get('expires') ?? '', cap_gb: form.get('cap_gb') ?? '' };
  const input = parseAddForm(form);
  if (!input.ok) return renderAdminPage(rc, owner.session, { error: input.error, values }, 400);

  const lookup = await lookupUserByLogin(rc, input.username);
  if (!lookup.ok) {
    const error = lookup.error === 'not_found' ? USER_NOT_FOUND_MESSAGE : lookup.error === 'rate_limited' ? GITHUB_RATE_LIMIT_MESSAGE : GITHUB_LOOKUP_FAILED_MESSAGE;
    return renderAdminPage(rc, owner.session, { error, values }, lookup.error === 'not_found' ? 404 : 502);
  }
  await addGrantRow(rc, lookup.identity.githubId, lookup.identity.login, { note: input.note, expiresAt: input.expiresAt, storageCapBytes: input.storageCapBytes }, 'admin-add');
  return redirect('/admin', 303);
};

/** POST /admin/grants/:githubId/revoke */
export const revokeGrant: Handler = async (req, rc) => {
  const owner = await requireOwnerSession(req, rc);
  if (!owner.ok) return owner.response;
  const githubId = /^\d+$/.test(rc.params.githubId ?? '') ? Number(rc.params.githubId) : null;
  if (githubId === null) return errorPage(404, 'No such account.', 'Not found');
  await revokeGrantRow(rc, githubId);
  return redirect('/admin', 303);
};
