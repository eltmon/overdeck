import http from 'node:http';
import type { Socket } from 'node:net';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { WebSocket, WebSocketServer } from 'ws';
import { ensureOpenKnowledge } from '../../../lib/installers/open-knowledge.js';
import {
  getKnowledgeViewerStatus,
  getOrStartViewer,
  type KnowledgeViewerStatus,
} from '../services/knowledge-viewer.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { validateOriginHeaders } from './origin-validation.js';

export interface KnowledgeViewerRouteDependencies {
  getStatus?: (projectKey: string) => Promise<KnowledgeViewerStatus>;
  ensure?: (options: { autoInstall: true }) => Promise<unknown>;
  start?: (projectKey: string) => Promise<KnowledgeViewerStatus>;
  fetchImpl?: typeof fetch;
}

export interface KnowledgeViewerProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string | undefined>;
  body?: Uint8Array;
}

export interface KnowledgeViewerProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface KnowledgeViewerRouteHandlers {
  status(projectKey: string): Promise<KnowledgeViewerStatus>;
  install(projectKey: string): Promise<KnowledgeViewerStatus>;
  start(projectKey: string): Promise<KnowledgeViewerStatus>;
  resolveTarget(requestUrl: string): Promise<string | null>;
  proxyHttp(request: KnowledgeViewerProxyRequest): Promise<KnowledgeViewerProxyResponse>;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createKnowledgeViewerRouteHandlers(
  dependencies: KnowledgeViewerRouteDependencies = {},
): KnowledgeViewerRouteHandlers {
  const getStatus = dependencies.getStatus ?? getKnowledgeViewerStatus;
  const ensure = dependencies.ensure ?? ((options) => ensureOpenKnowledge(options));
  const startViewer = dependencies.start ?? getOrStartViewer;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let activeTarget: { projectKey: string; url: string } | null = null;

  async function status(projectKey: string): Promise<KnowledgeViewerStatus> {
    const result = await getStatus(projectKey);
    if (result.running && result.url) activeTarget = { projectKey, url: result.url };
    return result;
  }

  async function install(projectKey: string): Promise<KnowledgeViewerStatus> {
    await ensure({ autoInstall: true });
    return status(projectKey);
  }

  async function start(projectKey: string): Promise<KnowledgeViewerStatus> {
    const result = await startViewer(projectKey);
    if (result.running && result.url) activeTarget = { projectKey, url: result.url };
    return result;
  }

  async function resolveTarget(requestUrl: string): Promise<string | null> {
    const url = new URL(requestUrl, 'http://localhost');
    const projectKey = url.searchParams.get('project');
    if (projectKey) {
      const result = await status(projectKey);
      if (result.running && result.url) return result.url;
      return null;
    }
    return activeTarget?.url ?? null;
  }

  async function proxyHttp(request: KnowledgeViewerProxyRequest): Promise<KnowledgeViewerProxyResponse> {
    const target = await resolveTarget(request.url);
    if (!target) throw new Error('Knowledge viewer is not running. Start it before opening /knowledge-viewer/.');

    const upstreamUrl = knowledgeViewerUpstreamUrl(request.url, target, false);
    const method = request.method.toUpperCase();
    const response = await fetchImpl(upstreamUrl, {
      method,
      headers: filterRequestHeaders(request.headers),
      body: method === 'GET' || method === 'HEAD' || !request.body ? undefined : Buffer.from(request.body),
      redirect: 'manual',
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const headers = filterResponseHeaders(response.headers);
    const location = response.headers.get('location');
    if (location) headers.location = rewriteLocation(location, upstreamUrl, target);

    return { status: response.status, headers, body };
  }

  return { status, install, start, resolveTarget, proxyHttp };
}

export function knowledgeViewerUpstreamUrl(
  requestUrl: string,
  targetUrl: string,
  websocket: boolean,
): string {
  const incoming = new URL(requestUrl, 'http://localhost');
  incoming.searchParams.delete('project');
  const suffix = incoming.pathname.slice('/knowledge-viewer'.length) || '/';
  const target = new URL(targetUrl);
  target.protocol = websocket ? (target.protocol === 'https:' ? 'wss:' : 'ws:') : target.protocol;
  target.pathname = suffix.startsWith('/') ? suffix : `/${suffix}`;
  target.search = incoming.search;
  target.hash = '';
  return target.toString();
}

function filterRequestHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!value || HOP_BY_HOP_HEADERS.has(lower) || lower === 'host' || lower === 'content-length') continue;
    filtered[lower] = value;
  }
  return filtered;
}

function filterResponseHeaders(headers: Headers): Record<string, string> {
  const filtered: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) filtered[name] = value;
  });
  return filtered;
}

function rewriteLocation(location: string, upstreamUrl: string, targetUrl: string): string {
  const resolved = new URL(location, upstreamUrl);
  const target = new URL(targetUrl);
  if (resolved.origin !== target.origin) return location;
  return `/knowledge-viewer${resolved.pathname}${resolved.search}${resolved.hash}`;
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

function proxyResponse(response: KnowledgeViewerProxyResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.uint8Array(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

const handlers = createKnowledgeViewerRouteHandlers();

const statusRoute = HttpRouter.add(
  'GET',
  '/api/knowledge-viewer/status',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const projectKey = projectFromRequestUrl(request.url);
    if (!projectKey) return jsonResponse({ error: 'project query parameter is required' }, { status: 400 });
    return jsonResponse(yield* Effect.promise(() => handlers.status(projectKey)));
  })),
);

const installRoute = HttpRouter.add(
  'POST',
  '/api/knowledge-viewer/install',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const projectKey = parseProjectBody(yield* request.text);
    if (!projectKey) return jsonResponse({ error: 'project is required in the request body' }, { status: 400 });
    try {
      return jsonResponse(yield* Effect.promise(() => handlers.install(projectKey)));
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
    const projectKey = parseProjectBody(yield* request.text);
    if (!projectKey) return jsonResponse({ error: 'project is required in the request body' }, { status: 400 });
    try {
      const result = yield* Effect.promise(() => handlers.start(projectKey));
      return jsonResponse(result, { status: result.running ? 200 : 409 });
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, { status: 500 });
    }
  })),
);

const proxyRoute = HttpRouter.add(
  '*',
  '/knowledge-viewer/*',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname === '/knowledge-viewer') {
      return HttpServerResponse.redirect(`/knowledge-viewer/${requestUrl.search}`);
    }
    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD'
      ? undefined
      : new Uint8Array(yield* request.arrayBuffer);
    try {
      return proxyResponse(yield* Effect.promise(() => handlers.proxyHttp({
        url: request.url,
        method,
        headers: request.headers,
        ...(body ? { body } : {}),
      })));
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, { status: 503 });
    }
  })),
);

export const knowledgeViewerRouteLayer = Layer.mergeAll(
  statusRoute,
  installRoute,
  startRoute,
  proxyRoute,
);

export function setupKnowledgeViewerWebSocketProxy(
  server: http.Server,
  routeHandlers: KnowledgeViewerRouteHandlers = handlers,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const originalOn = server.on.bind(server);

  server.on = function(event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      const wrapped = (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
        const url = new URL(request.url || '', `http://${request.headers.host}`);
        if (url.pathname.startsWith('/knowledge-viewer/')) return;
        (listener as (req: http.IncomingMessage, socket: Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (!url.pathname.startsWith('/knowledge-viewer/')) return;

    const origin = validateOriginHeaders(request.headers, request.method ?? 'GET');
    if (!origin.ok) {
      rejectUpgrade(socket, 403, origin.error);
      return;
    }

    void routeHandlers.resolveTarget(request.url || '/knowledge-viewer/').then((target) => {
      if (!target) {
        rejectUpgrade(socket, 503, 'Knowledge viewer is not running');
        return;
      }
      wss.handleUpgrade(request, socket, head, (client) => {
        bridgeWebSocket(client, request, knowledgeViewerUpstreamUrl(request.url || '/knowledge-viewer/', target, true));
      });
    }).catch((error) => rejectUpgrade(socket, 502, errorMessage(error)));
  });
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

  client.on('message', (data, binary) => {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (upstream.readyState === WebSocket.OPEN) upstream.send(payload, { binary });
    else queued.push({ data: payload, binary });
  });
  upstream.once('open', () => {
    for (const message of queued.splice(0)) upstream.send(message.data, { binary: message.binary });
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

function rejectUpgrade(socket: Socket, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default knowledgeViewerRouteLayer;
