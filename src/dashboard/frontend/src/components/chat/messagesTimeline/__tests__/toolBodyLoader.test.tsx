import { afterEach, describe, expect, it, vi } from 'vitest';

import { toolBodyLoaderFor } from '../toolBodyLoader';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async () => Response.json({ entry: { id: 'id', createdAt: '2026-11-13T00:00:00.000Z', label: 'Shell', tone: 'tool' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('toolBodyLoaderFor (PAN-5211)', () => {
  it('appends seq after an existing query', async () => {
    const fetchMock = stubFetch();

    await toolBodyLoaderFor('/api/x/tool-body', '?agentId=a').load('id', 42);

    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/x/tool-body/id?agentId=a&seq=42');
  });

  it('starts the query with seq when there is no other query', async () => {
    const fetchMock = stubFetch();

    await toolBodyLoaderFor('/api/x/tool-body').load('id', 42);

    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/x/tool-body/id?seq=42');
  });

  it('sends no seq without a sequence', async () => {
    const fetchMock = stubFetch();

    await toolBodyLoaderFor('/api/x/tool-body', '?agentId=a').load('id');

    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/x/tool-body/id?agentId=a');
  });
});
