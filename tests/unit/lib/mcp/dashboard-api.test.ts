/**
 * PAN-4927 W-MCP1: `createFetchDashboardApi` across every HTTP method, and
 * abort behavior (FR-5, FR-6, D-7).
 */
import { describe, expect, it, vi } from 'vitest';

import { createFetchDashboardApi } from '../../../../src/lib/mcp/dashboard-api.js';

interface RecordedFetch {
  url: string;
  init: RequestInit;
}

function recordingFetch(): { fetchImpl: typeof fetch; calls: RecordedFetch[] } {
  const calls: RecordedFetch[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('createFetchDashboardApi (PAN-4927 W-MCP1)', () => {
  it('DELETE sends no body and no Content-Type', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    await api.request('DELETE', '/x');
    expect(calls[0]!.init.body).toBeUndefined();
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('GET sends no body', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    await api.request('GET', '/x');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('PUT, PATCH and POST send JSON with Content-Type; PATCH with no body sends {}', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    await api.request('PUT', '/x', { a: 1 });
    await api.request('PATCH', '/x', { a: 1 });
    await api.request('POST', '/x', { a: 1 });
    await api.request('PATCH', '/x');
    for (const call of calls.slice(0, 3)) {
      expect(call.init.body).toBe('{"a":1}');
      expect((call.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    }
    expect(calls[3]!.init.body).toBe('{}');
  });

  it('passes the given signal through to fetch', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    const controller = new AbortController();
    await api.request('GET', '/x', undefined, { signal: controller.signal });
    expect(calls[0]!.init.signal).toBe(controller.signal);
  });

  it('an already-aborted signal rejects with AbortError, not the unreachable wrapping', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) as unknown as typeof fetch;
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    const controller = new AbortController();
    controller.abort();
    await expect(api.request('GET', '/x', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a non-abort rejection still yields the unreachable wrapping', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    await expect(api.request('GET', '/x')).rejects.toThrow('Overdeck dashboard unreachable at http://dash: boom');
  });

  it('every request carries the Bearer token', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const api = createFetchDashboardApi({ baseUrl: 'http://dash', token: 'odk_test', fetchImpl });
    await api.request('GET', '/x');
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer odk_test');
  });
});
