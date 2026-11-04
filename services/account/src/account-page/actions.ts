/**
 * Account-page actions (PRD PAN-4959 WI-7, WI-8; FR-7, FR-9, FR-12; D-3; NFR-1).
 *
 * Every handler requires the web session's csrf field and a same-site Origin (requireUserSession).
 * Remove revokes the machine's device token first, then forgets it in the Directory DO, so a machine that
 * is offline right now cannot register again on its next hello (D-3).
 */
import { requestDeletion, runDeletionJob } from '../deletion.ts';
import { revokeDevice } from '../devices.ts';
import { readDirectoryView, removeDirectoryMachine } from '../directory-view.ts';
import type { Handler } from '../env.ts';
import { clearCookie, html, redirect } from '../http.ts';
import { escapeHtml, layout, messagePage } from '../pages.ts';
import { DELETE_STATEMENT, DIRECTORY_UNAVAILABLE_MESSAGE, renderAccountPage } from './page.ts';
import { ACCOUNT_COOKIE, requireUserSession, type UserSession } from './session.ts';

export const MACHINE_GONE_MESSAGE = 'That machine is no longer in the directory.';
export const CONFIRM_MISMATCH_MESSAGE = 'Type your GitHub login to confirm.';
export const DELETION_STARTED_MESSAGE = 'Your account is being deleted.';
const DELETE_TITLE = 'Delete your account';

/** POST /account/machines/:environmentId/remove */
export const removeMachine: Handler = async (req, rc) => {
  const user = await requireUserSession(req, rc);
  if (!user.ok) return user.response;
  const { session } = user;
  const view = await readDirectoryView(rc.env, session.userId);
  if (view === null) return renderAccountPage(rc, session, { error: DIRECTORY_UNAVAILABLE_MESSAGE, status: 503 });
  const machine = view.machines.find((m) => m.environmentId === rc.params.environmentId);
  if (!machine) return renderAccountPage(rc, session, { error: MACHINE_GONE_MESSAGE, status: 404 });
  await revokeDevice(rc, session.userId, machine.deviceId, 'user');
  const outcome = await removeDirectoryMachine(rc.env, session.userId, machine.environmentId);
  if (outcome === 'unavailable') return renderAccountPage(rc, session, { error: DIRECTORY_UNAVAILABLE_MESSAGE, status: 503 });
  return redirect('/account', 303);
};

/** The second step of Delete (FR-9): type the GitHub login to confirm. */
function confirmPage(session: UserSession, error: string | null = null, status = 200): Response {
  const notice = error ? `<p class="warn">${escapeHtml(error)}</p>\n` : '';
  return html(
    layout(
      DELETE_TITLE,
      `<h1>${escapeHtml(DELETE_TITLE)}</h1>
<p>${escapeHtml(DELETE_STATEMENT)}</p>
${notice}<form method="post" action="/account/delete/confirm">
<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
<label>Type your GitHub login (${escapeHtml(session.githubLogin)}) to confirm <input name="confirm" autocomplete="off"></label>
<button type="submit">Delete my account</button>
</form>
<p><a href="/account">Cancel</a></p>`,
    ),
    status,
  );
}

/** POST /account/delete — shows the confirm page; nothing is deleted yet. */
export const deleteAccount: Handler = async (req, rc) => {
  const user = await requireUserSession(req, rc);
  if (!user.ok) return user.response;
  return confirmPage(user.session);
};

/** POST /account/delete/confirm — the typed login must match (any letter case); then deletion starts and the cookie clears. */
export const confirmDeleteAccount: Handler = async (req, rc) => {
  const user = await requireUserSession(req, rc);
  if (!user.ok) return user.response;
  const { session, form } = user;
  const typed = (form?.get('confirm') ?? '').trim();
  if (typed.toLowerCase() !== session.githubLogin.toLowerCase()) return confirmPage(session, CONFIRM_MISMATCH_MESSAGE, 400);
  await requestDeletion(rc, session.userId);
  rc.ctx.waitUntil(runDeletionJob(rc, session.userId));
  return messagePage(200, 'Account deletion', DELETION_STARTED_MESSAGE, { 'Set-Cookie': clearCookie(ACCOUNT_COOKIE) });
};
