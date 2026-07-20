import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetInternalTokenCacheForTests } from '../../../../../src/lib/internal-token.js';
import {
  createKnowledgeViewerRouteHandlers,
  filterKnowledgeViewerRequestHeaders,
  filterKnowledgeViewerResponseHeaders,
  knowledgeViewerHost,
  knowledgeViewerProxyUrl,
  knowledgeViewerRouteLayer,
  knowledgeViewerUpstreamUrl,
  projectFromKnowledgeViewerHost,
  resetKnowledgeViewerAccessTokensForTests,
  setupKnowledgeViewerProxy,
} from '../../../../../src/dashboard/server/routes/knowledge-viewer.js';
import {
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
} from '../../../../../src/dashboard/server/routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../../../../../src/dashboard/server/routes/origin-validation.js';
import type { KnowledgeViewerStatus } from '../../../../../src/dashboard/server/services/knowledge-viewer.js';

const runningStatus = (projectKey = 'overdeck', overrides: Partial<KnowledgeViewerStatus> = {}): KnowledgeViewerStatus => ({
  projectKey,
  bundleConfigured: true,
  installed: true,
  starting: false,
  running: true,
  bundlePath: `/repo/${projectKey}-knowledge`,
  port: 39847,
  apiPort: 8789,
  url: 'http://127.0.0.1:39847',
  embeddable: true,
  ...overrides,
});

async function routeResponse(path: string, init: RequestInit = {}) {
  const request = HttpServerRequest.fromWeb(new Request(`http://overdeck.localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(knowledgeViewerRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request)
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '';
  return { status: response.status, body: text ? JSON.parse(text) as { error?: string } : null };
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('server address unavailable'));
      else resolve(address.port);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function hostRequest(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, headers: { host, ...headers } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'test-internal-token';
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = 'test-session-token';
  process.env.OVERDECK_DASHBOARD_CSRF_TOKEN = 'test-csrf-token';
  process.env.DASHBOARD_URL = 'https://overdeck.localhost';
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
  resetKnowledgeViewerAccessTokensForTests();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_CSRF_TOKEN;
  delete process.env.DASHBOARD_URL;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetTrustedOriginsForTests();
  resetKnowledgeViewerAccessTokensForTests();
});

describe('knowledge viewer route handlers', () => {
  it('resolves proxy targets by immutable project identity', async () => {
    const getStatus = vi.fn(async (projectKey: string) => runningStatus(projectKey, {
      url: projectKey === 'alpha' ? 'http://127.0.0.1:4101' : 'http://127.0.0.1:4102',
    }));
    const handlers = createKnowledgeViewerRouteHandlers({ getStatus });

    await expect(handlers.resolveTarget('alpha')).resolves.toBe('http://127.0.0.1:4101');
    await expect(handlers.resolveTarget('beta')).resolves.toBe('http://127.0.0.1:4102');
    expect(getStatus).toHaveBeenNthCalledWith(1, 'alpha');
    expect(getStatus).toHaveBeenNthCalledWith(2, 'beta');
  });

  it('installs only through an explicit auto-install request and then refreshes status', async () => {
    const ensure = vi.fn(async () => ({ status: 'installed', command: 'ok' }));
    const getStatus = vi.fn(async () => runningStatus('overdeck', { running: false, url: undefined, port: undefined }));
    const handlers = createKnowledgeViewerRouteHandlers({ ensure, getStatus });

    const result = await handlers.install('overdeck');

    expect(ensure).toHaveBeenCalledWith({ autoInstall: true });
    expect(getStatus).toHaveBeenCalledWith('overdeck');
    expect(result.installed).toBe(true);
  });

  it('maps root-relative HTTP and WebSocket paths without leaking access tokens upstream', () => {
    expect(knowledgeViewerUpstreamUrl(
      '/api/config?access=secret&cache=1',
      'http://127.0.0.1:39847',
      false,
    )).toBe('http://127.0.0.1:39847/api/config?cache=1');
    expect(knowledgeViewerUpstreamUrl(
      '/collab?access=secret&room=abc',
      'http://127.0.0.1:39847',
      true,
    )).toBe('ws://127.0.0.1:39847/collab?room=abc');
  });

  it('encodes the project in an origin-isolated viewer host', () => {
    const host = knowledgeViewerHost('overdeck', 'overdeck.localhost');
    expect(host).toBe('knowledge-6f7665726465636b.overdeck.localhost');
    expect(projectFromKnowledgeViewerHost(host)).toBe('overdeck');
    expect(projectFromKnowledgeViewerHost('knowledge-not-hex.overdeck.localhost')).toBeNull();
  });

  it('uses explicit header allowlists at the third-party process boundary', () => {
    expect(filterKnowledgeViewerRequestHeaders({
      accept: 'text/html',
      cookie: 'overdeck_session=secret',
      authorization: 'Bearer secret',
      'x-overdeck-internal-token': 'secret',
      'x-overdeck-csrf-token': 'secret',
      referer: 'https://overdeck.localhost/?token=secret',
    })).toEqual({ accept: 'text/html' });

    expect(filterKnowledgeViewerResponseHeaders(new Headers({
      'content-type': 'text/html',
      'set-cookie': 'overdeck_session=attacker',
      'x-frame-options': 'DENY',
      'x-overdeck-internal-token': 'secret',
    }))).toEqual({
      'content-type': 'text/html',
      'x-frame-options': 'DENY',
    });
  });
});

describe('knowledge viewer authorization gates', () => {
  it('rejects status without dashboard authorization', async () => {
    const response = await routeResponse('/api/knowledge-viewer/status?project=overdeck');
    expect(response).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
  });

  it('rejects mutation requests with the wrong content type', async () => {
    const response = await routeResponse('/api/knowledge-viewer/install', {
      method: 'POST',
      headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=test-session-token`, 'content-type': 'text/plain' },
      body: JSON.stringify({ project: 'overdeck' }),
    });
    expect(response).toMatchObject({ status: 400, body: { error: 'Content-Type must be application/json' } });
  });

  it('rejects mutation requests from an invalid origin', async () => {
    const response = await routeResponse('/api/knowledge-viewer/start', {
      method: 'POST',
      headers: {
        cookie: `${DASHBOARD_SESSION_COOKIE}=test-session-token`,
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
        [DASHBOARD_CSRF_HEADER]: 'test-csrf-token',
      },
      body: JSON.stringify({ project: 'overdeck' }),
    });
    expect(response).toMatchObject({ status: 403, body: { error: 'Invalid origin' } });
  });

  it('rejects mutation requests without a valid CSRF token', async () => {
    const response = await routeResponse('/api/knowledge-viewer/start', {
      method: 'POST',
      headers: {
        cookie: `${DASHBOARD_SESSION_COOKIE}=test-session-token`,
        'content-type': 'application/json',
        origin: 'https://overdeck.localhost',
      },
      body: JSON.stringify({ project: 'overdeck' }),
    });
    expect(response).toMatchObject({ status: 403, body: { error: 'Invalid CSRF token' } });
  });
});

describe('origin-isolated knowledge viewer proxy', () => {
  it('requires delegated access and keeps root API traffic pinned to the host project', async () => {
    const upstreamAlpha = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.setHeader('set-cookie', 'overdeck_session=attacker');
      response.end(JSON.stringify({ project: 'alpha', path: request.url }));
    });
    const upstreamBeta = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ project: 'beta', path: request.url }));
    });
    const alphaPort = await listen(upstreamAlpha);
    const betaPort = await listen(upstreamBeta);
    const handlers = createKnowledgeViewerRouteHandlers({
      getStatus: async (projectKey) => runningStatus(projectKey, {
        url: `http://127.0.0.1:${projectKey === 'alpha' ? alphaPort : betaPort}`,
      }),
    });
    const proxy = http.createServer();
    setupKnowledgeViewerProxy(proxy, handlers);
    proxy.on('request', (_request, response) => {
      response.writeHead(404);
      response.end();
    });
    const proxyPort = await listen(proxy);

    try {
      const alphaProxy = new URL(`http:${knowledgeViewerProxyUrl('alpha', `localhost:${proxyPort}`)}`);
      const betaProxy = new URL(`http:${knowledgeViewerProxyUrl('beta', `localhost:${proxyPort}`)}`);

      const unauthorized = await hostRequest(proxyPort, alphaProxy.host, '/api/config');
      expect(unauthorized.status).toBe(401);

      const alpha = await hostRequest(proxyPort, alphaProxy.host, `/api/config${alphaProxy.search}`);
      expect(alpha.status).toBe(200);
      expect(JSON.parse(alpha.body)).toEqual({ project: 'alpha', path: '/api/config' });
      expect(alpha.headers['set-cookie']?.[0]).toContain('overdeck_knowledge_viewer=');
      expect(alpha.headers['set-cookie']?.[0]).toContain('SameSite=None');
      expect(alpha.headers['set-cookie']?.[0]).toContain('Secure');
      expect(alpha.headers['set-cookie']?.join(';')).not.toContain('attacker');

      const cookie = alpha.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
      const alphaCollab = await hostRequest(proxyPort, alphaProxy.host, '/collab?room=one', { cookie });
      expect(JSON.parse(alphaCollab.body)).toEqual({ project: 'alpha', path: '/collab?room=one' });

      const beta = await hostRequest(proxyPort, betaProxy.host, `/api/config${betaProxy.search}`);
      expect(JSON.parse(beta.body)).toEqual({ project: 'beta', path: '/api/config' });
    } finally {
      await Promise.all([close(proxy), close(upstreamAlpha), close(upstreamBeta)]);
    }
  });

  it('rewrites OpenKnowledge config URLs through the isolated viewer origin', async () => {
    const upstream = http.createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        collabUrl: 'ws://127.0.0.1:8789/collab?room=one',
        previewUrl: 'http://127.0.0.1:8789/preview',
        port: 8789,
      }));
    });
    const upstreamPort = await listen(upstream);
    const handlers = createKnowledgeViewerRouteHandlers({
      getStatus: async (projectKey) => runningStatus(projectKey, { url: `http://127.0.0.1:${upstreamPort}` }),
    });
    const proxy = http.createServer();
    setupKnowledgeViewerProxy(proxy, handlers);
    proxy.on('request', (_request, response) => {
      response.writeHead(404);
      response.end();
    });
    const proxyPort = await listen(proxy);

    try {
      const proxyUrl = new URL(`http:${knowledgeViewerProxyUrl('alpha', `localhost:${proxyPort}`)}`);
      const result = await hostRequest(proxyPort, proxyUrl.host, `/api/config${proxyUrl.search}`, {
        'x-forwarded-proto': 'https',
      });

      expect(result.status).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        collabUrl: `wss://${proxyUrl.host}/collab?room=one`,
        previewUrl: `https://${proxyUrl.host}/preview`,
        port: 8789,
      });
      expect(result.headers['content-length']).toBe(String(Buffer.byteLength(result.body)));
    } finally {
      await Promise.all([close(proxy), close(upstream)]);
    }
  });

  it('is installed before Effect request and WebSocket listeners', async () => {
    const serverPath = fileURLToPath(new URL('../../../../../src/dashboard/server/server.ts', import.meta.url));
    const source = await readFile(serverPath, 'utf8');

    expect(source).toContain('setupKnowledgeViewerProxy(nodeServer);');
    expect(source.indexOf('knowledgeViewerRouteLayer,')).toBeLessThan(source.indexOf('staticRouteLayer,'));
  });
});
