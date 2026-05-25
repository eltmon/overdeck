import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContextLayerSaveRequest,
  ContextLayerSaveResponse,
  ContextLayersResponse,
  ContextPreviewRequest,
  ContextPreviewResponse,
  ContextSyncRequest,
  ContextSyncResponse,
} from '@panctl/contracts';

export class ContextApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'ContextApiError';
  }
}

export const contextQueryKeys = {
  layers: ['context', 'layers'] as const,
};

type JsonRequest = {
  method: 'GET' | 'POST' | 'PUT';
  body?: unknown;
};

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record['error'] === 'string') return record['error'];
    if (typeof record['message'] === 'string') return record['message'];
  }
  if (typeof body === 'string' && body.trim()) return body;
  return `Context API request failed with status ${status}`;
}

async function requestJson<T>(path: string, request: JsonRequest): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method: request.method,
    credentials: 'include',
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new ContextApiError(errorMessage(response.status, body), response.status, body);
  }
  return body as T;
}

export function loadContextLayers(): Promise<ContextLayersResponse> {
  return requestJson('/api/context/layers', { method: 'GET' });
}

export function previewContextLayers(request: ContextPreviewRequest): Promise<ContextPreviewResponse> {
  return requestJson('/api/context/preview', { method: 'POST', body: request });
}

export function saveContextLayer(request: ContextLayerSaveRequest): Promise<ContextLayerSaveResponse> {
  return requestJson('/api/context/layers', { method: 'PUT', body: request });
}

export function syncContextLayers(request: ContextSyncRequest = { operation: 'sync' }): Promise<ContextSyncResponse> {
  return requestJson('/api/context/sync', { method: 'POST', body: request });
}

export function useContextLayersQuery() {
  return useQuery({
    queryKey: contextQueryKeys.layers,
    queryFn: loadContextLayers,
  });
}

export function useContextPreviewMutation() {
  return useMutation({ mutationFn: previewContextLayers });
}

export function useContextSaveMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveContextLayer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contextQueryKeys.layers });
    },
  });
}

export function useContextSyncMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncContextLayers,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contextQueryKeys.layers });
    },
  });
}
