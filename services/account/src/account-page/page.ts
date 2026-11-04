/**
 * The account page (PRD PAN-4959 WI-6; FR-3 to FR-9, FR-12; NFR-2).
 *
 * Server-rendered, no JavaScript; every value passes through escapeHtml(). The plan comes from D1
 * (entitlementFor of the grant row, expired or not), never from the Directory DO. Machines and relay use
 * come from the Directory DO; when it cannot answer, both sections say so and no Remove form is shown.
 */
import { formatDate, formatDateTime } from '../admin/screen.ts';
import { readDirectoryView, type DirectoryMachine, type DirectoryView } from '../directory-view.ts';
import { entitlementFor, FREE_PLAN_MAX_MACHINES, type Entitlement } from '../entitlement.ts';
import type { Handler, RequestContext } from '../env.ts';
import { getGrant, type GrantRow } from '../grants.ts';
import { html } from '../http.ts';
import { escapeHtml, layout } from '../pages.ts';
import { ACCOUNT_TITLE, identitySection, requireUserSession, type UserSession } from './session.ts';

export const INVITE_ONLY_PAID_MESSAGE = 'Paid plans are invite-only for now.';
export const DIRECTORY_UNAVAILABLE_MESSAGE = 'Machines and relay use are unavailable right now.';
export const RELAY_NOT_INCLUDED_MESSAGE = 'The relay is not included in the free account.';
export const BILLING_MESSAGE = 'Billing is not available yet. Paid plans are invite-only for now.';
export const REMOVE_NOTE = 'Remove signs that machine out of overdeck.ai and frees its place. Sign in on it again to add it back.';
export const DELETE_STATEMENT =
  'Deleting your account signs out every device, removes your machines from the directory and deletes all of your hosted data within 24 hours.';

export interface PageNotice {
  error?: string;
  status?: number;
}

/** Same rounding as the dashboard's relayTrafficText (AnywhereStatusCard.tsx): decimal GB, one decimal for used. */
export function relayTrafficText(bytesUsed: number, capBytes: number): string {
  const used = (bytesUsed / 1e9).toFixed(1);
  const cap = Number.isInteger(capBytes / 1e9) ? String(capBytes / 1e9) : (capBytes / 1e9).toFixed(1);
  return `${used} of ${cap} GB relay traffic this month`;
}

/** 00:00 UTC on the first day of the month after `now`, as YYYY-MM-DD. */
export function relayResetDate(now: number): string {
  const d = new Date(now);
  return formatDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

function accessText(grant: GrantRow | null, now: number): string {
  if (grant === null || grant.expires_at === null) return 'Access: No expiry';
  if (grant.expires_at <= now) return `Access: Expired on ${formatDate(grant.expires_at)}`;
  return `Access: Expires on ${formatDate(grant.expires_at)}`;
}

function planSection(entitlement: Entitlement, grant: GrantRow | null, now: number): string {
  return `<h2>Plan</h2>
<p>${entitlement.plan === 'free' ? 'Free account' : 'Tester'}</p>
<p>${escapeHtml(accessText(grant, now))}</p>
<p class="muted">${escapeHtml(INVITE_ONLY_PAID_MESSAGE)}</p>`;
}

function relaySection(entitlement: Entitlement, view: DirectoryView | null, now: number): string {
  const extra = `<p class="muted">Extra traffic: ${escapeHtml(INVITE_ONLY_PAID_MESSAGE)}</p>`;
  if (view === null) return `<h2>Relay</h2>\n<p>${escapeHtml(DIRECTORY_UNAVAILABLE_MESSAGE)}</p>`;
  if (entitlement.plan === 'free') return `<h2>Relay</h2>\n<p>${escapeHtml(RELAY_NOT_INCLUDED_MESSAGE)}</p>\n${extra}`;
  const reset = relayResetDate(now);
  const stopped = view.relay.stopped ? `\n<p class="warn">${escapeHtml(`Relay allowance used; it resets on ${reset}.`)}</p>` : '';
  return `<h2>Relay</h2>
<p>${escapeHtml(relayTrafficText(view.relay.bytesUsed, view.relay.capBytes))}</p>
<p>${escapeHtml(`Resets on ${reset} (UTC).`)}</p>${stopped}
${extra}`;
}

function machineCount(entitlement: Entitlement, n: number): string {
  if (entitlement.plan === 'free') return `${n} of ${FREE_PLAN_MAX_MACHINES} machines`;
  return n === 1 ? '1 machine' : `${n} machines`;
}

function lastSeenText(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '—' : formatDateTime(ms);
}

function machineRow(m: DirectoryMachine, csrf: string): string {
  return `<tr>
<td>${escapeHtml(m.label)}</td>
<td>${m.online ? 'Online' : 'Offline'}</td>
<td>${escapeHtml(lastSeenText(m.lastSeenAt))}</td>
<td>${escapeHtml(m.serverVersion)}</td>
<td><form class="inline" method="post" action="/account/machines/${escapeHtml(encodeURIComponent(m.environmentId))}/remove"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Remove</button></form></td>
</tr>`;
}

function machinesSection(entitlement: Entitlement, view: DirectoryView | null, csrf: string): string {
  if (view === null) return `<h2>Machines</h2>\n<p>${escapeHtml(DIRECTORY_UNAVAILABLE_MESSAGE)}</p>`;
  const count = `<p>${escapeHtml(machineCount(entitlement, view.machines.length))}</p>`;
  if (view.machines.length === 0) return `<h2>Machines</h2>\n${count}`;
  return `<h2>Machines</h2>
${count}
<table>
<thead><tr><th>Label</th><th>Status</th><th>Last seen</th><th>Version</th><th></th></tr></thead>
<tbody>
${view.machines.map((m) => machineRow(m, csrf)).join('\n')}
</tbody>
</table>
<p class="muted">${escapeHtml(REMOVE_NOTE)}</p>`;
}

function deleteSection(csrf: string): string {
  return `<h2>Delete account</h2>
<p>${escapeHtml(DELETE_STATEMENT)}</p>
<form method="post" action="/account/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Delete account</button></form>`;
}

/** The full page for a signed-in user; `notice` shows an error above the sections and sets the status. */
export async function renderAccountPage(rc: RequestContext, session: UserSession, notice: PageNotice = {}): Promise<Response> {
  const now = rc.deps.now();
  const grant = await getGrant(rc, session.githubId);
  // The owner has no grant row; entitlementFor(null) is Tester.
  const entitlement = entitlementFor(grant);
  const view = await readDirectoryView(rc.env, session.userId);
  const error = notice.error ? `<p class="warn">${escapeHtml(notice.error)}</p>\n` : '';
  const body = [
    identitySection(session),
    error + planSection(entitlement, grant, now),
    relaySection(entitlement, view, now),
    machinesSection(entitlement, view, session.csrfToken),
    `<h2>Billing</h2>\n<p>${escapeHtml(BILLING_MESSAGE)}</p>`,
    deleteSection(session.csrfToken),
  ].join('\n');
  return html(layout(ACCOUNT_TITLE, body), notice.status ?? 200);
}

/** GET /account — the sign-in page without a session (requireUserSession also handles revoked access, D-9). */
export const page: Handler = async (req, rc) => {
  const user = await requireUserSession(req, rc);
  if (!user.ok) return user.response;
  return renderAccountPage(rc, user.session);
};
