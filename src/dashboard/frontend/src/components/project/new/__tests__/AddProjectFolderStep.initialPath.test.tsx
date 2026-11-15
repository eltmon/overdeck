/**
 * Add-project prefill (PAN-5349 O-D10): a folder handed to the dialog is
 * resolved on mount, and the store forgets it on hide().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));
vi.mock('../../../../lib/telemetry.js', () => ({ capture: vi.fn() }));

import { AddProjectFolderStep } from '../AddProjectFolderStep.js';
import { useAddProjectDialog } from '../addProjectDialogStore.js';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const resolvedPaths = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === '/api/projects/resolve')
    .map(([, init]) => (JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as { path?: string }).path)
    .filter(Boolean);

function renderStep(initialPath?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AddProjectFolderStep showGuide={false} initialPath={initialPath} onCreated={vi.fn()} onChange={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/fs/list-dirs')) return Promise.resolve(json({ path: '/home/op/Projects', parent: '/home/op', entries: [] }));
    if (url === '/api/projects/suggestions') return Promise.resolve(json({ root: '/home/op/Projects', homeDir: '/home/op', repositories: [] }));
    // Resolve never answers, so the step stays on "Checking…".
    if (url === '/api/projects/resolve') return new Promise(() => {});
    return Promise.resolve(json({}));
  });
});

afterEach(() => vi.clearAllMocks());

describe('Add-project folder step prefill', () => {
  it('resolves initialPath on mount without a click', async () => {
    renderStep('/x/y');
    await waitFor(() => expect(resolvedPaths()).toContain('/x/y'));
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  it('stays on the folder picker without initialPath', async () => {
    renderStep();
    expect(screen.getByLabelText('Folder')).toHaveValue('');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects/suggestions', expect.anything()));
    expect(resolvedPaths()).toEqual([]);
    expect(screen.queryByText('Checking…')).toBeNull();
  });
});

describe('Add-project dialog store', () => {
  it('keeps initialPath on show and clears it on hide', () => {
    useAddProjectDialog.getState().show('existing', undefined, { initialPath: '/x/y' });
    expect(useAddProjectDialog.getState().initialPath).toBe('/x/y');
    useAddProjectDialog.getState().hide();
    expect(useAddProjectDialog.getState().initialPath).toBeUndefined();
  });
});
