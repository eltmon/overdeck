/**
 * The agent fence on the owner machine (PAN-4650 D-4650-7, widened by PAN-4651 D-4651-2).
 *
 * A `machine` credential whose actor is an agent may start work here only
 * through the work doors (`POST /api/machines/work/conversations`, `/workers`,
 * `/issues/:id/start`), which stamp the asking machine on what they create.
 * It may change a conversation only when that conversation's provenance
 * (`started_by_environment_id`) is the credential's own environment. It stays
 * refused on bare creates (`POST /api/conversations`, `/api/workers`,
 * `/api/lanes`), on `POST /api/machines/work/projects` (operator only), on
 * every other conversation write, on `POST /api/lanes/<name>/reap` (PAN-4638
 * FR-11: the owner's lane reap door checks provenance instead), on
 * `POST /api/lanes/<name>/stop` unless its environment started that lane
 * (a lane stop is a conversation write), on
 * `/ws/terminal` and on `/ws/forward`.
 * `POST /api/workers/:id/stop` passes here: the stop route itself checks the
 * worker's `worker.json` provenance, which is an async read. Operator actors
 * and every other credential pass. The remote request gate and the upgrade
 * handlers call it right after the credential resolves, so it stays
 * synchronous: the provenance lookup is a synchronous `overdeck.db` read.
 */
import { conversationStartedBy } from '../../lib/overdeck/conversation-provenance.js';
import type { DashboardCredential } from './routes/dashboard-auth.js';

export const AGENT_FENCED = 'agent-fenced';
export const AGENT_FENCED_MESSAGE = 'An agent on a linked machine cannot change conversations on this machine';

export interface LinkActorFenceDeps {
  /** The environment id that started a conversation through a work door; null when it started here or is unknown. */
  conversationStartedBy(name: string): string | null;
}

const DEFAULT_DEPS: LinkActorFenceDeps = { conversationStartedBy };

const FENCED_SOCKETS: ReadonlySet<string> = new Set(['/ws/terminal', '/ws/forward']);

/** Creates an agent actor must route through a work door so the new work is stamped. */
const FENCED_CREATES: ReadonlySet<string> = new Set([
  'POST /api/conversations',
  'POST /api/workers',
  'POST /api/lanes',
  'POST /api/machines/work/projects',
]);

const CONVERSATION_PREFIX = '/api/conversations/';

/** PAN-4638 FR-11: home's lane reap; an agent on a link reaps through the owner's provenance-checked door. */
const LANE_REAP_PATH = /^\/api\/lanes\/[^/]+\/reap$/;

/** PAN-4638: home's lane stop, a conversation write judged by the lane's provenance. */
const LANE_STOP_PATH = /^\/api\/lanes\/([^/]+)\/stop$/;

/** `'/api/lanes/<ref>/stop'` → the names the route may resolve `<ref>` to (it strips a `conv-` prefix); null otherwise. */
function laneStopNamesOf(pathname: string): string[] | null {
  const ref = LANE_STOP_PATH.exec(pathname)?.[1];
  if (!ref) return null;
  return ref.startsWith('conv-') ? [ref, ref.slice('conv-'.length)] : [ref];
}

/** `'/api/conversations/<name>[/…]'` → `<name>`; null for any other path. */
function conversationNameOf(pathname: string): string | null {
  if (!pathname.startsWith(CONVERSATION_PREFIX)) return null;
  const name = pathname.slice(CONVERSATION_PREFIX.length).split('/', 1)[0] ?? '';
  return name === '' ? null : name;
}

function startedByCaller(name: string, environmentId: string, deps: LinkActorFenceDeps): boolean {
  try {
    return deps.conversationStartedBy(name) === environmentId;
  } catch {
    return false;
  }
}

/** `'agent-fenced'` when this request must be refused, else null. */
export function linkActorFence(
  credential: DashboardCredential | null,
  method: string,
  pathname: string,
  deps: LinkActorFenceDeps = DEFAULT_DEPS,
): typeof AGENT_FENCED | null {
  if (credential?.kind !== 'machine' || credential.actor === 'operator') return null;
  if (FENCED_SOCKETS.has(pathname)) return AGENT_FENCED;
  if (FENCED_CREATES.has(`${method} ${pathname}`)) return AGENT_FENCED;
  if (method === 'GET' || method === 'HEAD') return null;
  if (pathname === '/api/conversations') return AGENT_FENCED;
  if (method === 'POST' && LANE_REAP_PATH.test(pathname)) return AGENT_FENCED;
  const laneStop = method === 'POST' ? laneStopNamesOf(pathname) : null;
  if (laneStop) return laneStop.some((candidate) => startedByCaller(candidate, credential.environmentId, deps)) ? null : AGENT_FENCED;
  const name = conversationNameOf(pathname);
  if (name === null) return null;
  return startedByCaller(name, credential.environmentId, deps) ? null : AGENT_FENCED;
}
