import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createKnowledgeViewerRouteHandlers,
  knowledgeViewerUpstreamUrl,
} from '../../../../../src/dashboard/server/routes/knowledge-viewer.js';
import type { KnowledgeViewerStatus } from '../../../../../src/dashboard/server/services/knowledge-viewer.js';

const runningStatus = (overrides: Partial<KnowledgeViewerStatus> = {}): KnowledgeViewerStatus => ({
  projectKey: 'overdeck',
  bundleConfigured: true,
  installed: true,
  starting: false,
  running: true,
  bundlePath: '/repo/knowledge',
  port: 39847,
  apiPort: 8789,
  url: 'http://127.0.0.1:39847',
  ...overrides,
});

describe('knowledge viewer route handlers', () => {
  it('returns truthful status from the viewer service', async () => {
    const getStatus = vi.fn(async () => runningStatus({ running: false, url: undefined, port: undefined }));
    const handlers = createKnowledgeViewerRouteHandlers({ getStatus });

    await expect(handlers.status('overdeck')).resolves.toMatchObject({
      projectKey: 'overdeck',
      bundleConfigured: true,
      installed: true,
      running: false,
    });
    expect(getStatus).toHaveBeenCalledWith('overdeck');
  });

  it('installs only through an explicit auto-install request and then refreshes status', async () => {
    const ensure = vi.fn(async () => ({ status: 'installed', command: 'ok' }));
    const getStatus = vi.fn(async () => runningStatus({ running: false, url: undefined, port: undefined }));
    const handlers = createKnowledgeViewerRouteHandlers({ ensure, getStatus });

    const result = await handlers.install('overdeck');

    expect(ensure).toHaveBeenCalledWith({ autoInstall: true });
    expect(getStatus).toHaveBeenCalledWith('overdeck');
    expect(result.installed).toBe(true);
  });

  it('starts or reuses the viewer and makes it the active proxy target', async () => {
    const start = vi.fn(async () => runningStatus());
    const handlers = createKnowledgeViewerRouteHandlers({ start });

    const result = await handlers.start('overdeck');

    expect(result.running).toBe(true);
    expect(start).toHaveBeenCalledWith('overdeck');
    await expect(handlers.resolveTarget('/knowledge-viewer/')).resolves.toBe('http://127.0.0.1:39847');
  });

  it('proxies HTTP bytes and preserves framing headers for the frontend fallback decision', async () => {
    const fetchImpl = vi.fn(async () => new Response('viewer html', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'x-frame-options': 'DENY',
        'content-security-policy': "frame-ancestors 'none'",
      },
    }));
    const handlers = createKnowledgeViewerRouteHandlers({
      start: async () => runningStatus(),
      fetchImpl,
    });
    await handlers.start('overdeck');

    const response = await handlers.proxyHttp({
      url: '/knowledge-viewer/assets/index.js?cache=1',
      method: 'GET',
      headers: { host: 'overdeck.localhost', accept: '*/*' },
    });

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:39847/assets/index.js?cache=1', expect.objectContaining({
      method: 'GET',
      headers: { accept: '*/*' },
      redirect: 'manual',
    }));
    expect(new TextDecoder().decode(response.body)).toBe('viewer html');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toBe("frame-ancestors 'none'");
  });

  it('rewrites upstream redirects back under the same-origin proxy prefix', async () => {
    const handlers = createKnowledgeViewerRouteHandlers({
      start: async () => runningStatus(),
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:39847/settings?tab=sync' },
      }),
    });
    await handlers.start('overdeck');

    const response = await handlers.proxyHttp({
      url: '/knowledge-viewer/',
      method: 'GET',
      headers: {},
    });

    expect(response.headers.location).toBe('/knowledge-viewer/settings?tab=sync');
  });

  it('maps HTTP and WebSocket paths while stripping the dashboard-only project selector', () => {
    expect(knowledgeViewerUpstreamUrl(
      '/knowledge-viewer/socket?project=overdeck&token=abc',
      'http://127.0.0.1:39847',
      false,
    )).toBe('http://127.0.0.1:39847/socket?token=abc');
    expect(knowledgeViewerUpstreamUrl(
      '/knowledge-viewer/socket?project=overdeck&token=abc',
      'http://127.0.0.1:39847',
      true,
    )).toBe('ws://127.0.0.1:39847/socket?token=abc');
  });

  it('is composed before the SPA fallback and installs its WebSocket upgrade hook', async () => {
    const serverPath = fileURLToPath(new URL('../../../../../src/dashboard/server/server.ts', import.meta.url));
    const source = await readFile(serverPath, 'utf8');

    expect(source).toContain('setupKnowledgeViewerWebSocketProxy(nodeServer);');
    expect(source.indexOf('knowledgeViewerRouteLayer,')).toBeLessThan(source.indexOf('staticRouteLayer,'));
  });
});
