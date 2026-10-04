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
import type { AccessTokenScope } from '../../lib/access-tokens.js';

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
];

/** `/ws/terminal` needs `operate`; every other WebSocket path keeps the `admin` default. */
export const WS_TERMINAL_SCOPE: AccessTokenScope = 'operate';

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
