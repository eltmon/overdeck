/**
 * The agent fence on the owner machine (PAN-4650 D-4650-7).
 *
 * No conversation is started through a link in this issue (#4651 adds that),
 * so an agent on a linked machine may read this machine's conversations but
 * not change them: a `machine` credential whose actor is an agent is refused
 * on every non-GET `/api/conversations` route, on `/ws/terminal` and on
 * `/ws/forward`. Operator actors and every other credential pass. The remote
 * request gate and the upgrade handlers call it right after the credential
 * resolves.
 */
import type { DashboardCredential } from './routes/dashboard-auth.js';

export const AGENT_FENCED = 'agent-fenced';
export const AGENT_FENCED_MESSAGE = 'An agent on a linked machine cannot change conversations on this machine';

const FENCED_SOCKETS: ReadonlySet<string> = new Set(['/ws/terminal', '/ws/forward']);

function isConversationPath(pathname: string): boolean {
  return pathname === '/api/conversations' || pathname.startsWith('/api/conversations/');
}

/** `'agent-fenced'` when this request must be refused, else null. */
export function linkActorFence(credential: DashboardCredential | null, method: string, pathname: string): typeof AGENT_FENCED | null {
  if (credential?.kind !== 'machine' || credential.actor === 'operator') return null;
  if (FENCED_SOCKETS.has(pathname)) return AGENT_FENCED;
  const reads = method === 'GET' || method === 'HEAD';
  return !reads && isConversationPath(pathname) ? AGENT_FENCED : null;
}
