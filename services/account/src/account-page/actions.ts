/**
 * Account-page actions (PRD PAN-4959 WI-7, WI-8; FR-7, FR-9, FR-12; D-3; NFR-1).
 *
 * Every handler requires the web session's csrf field and a same-site Origin (requireUserSession).
 * Remove revokes the machine's device token first, then forgets it in the Directory DO, so a machine that
 * is offline right now cannot register again on its next hello (D-3).
 */
import { revokeDevice } from '../devices.ts';
import { readDirectoryView, removeDirectoryMachine } from '../directory-view.ts';
import type { Handler } from '../env.ts';
import { redirect } from '../http.ts';
import { DIRECTORY_UNAVAILABLE_MESSAGE, renderAccountPage } from './page.ts';
import { requireUserSession } from './session.ts';

export const MACHINE_GONE_MESSAGE = 'That machine is no longer in the directory.';

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
