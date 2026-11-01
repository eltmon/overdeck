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
  // PAN-4645 WI-13: a linked machine revokes its own token (the route then
  // requires exactly a machine credential).
  { method: 'DELETE', path: '/api/machines/self', scope: 'read:state' },
  // PAN-4645 WI-18: the heartbeat stream a linked machine holds open.
  { method: 'GET', path: '/api/machines/heartbeat', scope: 'read:state' },
  // PAN-4650 WI-2: the shared conversation list a linked machine caches.
  { method: 'GET', path: '/api/machines/conversations', scope: 'read:conversations' },
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
];

/** `/ws/terminal` needs `operate`; every other WebSocket path keeps the `admin` default. */
export const WS_TERMINAL_SCOPE: AccessTokenScope = 'operate';

/**
 * `/ws/rpc` methods a non-admin credential may call, by RPC tag (PAN-4645
 * D-4645-14). Any method absent here needs `admin`. The upgrade itself needs
 * one of `WS_RPC_UPGRADE_SCOPES`.
 */
export const RPC_METHOD_SCOPES: Readonly<Record<string, AccessTokenScope>> = {
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

/** The scope a registry credential needs for `METHOD pathname`; unlisted routes need `admin`. */
export function requiredScopeFor(method: string, pathname: string): AccessTokenScope {
  const row = ROUTE_SCOPES.find((entry) => entry.method === method && pathMatches(entry.path, pathname));
  return row?.scope ?? 'admin';
}
