/**
 * PAN-5649: the wake host. When PAN-5250 idle-stops a workspace's frontend,
 * its Traefik label router disappears and the low-priority wake router
 * (`~/.overdeck/traefik/dynamic/workspace-wake.yml`) sends
 * `feature-<issue>.<domain>` here with the `x-overdeck-wake-router: 1`
 * marker. This module answers those requests: it starts the issue's stack
 * through the wake door (`wakeWorkspaceStack`) and serves a page that reloads
 * into the app once the app answers.
 *
 * `setupWorkspaceWakeHost` wraps the raw Node server before the Effect app,
 * like `setupKnowledgeViewerProxy`, so a marked request never reaches a
 * dashboard route or WebSocket handler (FR-2). A request without the marker
 * passes through unchanged whatever its Host (D12): a workspace dashboard's
 * Vite proxy forwards `/ws` with a `feature-…` Host.
 *
 * Because this runs before the Effect app's remote gate, it gates itself: only
 * a trusted local caller may wake (D1, FR-3).
 */
import type http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';

import { loadConfigSync } from '../../../lib/config.js';
import { TRAEFIK_DYNAMIC_DIR } from '../../../lib/paths.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { tryComposeProjectNameForWorkspace } from '../../../lib/workspace/stack-health.js';
import { workspacePathForIssue } from '../../../lib/workspace/stack-idle-config.js';
import { wakeWorkspaceStack } from '../../../lib/workspace/stack-restore.js';
import {
  currentWakeDomains,
  isVitePing,
  isWakeRouterRequest,
  isWakingRequest,
  parseWakeHost,
  readWorkspaceLabelHost,
  renderWorkspaceWakeTraefikConfig,
  WAKE_HEADER,
  WAKE_STATUS_PATH,
  WORKSPACE_WAKE_DYNAMIC_FILE,
} from '../../../lib/workspace/workspace-wake-host.js';
import { isTrustedLocalNodeRequest } from './dashboard-auth.js';

export type WakeState = 'idle' | 'starting' | 'started' | 'failed' | 'no-stack';

export interface WakeStatus {
  issueId: string;
  state: WakeState;
  message: string;
  appUrl: string | null;
  started: string[];
  alreadyRunning: string[];
  error?: string;
  reason?: 'no-workspace' | 'no-compose-project';
  finishedAt?: number;
}

export interface WorkspaceWakeDeps {
  wake: typeof wakeWorkspaceStack;
  workspacePathFor: (issueId: string) => string | null;
  composeProjectFor: (workspacePath: string, issueId: string) => string | null;
  readLabelHost: (issueId: string, composeProject: string) => Promise<string | null>;
  projectExists: (issueId: string) => boolean;
  wakeDomains: () => Set<string>;
  isTrusted: (request: http.IncomingMessage) => boolean;
  now: () => number;
}

/** A finished wake outcome is reused for this long (FR-10). */
export const WAKE_RESULT_TTL_MS = 15_000;
/** A label host is cached per issue for this long (FR-10). */
export const APP_HOST_TTL_MS = 60_000;

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";

function defaultDeps(): WorkspaceWakeDeps {
  return {
    wake: wakeWorkspaceStack,
    workspacePathFor: workspacePathForIssue,
    composeProjectFor: tryComposeProjectNameForWorkspace,
    readLabelHost: (issueId, composeProject) => readWorkspaceLabelHost(issueId, composeProject),
    projectExists: (issueId) => resolveProjectFromIssueSync(issueId) !== null,
    wakeDomains: () => currentWakeDomains(),
    isTrusted: (request) => isTrustedLocalNodeRequest(request),
    now: () => Date.now(),
  };
}

function resolveDeps(deps: Partial<WorkspaceWakeDeps> = {}): WorkspaceWakeDeps {
  return { ...defaultDeps(), ...deps };
}

// ─── Coordinator (FR-10) ──────────────────────────────────────────────────────

const records = new Map<string, WakeStatus>();
const inFlight = new Map<string, Promise<WakeStatus>>();
const appHosts = new Map<string, { at: number; host: string | null }>();

function stateMessage(status: Pick<WakeStatus, 'issueId' | 'state' | 'started' | 'error'>): string {
  const id = status.issueId;
  switch (status.state) {
    case 'idle':
      return `Workspace app for ${id} is not being started.`;
    case 'starting':
      return `Starting ${id}'s app containers…`;
    case 'started':
      return status.started.length > 0
        ? `Started ${status.started.join(', ')}. Waiting for the app to answer…`
        : `${id}'s containers are running. Waiting for the app to answer…`;
    case 'failed':
      return `Starting ${id} failed: ${status.error ?? 'unknown error'}. Run pan workspace up ${id} in a terminal.`;
    case 'no-stack':
      return `${id} has no Docker stack to start.`;
  }
}

function appUrlFor(host: string | null): string | null {
  return host ? `https://${host}` : null;
}

/** The issue's label host, cached for APP_HOST_TTL_MS. Null when unknown. Never rejects. */
export async function resolveAppHost(issueId: string, deps?: Partial<WorkspaceWakeDeps>): Promise<string | null> {
  const d = resolveDeps(deps);
  const id = issueId.toUpperCase();
  const cached = appHosts.get(id);
  if (cached && d.now() - cached.at < APP_HOST_TTL_MS) return cached.host;
  let host: string | null = null;
  try {
    const workspacePath = d.workspacePathFor(id);
    const composeProject = workspacePath ? d.composeProjectFor(workspacePath, id) : null;
    host = composeProject ? await d.readLabelHost(id, composeProject) : null;
  } catch {
    host = null;
  }
  appHosts.set(id, { at: d.now(), host });
  return host;
}

/** The current wake record for an issue; `idle` when none. Reads only memory. */
export function getWorkspaceWakeStatus(issueId: string): WakeStatus {
  const id = issueId.toUpperCase();
  const record = records.get(id);
  if (record) return record;
  const base = { issueId: id, state: 'idle' as const, started: [], alreadyRunning: [] };
  return { ...base, message: stateMessage(base), appUrl: appUrlFor(appHosts.get(id)?.host ?? null) };
}

async function runWake(id: string, trigger: 'browser' | 'dashboard', d: WorkspaceWakeDeps): Promise<WakeStatus> {
  let status: Omit<WakeStatus, 'message' | 'appUrl'>;
  try {
    const result = await d.wake({ issueId: id, trigger });
    if (result.kind === 'woken') {
      const restoredStarted = result.restored.kind === 'restored' ? result.restored.started : [];
      const restoredRunning = result.restored.kind === 'restored' ? result.restored.alreadyRunning : [];
      status = {
        issueId: id,
        state: 'started',
        started: [...new Set([...restoredStarted, ...result.started])],
        alreadyRunning: [...new Set([...restoredRunning, ...result.alreadyRunning])],
      };
    } else if (result.kind === 'no-stack') {
      status = { issueId: id, state: 'no-stack', reason: result.reason, started: [], alreadyRunning: [] };
    } else {
      status = { issueId: id, state: 'failed', error: result.error, started: [], alreadyRunning: [] };
    }
  } catch (error) {
    status = { issueId: id, state: 'failed', error: error instanceof Error ? error.message : String(error), started: [], alreadyRunning: [] };
  }
  const appUrl = appUrlFor(await resolveAppHost(id, d));
  const finished: WakeStatus = { ...status, message: stateMessage(status), appUrl, finishedAt: d.now() };
  records.set(id, finished);
  return finished;
}

/**
 * Wakes the issue's stack at most once at a time (FR-10). A call during a wake
 * joins it; a finished, non-failed outcome is reused for WAKE_RESULT_TTL_MS.
 * The finished record stays readable afterwards for the status path. Never rejects.
 */
export function requestWorkspaceWake(
  issueId: string,
  trigger: 'browser' | 'dashboard',
  deps?: Partial<WorkspaceWakeDeps>,
): Promise<WakeStatus> {
  const d = resolveDeps(deps);
  const id = issueId.toUpperCase();
  const running = inFlight.get(id);
  if (running) return running;
  const prior = records.get(id);
  if (prior?.finishedAt !== undefined && prior.state !== 'failed' && d.now() - prior.finishedAt < WAKE_RESULT_TTL_MS) {
    return Promise.resolve(prior);
  }
  const startingBase = { issueId: id, state: 'starting' as const, started: [], alreadyRunning: [] };
  records.set(id, { ...startingBase, message: stateMessage(startingBase), appUrl: prior?.appUrl ?? appUrlFor(appHosts.get(id)?.host ?? null) });
  const promise = runWake(id, trigger, d).finally(() => {
    inFlight.delete(id);
  });
  inFlight.set(id, promise);
  return promise;
}

/** Test seam: forget every wake record and cached label host. */
export function resetWorkspaceWakeStateForTests(): void {
  records.clear();
  inFlight.clear();
  appHosts.clear();
}

// ─── Wake page (FR-9) ─────────────────────────────────────────────────────────

/**
 * The page's readiness rule (D5): a dashboard answer (wake header) or a
 * 502/503/504 means "not yet"; any other answer comes from the app. It
 * references no outer identifier, so the page embeds its source.
 */
export function wakePollDecision(status: number, hasWakeHeader: boolean): 'reload' | 'wait' {
  if (hasWakeHeader) return 'wait';
  if (status === 502 || status === 503 || status === 504) return 'wait';
  return 'reload';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON for an inline script: `<` is escaped so a value can never close the script element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Self-contained HTML: inline CSS and script, no external requests (NFR-6). */
export function renderWakePage(input: { issueId: string; host: string }): string {
  const issueId = escapeHtml(input.issueId);
  const host = escapeHtml(input.host);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Starting ${issueId}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font: 15px/1.5 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 34rem; padding: 2rem 1.5rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.75rem; }
  p { margin: 0.5rem 0; }
  code { font-family: ui-monospace, monospace; }
  #wake-status { opacity: 0.8; }
</style>
</head>
<body>
<main>
  <h1>Starting ${issueId}'s app</h1>
  <p>This workspace's app was stopped after being unused. Starting it…</p>
  <p id="wake-status">Waiting for <code>${host}</code> to answer…</p>
</main>
<script>
(function () {
  var STATUS_PATH = ${scriptJson(WAKE_STATUS_PATH)};
  var WAKE_HEADER = ${scriptJson(WAKE_HEADER)};
  var ISSUE_ID = ${scriptJson(input.issueId)};
  var STARTED_LIMIT_MS = 120000;
  var wakePollDecision = ${wakePollDecision.toString()};
  var startedSince = null;
  var statusEl = document.getElementById('wake-status');
  function show(text) { if (statusEl) statusEl.textContent = text; }
  function render(body) {
    if (!body || typeof body.state !== 'string') return;
    if (body.state === 'failed') {
      show('Starting failed: ' + (body.error || 'unknown error') + '. Run pan workspace up ' + ISSUE_ID + ' in a terminal.');
    } else if (body.state === 'no-stack') {
      show(ISSUE_ID + ' has no Docker stack to start.');
    } else if (body.state === 'started') {
      if (startedSince === null) startedSince = Date.now();
      if (Date.now() - startedSince > STARTED_LIMIT_MS) {
        show('The containers started, but the app has not answered after 2 minutes. Run pan workspace up ' + ISSUE_ID + ' in a terminal.');
      } else if (typeof body.message === 'string') {
        show(body.message);
      }
    } else if (typeof body.message === 'string') {
      show(body.message);
    }
  }
  function poll() {
    fetch(STATUS_PATH, { cache: 'no-store' }).then(function (res) {
      var hasWakeHeader = res.headers.has(WAKE_HEADER);
      if (wakePollDecision(res.status, hasWakeHeader) === 'reload') {
        location.reload();
        return;
      }
      if (hasWakeHeader && res.ok) {
        return res.json().then(render, function () {}).then(schedule);
      }
      schedule();
    }, schedule);
  }
  function schedule() { setTimeout(poll, 2000); }
  schedule();
})();
</script>
</body>
</html>
`;
}

// ─── Request handling (FR-2..FR-9) ────────────────────────────────────────────

const WAKE_RESPONSE_HEADERS = { [WAKE_HEADER]: '1', 'Cache-Control': 'no-store' } as const;

function sendText(response: http.ServerResponse, status: number, body: string, headers: http.OutgoingHttpHeaders = {}): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function plainWakeMessage(status: WakeStatus): string {
  if (status.state === 'failed' || status.state === 'no-stack') return status.message;
  return `Workspace app for ${status.issueId} is starting (it was stopped after being unused). Retry in a few seconds.`;
}

/** Answers one marked (wake router) request. Only called when isWakeRouterRequest holds. */
export async function handleWakeHostRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  deps?: Partial<WorkspaceWakeDeps>,
): Promise<void> {
  const d = resolveDeps(deps);
  try {
    // (a) FR-3: only a trusted local caller, never Funnel or LAN.
    if (!d.isTrusted(request)) {
      sendText(response, 404, 'Not found');
      return;
    }
    // (b) FR-4: a known domain and a registered project.
    const parsed = parseWakeHost(request.headers.host);
    if (!parsed || !d.wakeDomains().has(parsed.domain) || !d.projectExists(parsed.issueId)) {
      sendText(response, 404, `No Overdeck workspace answers at ${parsed?.hostname ?? 'this host'}.`);
      return;
    }
    const issueId = parsed.issueId;
    const url = request.url || '/';
    const pathname = url.split('?')[0];

    // (c) FR-8: the status path never wakes and makes no Docker call.
    if (pathname === WAKE_STATUS_PATH) {
      const status = getWorkspaceWakeStatus(issueId);
      const body = JSON.stringify({ issueId, state: status.state, message: status.message, appUrl: status.appUrl, error: status.error });
      if (response.headersSent) return;
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...WAKE_RESPONSE_HEADERS });
      response.end(body);
      return;
    }

    // (d) FR-5: a Vite ping fails outright; other non-waking requests get an empty 503.
    if (isVitePing(request.headers)) {
      request.socket.destroy();
      return;
    }
    if (!isWakingRequest(request.headers)) {
      if (response.headersSent) return;
      response.writeHead(503, { 'Retry-After': '5', 'Content-Length': 0, ...WAKE_RESPONSE_HEADERS });
      response.end();
      return;
    }

    // (e) FR-6: redirect to the host the frontend router will answer on.
    const labelHost = await resolveAppHost(issueId, d);
    if (labelHost && labelHost !== parsed.hostname) {
      if (response.headersSent) return;
      response.writeHead(307, { Location: `https://${labelHost}${url.startsWith('/') ? url : `/${url}`}`, 'Content-Length': 0, ...WAKE_RESPONSE_HEADERS });
      response.end();
      return;
    }

    // (f) FR-7: start the wake and answer at once.
    void requestWorkspaceWake(issueId, 'browser', d);
    const status = getWorkspaceWakeStatus(issueId);
    const accept = String(request.headers.accept ?? '');
    if (accept.includes('text/html')) {
      const html = renderWakePage({ issueId, host: parsed.hostname });
      if (response.headersSent) return;
      response.writeHead(503, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'Retry-After': '5',
        'X-Content-Type-Options': 'nosniff',
        ...WAKE_RESPONSE_HEADERS,
      });
      response.end(html);
      return;
    }
    sendText(response, 503, plainWakeMessage(status), { 'Retry-After': '5', ...WAKE_RESPONSE_HEADERS });
  } catch (error) {
    console.warn('[workspace-wake] request failed:', error instanceof Error ? error.message : String(error));
    sendText(response, 503, 'Workspace wake failed. Retry in a few seconds.', { 'Retry-After': '5', ...WAKE_RESPONSE_HEADERS });
  }
}

function refuseWakeUpgrade(socket: Duplex): void {
  // end() flushes the status line before the socket closes; destroy() right after write() can drop it.
  socket.end(`HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n${WAKE_HEADER}: 1\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
}

/**
 * Wraps the raw server so a marked request goes to the wake handler and a
 * marked upgrade is refused with 503 (FR-2, FR-5). Call it before every other
 * `request`/`upgrade` listener is registered (D14).
 */
export function setupWorkspaceWakeHost(
  server: http.Server,
  deps?: Partial<WorkspaceWakeDeps>,
  routerFile?: { apiPort?: number; dynamicDir?: string },
): void {
  const originalOn = server.on.bind(server);

  server.on = function (event: string, listener: (...args: unknown[]) => void) {
    if (event === 'request') {
      const wrapped = (request: http.IncomingMessage, response: http.ServerResponse) => {
        if (isWakeRouterRequest(request.headers)) {
          void handleWakeHostRequest(request, response, deps);
          return;
        }
        (listener as (req: http.IncomingMessage, res: http.ServerResponse) => void)(request, response);
      };
      return originalOn(event, wrapped as never);
    }
    if (event === 'upgrade') {
      const wrapped = (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
        if (isWakeRouterRequest(request.headers)) return;
        (listener as (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: http.IncomingMessage, socket: Duplex) => {
    if (!isWakeRouterRequest(request.headers)) return;
    refuseWakeUpgrade(socket);
  });

  void ensureWorkspaceWakeRouterFile(routerFile);
}

// ─── Router file (FR-1, D6) ───────────────────────────────────────────────────

/**
 * Writes `workspace-wake.yml` into Traefik's dynamic dir when its content
 * differs, so a `pan reload` deploy carries the wake router without `pan up`.
 * A missing dynamic dir (Traefik not installed) is never created. Never rejects.
 */
export async function ensureWorkspaceWakeRouterFile(
  options: { apiPort?: number; dynamicDir?: string } = {},
): Promise<'written' | 'unchanged' | 'skipped'> {
  const dynamicDir = options.dynamicDir ?? TRAEFIK_DYNAMIC_DIR;
  try {
    try {
      if (!(await stat(dynamicDir)).isDirectory()) return 'skipped';
    } catch {
      return 'skipped';
    }
    const apiPort = options.apiPort ?? loadConfigSync().dashboard.api_port;
    const content = renderWorkspaceWakeTraefikConfig(apiPort);
    const path = join(dynamicDir, WORKSPACE_WAKE_DYNAMIC_FILE);
    let current: string | null = null;
    try {
      current = await readFile(path, 'utf8');
    } catch {
      current = null;
    }
    if (current === content) return 'unchanged';
    await writeFile(path, content, 'utf8');
    return 'written';
  } catch (error) {
    console.warn('[workspace-wake] could not write the wake router file:', error instanceof Error ? error.message : String(error));
    return 'skipped';
  }
}
