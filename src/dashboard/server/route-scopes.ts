/**
 * The route-scope table (PAN-2351 D-6): the one list of which scope a registry
 * credential (a paired device or an access token) needs per `METHOD path`.
 * Anything unlisted needs `admin`, so every mismatch fails closed.
 *
 * Read by the remote request gate (all HTTP under `/api/` and `/events/`), by
 * the per-route helpers in `routes/dashboard-auth.ts`, and by the WebSocket
 * upgrade gate (`WS_TERMINAL_SCOPE`; every other `/ws/*` path needs `admin`).
 * Root credentials (internal token, root session) are `admin` and always pass.
 *
 * A `:param` segment matches exactly one non-empty path segment. Matching is
 * exact and case-sensitive on the path `gatePathname` returns. The table starts
 * minimal (D-13) and grows in the issue that adds each consumer.
 *
 * This module imports only the registry so `remote-request-gate.ts` and
 * `dashboard-auth.ts` can both import it without an import cycle.
 */
import { PanRpcGroup } from '@overdeck/contracts';

import { scopeSatisfies, type AccessTokenScope } from '../../lib/access-tokens.js';

export interface RouteScope {
  method: string;
  path: string;
  scope: AccessTokenScope;
}

export const ROUTE_SCOPES: ReadonlyArray<RouteScope> = [
  { method: 'GET', path: '/events/stream', scope: 'read:events' },
  { method: 'GET', path: '/events/version', scope: 'read:events' },
  { method: 'GET', path: '/api/issues', scope: 'read:state' },
  { method: 'GET', path: '/api/agents', scope: 'read:state' },
  { method: 'GET', path: '/api/agent-directory', scope: 'read:state' },
  { method: 'GET', path: '/api/flywheel/status', scope: 'read:state' },
  { method: 'GET', path: '/api/pipeline/membership', scope: 'read:state' },
  { method: 'GET', path: '/api/conversations', scope: 'read:conversations' },
  // PAN-4835: the Needs-you feed, explicit so it never depends on the `:id` pattern below.
  { method: 'GET', path: '/api/conversations/pending-input', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:id', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/messages', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/about', scope: 'read:conversations' },
  { method: 'POST', path: '/api/agents/:id/message', scope: 'tell' },
  { method: 'POST', path: '/api/agents/:id/tell', scope: 'tell' },
  { method: 'POST', path: '/api/conversations/:name/message', scope: 'tell' },
  { method: 'GET', path: '/api/conversations/:name/kickoff', scope: 'read:conversations' },
  { method: 'POST', path: '/api/conversations/:name/kickoff', scope: 'tell' },
  { method: 'GET', path: '/api/conversations/:name/bookmarks', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/scheduled-messages', scope: 'read:conversations' },
  { method: 'POST', path: '/api/conversations/:name/scheduled-messages', scope: 'tell' },
  { method: 'PATCH', path: '/api/conversations/:name/scheduled-messages/:id', scope: 'tell' },
  { method: 'DELETE', path: '/api/conversations/:name/scheduled-messages/:id', scope: 'tell' },
  // PAN-4927 W-SCHED1: recurring schedules (PAN-4640), for the MCP schedule tools.
  { method: 'GET', path: '/api/conversations/:name/schedules', scope: 'read:conversations' },
  { method: 'POST', path: '/api/conversations/:name/schedules', scope: 'tell' },
  { method: 'PATCH', path: '/api/conversations/:name/schedules/:id', scope: 'tell' },
  { method: 'DELETE', path: '/api/conversations/:name/schedules/:id', scope: 'tell' },
  // PAN-4649: approvals need approve.
  { method: 'POST', path: '/api/conversations/:id/permission', scope: 'approve' },
  { method: 'POST', path: '/api/conversations/:id/pane-choice', scope: 'approve' },
  { method: 'POST', path: '/api/conversations/:id/pi-ask-answer', scope: 'approve' },
  { method: 'POST', path: '/api/conversations/:id/codex-approval', scope: 'approve' },
  { method: 'POST', path: '/api/conversations/:name/plan-action', scope: 'approve' },
  { method: 'POST', path: '/api/agents/:id/answer-question', scope: 'approve' },
  { method: 'POST', path: '/api/agents/:id/plan-action', scope: 'approve' },
  { method: 'POST', path: '/api/agents/:id/permissions/:requestId/respond', scope: 'approve' },
  // PAN-4649: MCP tools.
  { method: 'GET', path: '/api/palette/search', scope: 'read:conversations' },
  { method: 'POST', path: '/api/conversations', scope: 'operate' },
  { method: 'POST', path: '/api/workers', scope: 'operate' },
  // PAN-4645 WI-5: the operate surfaces a linked machine (and any token with
  // operate) may drive; the approval routes take `approve` (PAN-4649, above).
  { method: 'POST', path: '/api/conversations/:name/stop', scope: 'operate' },
  { method: 'POST', path: '/api/conversations/:name/abort', scope: 'operate' },
  { method: 'POST', path: '/api/lanes', scope: 'operate' },
  // PAN-4638 WI-8: stop a lane here, or on its owner through the link.
  { method: 'POST', path: '/api/lanes/:name/stop', scope: 'operate' },
  // PAN-4938 D-11: lane_status reads one lane; lanes are state.
  { method: 'GET', path: '/api/lanes', scope: 'read:state' },
  { method: 'GET', path: '/api/lanes/:name', scope: 'read:state' },
  // PAN-4645 WI-13: a linked machine revokes its own token (the route then
  // requires exactly a machine credential).
  { method: 'DELETE', path: '/api/machines/self', scope: 'read:state' },
  // PAN-4645 WI-18: the heartbeat stream a linked machine holds open.
  { method: 'GET', path: '/api/machines/heartbeat', scope: 'read:state' },
  // PAN-4650 WI-2: the shared conversation list a linked machine caches.
  { method: 'GET', path: '/api/machines/conversations', scope: 'read:conversations' },
  // PAN-4651 WI-3: the project list (key, name, git origin) a linked machine caches.
  { method: 'GET', path: '/api/machines/projects', scope: 'read:state' },
  // PAN-4651 WI-4: work doors — a linked machine starts work here (machine credential only, checked by the routes).
  { method: 'POST', path: '/api/machines/work/conversations', scope: 'operate' },
  { method: 'POST', path: '/api/machines/work/workers', scope: 'operate' },
  { method: 'POST', path: '/api/machines/work/issues/:id/start', scope: 'operate' },
  // PAN-4651 WI-8: Auto placement (read-only; fleet routes refuse channel callers).
  { method: 'POST', path: '/api/fleet/placement', scope: 'read:state' },
  // PAN-4651 WI-10: fleet spawns (operate, so an MCP token can start work on any machine).
  { method: 'POST', path: '/api/fleet/conversations', scope: 'operate' },
  { method: 'POST', path: '/api/fleet/workers', scope: 'operate' },
  { method: 'POST', path: '/api/fleet/workers/:id/stop', scope: 'operate' },
  { method: 'POST', path: '/api/fleet/issues/:id/start', scope: 'operate' },
  // PAN-4651 WI-29: the MCP list_machines tool (no routes, fingerprints or access levels).
  { method: 'GET', path: '/api/fleet/machines', scope: 'read:state' },
  // PAN-4651 WI-17: a linked machine's operator reads a project's source facts and ignored files (operator-level link only, checked by the routes).
  { method: 'GET', path: '/api/machines/projects/:key/source', scope: 'read:state' },
  { method: 'GET', path: '/api/machines/projects/:key/file', scope: 'read:state' },
  // PAN-4651 WI-19: Add this project there (operator actor on an operator-level link only, checked by the route).
  { method: 'POST', path: '/api/machines/work/projects', scope: 'operate' },
  { method: 'GET', path: '/api/machines/work/projects/:jobId', scope: 'read:state' },
  // PAN-4638 WI-3: lane work doors — home runs a gauntlet lane here (machine credential only, checked by the routes).
  { method: 'POST', path: '/api/machines/work/lanes', scope: 'operate' },
  { method: 'GET', path: '/api/machines/work/lanes/:name/status', scope: 'read:state' },
  { method: 'POST', path: '/api/machines/work/lanes/:name/reap', scope: 'operate' },
  // PAN-4651 WI-20: fleet Needs-You (owner feed for linked machines; the viewer's combined list).
  { method: 'GET', path: '/api/machines/needs-you', scope: 'read:conversations' },
  { method: 'GET', path: '/api/fleet/needs-you', scope: 'read:conversations' },
  // PAN-4944 (PAN-4927 W-APPR1): this machine's Needs-You for list_pending_input.
  { method: 'GET', path: '/api/needs-you', scope: 'read:conversations' },
  // PAN-4651 WI-21: palette search across linked machines.
  { method: 'GET', path: '/api/fleet/search', scope: 'read:conversations' },
  // PAN-4651 WI-22: which machine is working on an issue.
  { method: 'GET', path: '/api/machines/issue-activity', scope: 'read:state' },
  { method: 'GET', path: '/api/fleet/issues/:id/activity', scope: 'read:state' },
  // PAN-4651 WI-23: a linked machine reads this machine's usage for fleet totals.
  { method: 'GET', path: '/api/costs/summary', scope: 'read:costs' },
  { method: 'GET', path: '/api/costs/request-digest', scope: 'read:costs' },
  // PAN-4651 WI-25: resolved settings (secrets as set/not set) for a linked machine's Compare settings.
  { method: 'GET', path: '/api/settings/resolved', scope: 'read:settings' },
  // PAN-4651 WI-5: a linked machine follows (and stops) a worker it delegated here.
  { method: 'GET', path: '/api/workers/:id/status', scope: 'read:state' },
  { method: 'POST', path: '/api/workers/:id/stop', scope: 'operate' },
  // PAN-4927 W-SELF1: self routes; the handler also requires an agent token (D-10).
  { method: 'GET', path: '/api/self/jobs/:id', scope: 'read:state' },
  { method: 'GET', path: '/api/self/jobs/:id/wait', scope: 'read:state' },
  // PAN-4938 (W-DEL1): delegation self routes; handlers also require an agent token (D-10).
  { method: 'POST', path: '/api/self/workers', scope: 'operate' },
  { method: 'GET', path: '/api/self/workers/:id/wait', scope: 'read:state' },
  { method: 'GET', path: '/api/self/workers', scope: 'read:state' },
  { method: 'GET', path: '/api/self/workers/:id', scope: 'read:state' },
  { method: 'POST', path: '/api/self/lanes', scope: 'operate' },
  { method: 'POST', path: '/api/self/lanes/wait', scope: 'read:state' },
  { method: 'POST', path: '/api/self/lanes/report', scope: 'tell' },
  // PAN-4927 W-SELF2: agent workflow routes; the handler also requires an agent token (D-10).
  { method: 'POST', path: '/api/self/tasks/claim', scope: 'tell' },
  { method: 'POST', path: '/api/self/tasks/done', scope: 'tell' },
  { method: 'POST', path: '/api/self/tasks/block', scope: 'tell' },
  { method: 'POST', path: '/api/self/done', scope: 'operate' },
  { method: 'POST', path: '/api/self/handoff', scope: 'tell' },
  { method: 'POST', path: '/api/self/worker-report', scope: 'tell' },
  // PAN-4927 W-SEC1: secret requests; the handler also requires an agent token (D-10).
  { method: 'POST', path: '/api/self/secret-requests', scope: 'tell' },
  { method: 'GET', path: '/api/self/secret-requests/:id/wait', scope: 'read:state' },
  // PAN-4927 W-MEM1: memory; the handler also requires an agent token (D-10).
  { method: 'POST', path: '/api/self/memory/facts', scope: 'tell' },
  { method: 'POST', path: '/api/self/memory/search', scope: 'read:state' },
  { method: 'GET', path: '/api/agent-requests', scope: 'read:conversations' },
  // POST /api/agent-requests/:id/secret and /decline have no row: root credentials only (D-4).
  // PAN-4943 W-PR1: PR-link routes (PAN-3822), for the MCP link/watch tools.
  { method: 'GET', path: '/api/conversations/:name/pull-requests', scope: 'read:conversations' },
  { method: 'POST', path: '/api/conversations/:name/pull-requests', scope: 'tell' },
  { method: 'DELETE', path: '/api/conversations/:name/pull-requests', scope: 'tell' },
  { method: 'POST', path: '/api/conversations/:name/pull-requests/sync', scope: 'tell' },
  { method: 'GET', path: '/api/pull-requests', scope: 'read:state' },
  { method: 'GET', path: '/api/pull-requests/conversations', scope: 'read:state' },
  // PAN-4943 W-PR1 WI-6: self pull-request watch routes; the handlers also require an agent token (D-10).
  { method: 'POST', path: '/api/self/pull-request-watches', scope: 'tell' },
  { method: 'GET', path: '/api/self/pull-request-watches', scope: 'read:state' },
  { method: 'DELETE', path: '/api/self/pull-request-watches/:id', scope: 'tell' },
  { method: 'POST', path: '/api/self/pull-requests', scope: 'tell' },
  // PAN-4650 WI-9: the owner's half of Pull here (a linked machine's operator only, checked by the routes).
  { method: 'POST', path: '/api/conversations/:name/release', scope: 'operate' },
  { method: 'GET', path: '/api/conversations/:name/release/transfer/:transferId', scope: 'operate' },
  { method: 'POST', path: '/api/conversations/:name/release/undo', scope: 'operate' },
  { method: 'POST', path: '/api/conversations/:name/release/complete', scope: 'operate' },
  // PAN-4650 WI-17: the dev-server ports a linked machine may preview.
  { method: 'GET', path: '/api/conversations/:name/preview-ports', scope: 'read:conversations' },
  // PAN-4650 FR-3: the rest of remote control a linked machine's operator drives
  // through the link proxy (images, tool bodies, diffs, jumps; switch model,
  // compact, effort, resume; image upload). Agent actors stay fenced off writes.
  { method: 'GET', path: '/api/conversations/:name/attachments/:file', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/tool-body/:toolUseId', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/message-locator', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/diffs', scope: 'read:conversations' },
  { method: 'GET', path: '/api/conversations/:name/diffs/:turnId', scope: 'read:conversations' },
  { method: 'POST', path: '/api/conversations/:name/upload-image', scope: 'tell' },
  // PAN-4835 D-7: the undo of upload-image.
  { method: 'POST', path: '/api/conversations/:name/delete-image', scope: 'tell' },
  { method: 'POST', path: '/api/conversations/:name/switch-model', scope: 'operate' },
  { method: 'POST', path: '/api/conversations/:name/compact', scope: 'operate' },
  { method: 'POST', path: '/api/conversations/:name/thinking-level', scope: 'operate' },
  { method: 'POST', path: '/api/conversations/:name/resume', scope: 'operate' },
  // PAN-4654: a linked machine reads this machine's version report for the fleet table.
  { method: 'GET', path: '/api/versions/self', scope: 'read:state' },
  // PAN-4654: an operator-level link starts, escalates or cancels this machine's
  // update job; the handler also requires the operator actor stamp (D-10).
  { method: 'POST', path: '/api/versions/self/update', scope: 'operate' },
  { method: 'DELETE', path: '/api/versions/self/update', scope: 'operate' },
  // PAN-4835: the phone app boots on the activity feed and answers its own self-service routes
  // (the handlers also require a phone credential).
  { method: 'GET', path: '/api/activity', scope: 'read:state' },
  { method: 'PUT', path: '/api/phones/self/push-key', scope: 'tell' },
  { method: 'DELETE', path: '/api/phones/self', scope: 'tell' },
  // PAN-4927 W-CONN1: a connector's logout (the handler also requires a connector credential).
  { method: 'DELETE', path: '/api/connectors/self', scope: 'read:state' },
];

/** `/ws/terminal` needs `operate`; every other WebSocket path keeps the `admin` default. */
export const WS_TERMINAL_SCOPE: AccessTokenScope = 'operate';

/**
 * `/ws/rpc` methods a non-admin credential may call, by RPC tag (PAN-4645
 * D-4645-14). Any method absent here needs `admin`. The upgrade itself needs
 * one of `WS_RPC_UPGRADE_SCOPES`.
 */
export const RPC_METHOD_SCOPES: Readonly<Record<string, AccessTokenScope>> = {
  // PAN-4835: the snapshot and replay every dashboard client boots on (phone app, linked machines, tokens).
  'pan.getSnapshot': 'read:state',
  'pan.replayEvents': 'read:events',
  'pan.subscribeConversationMessages': 'read:conversations',
  'pan.subscribeDomainEvents': 'read:events',
};
export const WS_RPC_UPGRADE_SCOPES: ReadonlyArray<AccessTokenScope> = ['read:events', 'read:conversations'];

/** The RPC tags of `PanRpcGroup` that `scopes` may call, sorted. `admin` allows every tag. */
export function allowedRpcTags(scopes: readonly string[]): string[] {
  return [...PanRpcGroup.requests.keys()]
    .filter((tag) => scopeSatisfies(scopes, RPC_METHOD_SCOPES[tag] ?? 'admin'))
    .sort();
}

/**
 * The request path as the gate judges it. The router matches loosely (a
 * request for `//api/x` reaches `/api/x`), so the gate normalizes before it
 * decides: it drops the query, takes the path of an absolute-form target,
 * decodes percent escapes, collapses repeated slashes and resolves `.` and
 * `..` segments. An undecodable path returns `null`, which the gate rejects.
 */
export function gatePathname(url: string): string | null {
  let path = url.split(/[?#]/, 1)[0] ?? '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split(/[/\\]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const trailing = /[/\\]$/.test(path) && segments.length > 0 ? '/' : '';
  return `/${segments.join('/')}${trailing}`;
}

function pathMatches(pattern: string, pathname: string): boolean {
  const expected = pattern.split('/');
  const actual = pathname.split('/');
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) => (segment.startsWith(':') ? actual[index] !== '' : segment === actual[index]));
}

const LINKED_CONVERSATION_PREFIX = '/api/conversations/@';

/**
 * The scope a registry credential needs for `METHOD pathname`; unlisted routes need `admin`.
 * PAN-4651 D-4651-17: a linked conversation `/api/conversations/@<machine>/<rest>`
 * needs what `/api/conversations/<rest>` needs here, so a token's scopes reach
 * the same surfaces on a linked machine. The proxy refuses channel callers
 * itself (no chained hops), since this mapping lifts the old admin-only guard.
 */
export function requiredScopeFor(method: string, pathname: string): AccessTokenScope {
  let path = pathname;
  if (path.startsWith(LINKED_CONVERSATION_PREFIX)) {
    const segments = path.split('/');
    if (segments.length < 6) return 'admin';
    path = [...segments.slice(0, 3), ...segments.slice(4)].join('/');
  }
  const row = ROUTE_SCOPES.find((entry) => entry.method === method && pathMatches(entry.path, path));
  return row?.scope ?? 'admin';
}
