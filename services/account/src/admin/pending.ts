/**
 * Admin screen: pending attempts and deletions in progress (PRD §7.12 parts 5–6). Scaffold stubs; implemented by account-admin-pending-screen.
 */
import type { Handler, RequestContext } from '../env.ts';
import { notImplemented } from '../http.ts';
import type { AdminSession } from './session.ts';

/** HTML for the pending-attempts and deletions sections; screen.ts appends it below the add form. */
export async function renderPendingSections(_rc: RequestContext, _session: AdminSession): Promise<string> {
  return '';
}

/** POST /admin/pending/:githubId/allow */
export const allow: Handler = async () => notImplemented();
