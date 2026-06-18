import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContextApiError,
  loadContextLayers,
  previewContextLayers,
  saveContextLayer,
  syncContextLayers,
} from '../contextApi';
import type {
  ContextLayerSaveRequest,
  ContextLayersResponse,
  ContextPreviewRequest,
  ContextPreviewResponse,
  ContextSyncResponse,
} from '@overdeck/contracts';

const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function lastFetchInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contextApi', () => {
  it('loads context layers from the context layers endpoint', async () => {
    const response: ContextLayersResponse = {
      operation: 'load',
      projects: [],
      workspaces: [],
      layers: [],
    };
    fetchMock.mockResolvedValue(jsonResponse(response));

    await expect(loadContextLayers()).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/context/layers', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }));
  });

  it('posts draft content to the preview endpoint', async () => {
    const request: ContextPreviewRequest = {
      operation: 'preview',
      selectedLayer: { kind: 'project', projectKey: 'panopticon-cli' },
      drafts: [
        {
          target: { kind: 'project', projectKey: 'panopticon-cli' },
          content: 'shared {{#harness:claude}}claude{{/harness:claude}}',
        },
      ],
    };
    const response: ContextPreviewResponse = {
      operation: 'preview',
      previews: { 'claude-code': 'claude', pi: 'shared', fullPrompt: 'full' },
      diagnostics: [],
    };
    fetchMock.mockResolvedValue(jsonResponse(response));

    await expect(previewContextLayers(request)).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/context/preview', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(JSON.parse(lastFetchInit().body as string)).toEqual(request);
  });

  it('puts layer writes only through the save endpoint', async () => {
    const request: ContextLayerSaveRequest = {
      operation: 'save',
      target: { kind: 'workspace', projectKey: 'panopticon-cli', workspacePath: '/repo/workspaces/feature-pan-1201' },
      content: 'workspace context',
    };
    fetchMock.mockResolvedValue(jsonResponse({
      operation: 'save',
      layer: {
        kind: 'workspace',
        projectKey: 'panopticon-cli',
        workspacePath: '/repo/workspaces/feature-pan-1201',
        file: '/repo/workspaces/feature-pan-1201/.pan/context/workspace.md',
        exists: true,
        content: 'workspace context',
        editable: true,
      },
      savedAt: '2026-05-25T00:00:00.000Z',
    }));

    await saveContextLayer(request);

    expect(fetchMock).toHaveBeenCalledWith('/api/context/layers', expect.objectContaining({
      method: 'PUT',
      credentials: 'include',
    }));
    expect(JSON.parse(lastFetchInit().body as string)).toEqual(request);
  });

  it('posts sync requests only to the sync endpoint', async () => {
    const response: ContextSyncResponse = {
      operation: 'sync',
      success: true,
      stdout: 'synced',
      stderr: '',
      syncedAt: '2026-05-25T00:00:00.000Z',
    };
    fetchMock.mockResolvedValue(jsonResponse(response));

    await expect(syncContextLayers()).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/context/sync', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(JSON.parse(lastFetchInit().body as string)).toEqual({ operation: 'sync' });
  });

  it('throws meaningful errors for non-OK responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Context layer is not registered' }, { status: 404 }));

    await expect(loadContextLayers()).rejects.toMatchObject({
      name: 'ContextApiError',
      message: 'Context layer is not registered',
      status: 404,
    } satisfies Partial<ContextApiError>);
  });
});
