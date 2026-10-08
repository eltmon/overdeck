import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithTimeout } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}));
vi.mock('../../lib/apiFetch.js', () => ({ fetchWithTimeout }));
vi.mock('../../lib/wsTransport.js', () => ({ dashboardMutationJsonHeaders: async () => ({ 'Content-Type': 'application/json' }) }));

const { ensureMainWorkspace } = await import('./openMainWorkspace');

function registry(workspaces: Array<{ id: string; projectId: string; kind: string; isArchived: boolean }>) {
  return (url: string, init?: RequestInit): Response | undefined =>
    url === '/api/workspace-registry?project=okf&kind=main&includeArchived=true' && !init?.method
      ? Response.json({ workspaces: workspaces.filter((ws) => ws.projectId === 'okf') })
      : undefined;
}

function route(...handlers: Array<(url: string, init?: RequestInit) => Response | undefined>) {
  fetchWithTimeout.mockImplementation(async (url, init) => {
    for (const handler of handlers) {
      const response = handler(url, init);
      if (response) return response;
    }
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
  });
}

beforeEach(() => {
  fetchWithTimeout.mockReset();
});

describe('ensureMainWorkspace', () => {
  it('returns the existing main row without writing anything', async () => {
    route(registry([{ id: 'ws-main', projectId: 'okf', kind: 'main', isArchived: false }]));
    await expect(ensureMainWorkspace('okf')).resolves.toBe('ws-main');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('unarchives an archived main row instead of creating a second one', async () => {
    route(
      registry([{ id: 'ws-main', projectId: 'okf', kind: 'main', isArchived: true }]),
      (url, init) => url === '/api/workspace-registry/ws-main/archive' && init?.method === 'POST' ? Response.json({ ok: true }) : undefined,
    );
    await expect(ensureMainWorkspace('okf')).resolves.toBe('ws-main');
    const archiveCall = fetchWithTimeout.mock.calls.find(([url]) => url.endsWith('/archive'));
    expect(JSON.parse(String(archiveCall?.[1]?.body))).toEqual({ archived: false });
  });

  it('bootstraps the main row when the project has none', async () => {
    route(
      registry([{ id: 'ws-other', projectId: 'lexerra', kind: 'main', isArchived: false }]),
      (url, init) => url === '/api/workspace-registry' && init?.method === 'POST' ? Response.json({ id: 'ws-new' }, { status: 201 }) : undefined,
    );
    await expect(ensureMainWorkspace('okf')).resolves.toBe('ws-new');
    const createCall = fetchWithTimeout.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ project: 'okf', bootstrapMain: true });
  });

  it('throws the server finding when the bootstrap is refused', async () => {
    route(
      registry([]),
      (url, init) => url === '/api/workspace-registry' && init?.method === 'POST'
        ? Response.json({ findings: [{ message: 'project path does not exist' }] }, { status: 422 })
        : undefined,
    );
    await expect(ensureMainWorkspace('okf')).rejects.toThrow('project path does not exist');
  });
});
