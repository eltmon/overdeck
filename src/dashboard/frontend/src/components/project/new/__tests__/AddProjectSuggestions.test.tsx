/**
 * Suggestions on the Add-project start step (PAN-4281 WI-8): each **Add** goes
 * through resolve and then create, and a finding stops it before create.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));
vi.mock('../../../../lib/telemetry.js', () => ({ capture: vi.fn() }));

import { AddProjectDialog } from '../AddProjectDialog.js';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const SUGGESTIONS = {
  root: '/home/op/Projects',
  homeDir: '/home/op',
  repositories: [{ name: 'widget', path: '/home/op/Projects/widget' }],
};

function routeFetch({
  suggestions = SUGGESTIONS as unknown,
  findings = [] as Array<{ field: string; code: string; message: string }>,
} = {}): void {
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/projects/suggestions') return Promise.resolve(json(suggestions));
    if (url === '/api/registered-projects') return Promise.resolve(json([{ key: 'other' }]));
    if (url === '/api/projects/resolve') return Promise.resolve(json({ findings }));
    if (url === '/api/projects') {
      return Promise.resolve(json({ key: 'widget', name: 'widget', path: '/home/op/Projects/widget' }));
    }
    return Promise.resolve(json({}));
  });
}

function renderStart(onCreated = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AddProjectDialog variant="modal" onCreated={onCreated} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url, init]) => ({ url, body: JSON.parse(String((init as RequestInit).body)) }));

beforeEach(() => {
  fetchMock.mockReset();
  sessionStorage.clear();
});

afterEach(() => vi.clearAllMocks());

describe('Add-project suggestions', () => {
  it('suggestion Add calls resolve with mode existing and then create', async () => {
    const user = userEvent.setup();
    routeFetch();
    const { onCreated } = renderStart();

    expect(await screen.findByText('Repositories in ~/Projects')).toBeInTheDocument();
    expect(screen.getByText('~/Projects/widget')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add widget' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      key: 'widget',
      name: 'widget',
      path: '/home/op/Projects/widget',
    }));
    const calls = posts();
    expect(calls.map((call) => call.url)).toEqual(['/api/projects/resolve', '/api/projects']);
    expect(calls[0]!.body).toEqual({ mode: 'existing', path: '/home/op/Projects/widget' });
    expect(calls[1]!.body).toEqual(
      expect.objectContaining({ mode: 'existing', path: '/home/op/Projects/widget', operationId: expect.any(String) }),
    );
  });

  it('a suggestion with findings shows the message and does not create', async () => {
    const user = userEvent.setup();
    routeFetch({
      findings: [{ field: 'name', code: 'project-exists', message: "Project 'widget' is already registered." }],
    });
    const { onCreated } = renderStart();

    await user.click(await screen.findByRole('button', { name: 'Add widget' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Project 'widget' is already registered.");
    expect(posts().map((call) => call.url)).toEqual(['/api/projects/resolve']);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('no repositories array renders no suggestions heading', async () => {
    routeFetch({ suggestions: { root: '/home/op/Projects' } });
    renderStart();

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/projects/suggestions')).toBe(true),
    );
    expect(screen.queryByText(/Repositories in/)).not.toBeInTheDocument();
  });

  it('suggestion rows join the arrow-key order after the action rows', async () => {
    const user = userEvent.setup();
    routeFetch();
    renderStart();

    const add = await screen.findByRole('button', { name: 'Add widget' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Open a folder/i })).toHaveFocus());
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(add).toHaveFocus();
  });
});
