/**
 * Admin screen: pending sign-in attempts and account deletions in progress (PRD PAN-4293 §7.12 parts 5–6; D-10, D-14, D-16; FR-10).
 */
import type { DeletionJobRow } from '../deletion.ts';
import type { Handler, RequestContext } from '../env.ts';
import { addGrant, getPendingAttempt, listPendingAttempts } from '../grants.ts';
import { redirect } from '../http.ts';
import { errorPage, escapeHtml } from '../pages.ts';
import { ALLOW_SEMANTICS_MESSAGE, formatDateTime } from './screen.ts';
import { requireOwnerSession, type AdminSession } from './session.ts';

export const OVERDUE_AFTER_MS = 24 * 3_600_000;

async function pendingSection(rc: RequestContext, session: AdminSession): Promise<string> {
  const rows = await listPendingAttempts(rc);
  const body = rows
    .map(
      (p) => `<tr>
<td><a href="https://github.com/${escapeHtml(p.github_login)}">${escapeHtml(p.github_login)}</a></td>
<td>${escapeHtml(p.github_id)}</td>
<td>${escapeHtml(formatDateTime(p.first_seen_at))}</td>
<td>${escapeHtml(formatDateTime(p.last_seen_at))}</td>
<td>${escapeHtml(p.attempts)}</td>
<td>${escapeHtml(p.last_flow)}</td>
<td><form class="inline" method="post" action="/admin/pending/${escapeHtml(p.github_id)}/allow"><input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}"><button type="submit">Allow</button></form></td>
</tr>`,
    )
    .join('\n');
  return `<h2>Pending sign-in attempts</h2>
<p class="muted">${escapeHtml(ALLOW_SEMANTICS_MESSAGE)}</p>
<table>
<thead><tr><th>Login</th><th>GitHub id</th><th>First seen</th><th>Last seen</th><th>Attempts</th><th>Flow</th><th></th></tr></thead>
<tbody>
${body || '<tr><td colspan="7" class="muted">No pending attempts.</td></tr>'}
</tbody>
</table>`;
}

async function deletionsSection(rc: RequestContext): Promise<string> {
  const now = rc.deps.now();
  const { results } = await rc.env.DB.prepare('SELECT * FROM deletion_jobs WHERE completed_at IS NULL ORDER BY requested_at ASC').all<DeletionJobRow>();
  const body = results
    .map((j) => {
      const ageMs = now - j.requested_at;
      const hours = Math.floor(ageMs / 3_600_000);
      const age = ageMs >= OVERDUE_AFTER_MS ? `<span class="warn">${hours} h, overdue</span>` : `${hours} h`;
      return `<tr>
<td>${escapeHtml(j.user_id)}</td>
<td>${escapeHtml(formatDateTime(j.requested_at))}</td>
<td>${age}</td>
<td>${escapeHtml(j.holders_pending)}</td>
<td>${escapeHtml(j.attempts)}</td>
<td>${escapeHtml(j.last_error ?? '')}</td>
</tr>`;
    })
    .join('\n');
  return `<h2>Account deletions in progress</h2>
<table>
<thead><tr><th>User id</th><th>Requested</th><th>Age</th><th>Holders pending</th><th>Attempts</th><th>Last error</th></tr></thead>
<tbody>
${body || '<tr><td colspan="6" class="muted">None.</td></tr>'}
</tbody>
</table>`;
}

/** HTML for the pending-attempts and deletions sections; screen.ts appends it below the add form. */
export async function renderPendingSections(rc: RequestContext, session: AdminSession): Promise<string> {
  return `${await pendingSection(rc, session)}\n${await deletionsSection(rc)}`;
}

/** POST /admin/pending/:githubId/allow — D-14: creates a grant; the person signs in again. */
export const allow: Handler = async (req, rc) => {
  const owner = await requireOwnerSession(req, rc);
  if (!owner.ok) return owner.response;
  const githubId = /^\d+$/.test(rc.params.githubId ?? '') ? Number(rc.params.githubId) : null;
  const pending = githubId === null ? null : await getPendingAttempt(rc, githubId);
  if (!pending) return errorPage(404, 'That pending attempt is gone. It may have been allowed already or purged.', 'Not found');
  await addGrant(rc, pending.github_id, pending.github_login, {}, 'admin-allow-pending');
  return redirect('/admin', 303);
};
