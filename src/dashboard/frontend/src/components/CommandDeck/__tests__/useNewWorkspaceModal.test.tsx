/**
 * PAN-3330 WI-3 AC-4: what happens *after* a workspace is created — the
 * registry cache is invalidated rather than waited out, the new workspace is
 * activated, and the app navigates to it.
 *
 * The modal suite stops at `onCreated`; this covers the controller that
 * `onCreated` hands off to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../lib/apiFetch.js', () => ({ fetchWithTimeout: vi.fn() }));

vi.mock('../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf',
  })),
}));

import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import { useNewWorkspaceModal, useNewWorkspaceStore } from '../useNewWorkspaceModal.js';

const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const onSelectWorkspace = vi.fn();
  const view = renderHook(() => useNewWorkspaceModal(onSelectWorkspace), { wrapper: wrapper(client) });
  return { view, invalidateQueries, onSelectWorkspace };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
  useNewWorkspaceStore.setState({ isOpen: false, presetProjectKey: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNewWorkspaceModal — open/close (WI-4)', () => {
  it('opens with no preset by default and records a preset when given one', () => {
    const { view } = setup();

    act(() => view.result.current.open());
    expect(view.result.current.isOpen).toBe(true);
    expect(view.result.current.presetProjectKey).toBeNull();

    act(() => view.result.current.close());
    act(() => view.result.current.open('overdeck'));

    expect(view.result.current.isOpen).toBe(true);
    expect(view.result.current.presetProjectKey).toBe('overdeck');
  });

  it('replaces a previous preset when reopened for a different project', () => {
    const { view } = setup();

    act(() => view.result.current.open('project-a'));
    act(() => view.result.current.close());
    act(() => view.result.current.open('project-b'));

    expect(view.result.current.presetProjectKey).toBe('project-b');
  });

  it('clears the preset when reopened with none', () => {
    const { view } = setup();

    act(() => view.result.current.open('project-a'));
    act(() => view.result.current.close());
    act(() => view.result.current.open());

    expect(view.result.current.presetProjectKey).toBeNull();
  });
});

describe('useNewWorkspaceModal — after a create (WI-3 AC-4)', () => {
  it('invalidates the registry list, activates the new workspace, and opens it', async () => {
    const { view, invalidateQueries, onSelectWorkspace } = setup();

    act(() => view.result.current.onCreated('ws-42'));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspace-registry'] });
    expect(onSelectWorkspace).toHaveBeenCalledWith('ws-42');
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/workspace-registry/ws-42/activate',
        expect.objectContaining({ method: 'POST' }),
      ));
  });

  it('still navigates when the activation POST fails — activation only touches recency', async () => {
    const { view, onSelectWorkspace } = setup();
    mockFetch.mockRejectedValue(new Error('network down'));

    act(() => view.result.current.onCreated('ws-42'));

    expect(onSelectWorkspace).toHaveBeenCalledWith('ws-42');
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });

  it('percent-encodes the workspace id in the activation URL', async () => {
    const { view } = setup();

    act(() => view.result.current.onCreated('ws/42'));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/workspace-registry/ws%2F42/activate', expect.anything()));
  });
});
