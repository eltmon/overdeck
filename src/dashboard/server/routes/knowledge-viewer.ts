import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { WebSocket, WebSocketServer } from 'ws';
import { ensureOpenKnowledge } from '../../../lib/installers/open-knowledge.js';
import {
  getKnowledgeViewerStatus,
  getOrStartViewer,
  invalidateKnowledgeViewerInstallationCache,
  type KnowledgeViewerStatus,
} from '../services/knowledge-viewer.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
} from './dashboard-auth.js';
import { validateOriginHeaders } from './origin-validation.js';

export interface KnowledgeViewerRouteDependencies {
  getStatus?: (projectKey: string) => Promise<KnowledgeViewerStatus>;
  ensure?: (options: { autoInstall: true }) => Promise<unknown>;
  start?: (projectKey: string) => Promise<KnowledgeViewerStatus>;
  invalidateInstallationCache?: () => void;
}

export interface KnowledgeViewerRouteHandlers {
  status(projectKey: string): Promise<KnowledgeViewerStatus>;
  install(projectKey: string): Promise<KnowledgeViewerStatus>;
  start(projectKey: string): Promise<KnowledgeViewerStatus>;
  resolveTarget(projectKey: string): Promise<string | null>;
}

const VIEWER_HOST_PREFIX = 'knowledge-';
const VIEWER_ACCESS_COOKIE = 'overdeck_knowledge_viewer';
const MAX_QUEUED_WEBSOCKET_MESSAGES = 128;
const MAX_QUEUED_WEBSOCKET_BYTES = 1024 * 1024;
const MAX_CONFIG_RESPONSE_BYTES = 64 * 1024;
const viewerAccessTokens = new Map<string, string>();

const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'cache-control',
  'content-type',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'range',
  'user-agent',
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-language',
  'content-length',
  'content-range',
  'content-security-policy',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'location',
  'vary',
  'x-frame-options',
]);

export function createKnowledgeViewerRouteHandlers(
  dependencies: KnowledgeViewerRouteDependencies = {},
): KnowledgeViewerRouteHandlers {
  const getStatus = dependencies.getStatus ?? getKnowledgeViewerStatus;
  const ensure = dependencies.ensure ?? ((options) => ensureOpenKnowledge(options));
  const startViewer = dependencies.start ?? getOrStartViewer;
  const invalidateInstallationCache = dependencies.invalidateInstallationCache ?? invalidateKnowledgeViewerInstallationCache;

  async function status(projectKey: string): Promise<KnowledgeViewerStatus> {
    return getStatus(projectKey);
  }

  async function install(projectKey: string): Promise<KnowledgeViewerStatus> {
    await ensure({ autoInstall: true });
    invalidateInstallationCache();
    return status(projectKey);
  }

  async function start(projectKey: string): Promise<KnowledgeViewerStatus> {
    return startViewer(projectKey);
  }

  async function resolveTarget(projectKey: string): Promise<string | null> {
    const result = await status(projectKey);
    return result.running && result.url ? result.url : null;
  }

  return { status, install, start, resolveTarget };
}

export function knowledgeViewerUpstreamUrl(
  requestUrl: string,
  targetUrl: string,
  websocket: boolean,
): string {
  const incoming = new URL(requestUrl, 'http://localhost');
  incoming.searchParams.delete('access');
  const target = new URL(targetUrl);
  target.protocol = websocket ? (target.protocol === 'https:' ? 'wss:' : 'ws:') : target.protocol;
  target.pathname = incoming.pathname || '/';
  target.search = incoming.search;
  target.hash = '';
  return target.toString();
}

export function knowledgeViewerHost(projectKey: string, dashboardHost: string): string {
  const parsed = splitHostAndPort(dashboardHost);
  const baseHost = isIpAddress(parsed.hostname) ? 'localhost' : parsed.hostname;
  const encodedProject = Buffer.from(projectKey, 'utf8').toString('hex');
  return `${VIEWER_HOST_PREFIX}${encodedProject}.${baseHost}${parsed.port ? `:${parsed.port}` : ''}`;
}

export function projectFromKnowledgeViewerHost(host: string | undefined): string | null {
  if (!host) return null;
  const { hostname } = splitHostAndPort(host);
  const firstDot = hostname.indexOf('.');
  if (firstDot < 0) return null;
  const label = hostname.slice(0, firstDot);
  if (!label.startsWith(VIEWER_HOST_PREFIX)) return null;
  const encoded = label.slice(VIEWER_HOST_PREFIX.length);
  if (!encoded || encoded.length % 2 !== 0 || !/^[a-f0-9]+$/.test(encoded)) return null;
  try {
    const projectKey = Buffer.from(encoded, 'hex').toString('utf8');
    return Buffer.from(projectKey, 'utf8').toString('hex') === encoded ? projectKey : null;
  } catch {
    return null;
  }
}

export function knowledgeViewerProxyUrl(projectKey: string, dashboardHost: string): string {
  const token = viewerAccessTokens.get(projectKey) ?? randomBytes(32).toString('base64url');
  viewerAccessTokens.set(projectKey, token);
  const host = knowledgeViewerHost(projectKey, dashboardHost);
  return `//${host}/?access=${encodeURIComponent(token)}`;
}

export function resetKnowledgeViewerAccessTokensForTests(): void {
  viewerAccessTokens.clear();
}

export function filterKnowledgeViewerRequestHeaders(
  headers: http.IncomingHttpHeaders | Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const filtered: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!value || !REQUEST_HEADER_ALLOWLIST.has(lower)) continue;
    filtered[lower] = value;
  }
  return filtered;
}

export function filterKnowledgeViewerResponseHeaders(
  headers: http.IncomingHttpHeaders | Headers,
): Record<string, string | string[]> {
  const filtered: Record<string, string | string[]> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      if (RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) filtered[name.toLowerCase()] = value;
    });
    return filtered;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (!value || !RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase())) continue;
    filtered[name.toLowerCase()] = value;
  }
  return filtered;
}

function projectFromRequestUrl(requestUrl: string): string | null {
  return new URL(requestUrl, 'http://localhost').searchParams.get('project');
}

function parseProjectBody(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { project?: unknown };
    return typeof parsed.project === 'string' && parsed.project.trim() ? parsed.project.trim() : null;
  } catch {
    return null;
  }
}

function withProxyUrl(
  status: KnowledgeViewerStatus,
  request: HttpServerRequest.HttpServerRequest,
): KnowledgeViewerStatus {
  const host = request.headers.host;
  if (!status.running || !status.url || !host) return status;
  return { ...status, proxyUrl: knowledgeViewerProxyUrl(status.projectKey, host) };
}

const handlers = createKnowledgeViewerRouteHandlers();

const statusRoute = HttpRouter.add(
  'GET',
  '/api/knowledge-viewer/status',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const projectKey = projectFromRequestUrl(request.url);
    if (!projectKey) return jsonResponse({ error: 'project query parameter is required' }, { status: 400 });
    const status = yield* Effect.promise(() => handlers.status(projectKey));
    return jsonResponse(withProxyUrl(status, request));
  })),
);

const installRoute = HttpRouter.add(
  'POST',
  '/api/knowledge-viewer/install',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const projectKey = parseProjectBody(yield* request.text);
    if (!projectKey) return jsonResponse({ error: 'project is required in the request body' }, { status: 400 });
    try {
      const status = yield* Effect.promise(() => handlers.install(projectKey));
      return jsonResponse(withProxyUrl(status, request));
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, { status: 500 });
    }
  })),
);

const startRoute = HttpRouter.add(
  'POST',
  '/api/knowledge-viewer/start',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const projectKey = parseProjectBody(yield* request.text);
    if (!projectKey) return jsonResponse({ error: 'project is required in the request body' }, { status: 400 });
    try {
      const status = yield* Effect.promise(() => handlers.start(projectKey));
      return jsonResponse(withProxyUrl(status, request), { status: status.running ? 200 : 409 });
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, { status: 500 });
    }
  })),
);

const legacyProxyRedirectRoute = HttpRouter.add(
  'GET',
  '/knowledge-viewer/*',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const projectKey = projectFromRequestUrl(request.url);
    if (!projectKey) return jsonResponse({ error: 'project query parameter is required' }, { status: 400 });
    const status = yield* Effect.promise(() => handlers.status(projectKey));
    const result = withProxyUrl(status, request);
    if (!result.proxyUrl) return jsonResponse({ error: 'Knowledge viewer is not running' }, { status: 503 });
    return HttpServerResponse.redirect(result.proxyUrl);
  })),
);

export const knowledgeViewerRouteLayer = Layer.mergeAll(
  statusRoute,
  installRoute,
  startRoute,
  legacyProxyRedirectRoute,
);

export function setupKnowledgeViewerProxy(
  server: http.Server,
  routeHandlers: KnowledgeViewerRouteHandlers = handlers,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const originalOn = server.on.bind(server);

  server.on = function(event: string, listener: (...args: unknown[]) => void) {
    if (event === 'request') {
      const wrapped = (request: http.IncomingMessage, response: http.ServerResponse) => {
        const projectKey = projectFromKnowledgeViewerHost(request.headers.host);
        if (projectKey) {
          void proxyKnowledgeViewerHttp(request, response, projectKey, routeHandlers);
          return;
        }
        (listener as (req: http.IncomingMessage, res: http.ServerResponse) => void)(request, response);
      };
      return originalOn(event, wrapped as never);
    }
    if (event === 'upgrade') {
      const wrapped = (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
        if (projectFromKnowledgeViewerHost(request.headers.host)) return;
        (listener as (req: http.IncomingMessage, socket: Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
    const projectKey = projectFromKnowledgeViewerHost(request.headers.host);
    if (!projectKey) return;
    const access = authorizeViewerRequest(request, projectKey);
    if (!access.ok) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (!viewerOriginIsAllowed(request)) {
      rejectUpgrade(socket, 403, 'Invalid origin');
      return;
    }

    void routeHandlers.resolveTarget(projectKey).then((target) => {
      if (!target) {
        rejectUpgrade(socket, 503, 'Knowledge viewer is not running');
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        bridgeWebSocket(client, request, knowledgeViewerUpstreamUrl(request.url || '/', target, true));
      });
    }).catch((error) => rejectUpgrade(socket, 502, errorMessage(error)));
  });
}

async function proxyKnowledgeViewerHttp(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  projectKey: string,
  routeHandlers: KnowledgeViewerRouteHandlers,
): Promise<void> {
  const access = authorizeViewerRequest(request, projectKey);
  if (!access.ok) {
    writeJsonError(response, 401, 'unauthorized');
    return;
  }

  const target = await routeHandlers.resolveTarget(projectKey);
  if (!target) {
    writeJsonError(response, 503, 'Knowledge viewer is not running');
    return;
  }

  const upstreamUrl = knowledgeViewerUpstreamUrl(request.url || '/', target, false);
  const transport = upstreamUrl.startsWith('https:') ? https : http;
  const upstreamRequest = transport.request(upstreamUrl, {
    method: request.method,
    headers: filterKnowledgeViewerRequestHeaders(request.headers),
  }, (upstreamResponse) => {
    const headers = filterKnowledgeViewerResponseHeaders(upstreamResponse.headers);
    headers['referrer-policy'] = 'no-referrer';
    const location = upstreamResponse.headers.location;
    if (location) headers.location = rewriteLocation(location, upstreamUrl, target);
    if (access.grantCookie) {
      headers['set-cookie'] = viewerCookieHeader(access.token, request);
    }
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/config') {
      void proxyKnowledgeViewerConfigResponse(request, response, upstreamResponse, headers);
      return;
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on('error', (error) => {
    if (!response.headersSent) writeJsonError(response, 502, errorMessage(error));
    else response.destroy(error);
  });
  request.on('aborted', () => upstreamRequest.destroy());
  request.pipe(upstreamRequest);
}

async function proxyKnowledgeViewerConfigResponse(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  upstreamResponse: http.IncomingMessage,
  headers: http.OutgoingHttpHeaders,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of upstreamResponse) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_CONFIG_RESPONSE_BYTES) {
        throw new Error('open-knowledge config response exceeded 64 KiB');
      }
      chunks.push(buffer);
    }

    const config = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const host = request.headers.host;
    if (!host) throw new Error('knowledge viewer request host is missing');
    const secure = firstHeader(request.headers['x-forwarded-proto']) === 'https' || 'encrypted' in request.socket;
    if (typeof config.collabUrl === 'string') {
      const collabUrl = new URL(config.collabUrl);
      config.collabUrl = `${secure ? 'wss' : 'ws'}://${host}${collabUrl.pathname}${collabUrl.search}`;
    }
    if (typeof config.previewUrl === 'string') {
      const previewUrl = new URL(config.previewUrl);
      config.previewUrl = `${secure ? 'https' : 'http'}://${host}${previewUrl.pathname}${previewUrl.search}`;
    }

    const body = Buffer.from(JSON.stringify(config));
    headers['content-length'] = body.length;
    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
    response.end(body);
  } catch (error) {
    if (!response.headersSent) writeJsonError(response, 502, errorMessage(error));
    else response.destroy(error instanceof Error ? error : undefined);
  }
}

function authorizeViewerRequest(
  request: http.IncomingMessage,
  projectKey: string,
): { ok: true; token: string; grantCookie: boolean } | { ok: false } {
  const expected = viewerAccessTokens.get(projectKey);
  if (!expected) return { ok: false };
  const url = new URL(request.url || '/', 'http://localhost');
  const queryToken = url.searchParams.get('access');
  const cookieToken = cookieValue(request.headers.cookie, VIEWER_ACCESS_COOKIE);
  if (constantTimeEqual(queryToken, expected)) return { ok: true, token: expected, grantCookie: true };
  if (constantTimeEqual(cookieToken, expected)) return { ok: true, token: expected, grantCookie: false };
  return { ok: false };
}

function viewerOriginIsAllowed(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host === request.headers.host) return true;
    } catch {
      return false;
    }
  }
  return validateOriginHeaders(request.headers, request.method ?? 'GET').ok;
}

function viewerCookieHeader(token: string, _request: http.IncomingMessage): string {
  return `${VIEWER_ACCESS_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=None; Secure; Path=/`;
}

function bridgeWebSocket(client: WebSocket, request: http.IncomingMessage, upstreamUrl: string): void {
  const protocols = (request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const upstream = new WebSocket(upstreamUrl, protocols.length > 0 ? protocols : undefined, {
    headers: { origin: new URL(upstreamUrl).origin.replace(/^ws/, 'http') },
  });
  const queued: Array<{ data: Buffer; binary: boolean }> = [];
  let queuedBytes = 0;

  client.on('message', (data, binary) => {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(payload, { binary });
      return;
    }
    if (
      queued.length >= MAX_QUEUED_WEBSOCKET_MESSAGES ||
      queuedBytes + payload.byteLength > MAX_QUEUED_WEBSOCKET_BYTES
    ) {
      client.close(1009, 'knowledge-viewer-queue-limit');
      upstream.terminate();
      return;
    }
    queued.push({ data: payload, binary });
    queuedBytes += payload.byteLength;
  });
  upstream.once('open', () => {
    for (const message of queued.splice(0)) upstream.send(message.data, { binary: message.binary });
    queuedBytes = 0;
  });
  upstream.on('message', (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  upstream.on('close', (code, reason) => {
    if (client.readyState === WebSocket.OPEN) client.close(code, reason.toString());
  });
  upstream.on('error', () => {
    if (client.readyState === WebSocket.OPEN) client.close(1011, 'knowledge-viewer-upstream-error');
  });
  client.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
}

function rewriteLocation(location: string, upstreamUrl: string, targetUrl: string): string {
  const resolved = new URL(location, upstreamUrl);
  const target = new URL(targetUrl);
  if (resolved.origin !== target.origin) return location;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function splitHostAndPort(host: string): { hostname: string; port: string } {
  try {
    const parsed = new URL(`http://${host}`);
    return { hostname: parsed.hostname.toLowerCase(), port: parsed.port };
  } catch {
    return { hostname: host.toLowerCase(), port: '' };
  }
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function constantTimeEqual(value: string | null, expected: string): boolean {
  if (!value) return false;
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function writeJsonError(response: http.ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function rejectUpgrade(socket: Socket, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default knowledgeViewerRouteLayer;
