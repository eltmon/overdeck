/**
 * The Add-project form offers Jira as the issue tracker (PAN-5152 WI-25):
 * choosing it shows the Jira site field and the create request carries
 * tracker: 'jira' and the site.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/wsTransport.js', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/apiFetch.js', () => ({ fetchWithTimeout: fetchMock }));
vi.mock('../../../lib/telemetry.js', () => ({ capture: vi.fn() }));

import { AddProjectDialog } from './AddProjectDialog.js';
import type { ResolvedProjectIntent } from './projectCreateTypes.js';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const intent: ResolvedProjectIntent = {
  mode: 'new',
  key: 'acme',
  name: 'acme',
  path: '/home/op/Projects/acme',
  parentDir: '/home/op/Projects',
  homeDir: '/home/op',
  cloneUrl: null,
  provider: null,
  repoSlug: null,
  defaultBranch: null,
  remoteChecked: false,
  isGitRepository: false,
  gitRoot: null,
  proposedIssuePrefix: 'ACME',
  wouldClone: false,
  wouldGitInit: true,
  willCreateMainWorkspace: true,
  registeredKeyAtPath: null,
  findings: [],
};

function bodiesFor(url: string): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([calledUrl]) => calledUrl === url)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/projects/resolve') return Promise.resolve(json(intent));
    if (url === '/api/projects') return Promise.resolve(json({ key: 'acme', name: 'acme', path: '/home/op/Projects/acme' }));
    return Promise.resolve(json({}));
  });
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => vi.clearAllMocks());

describe('Add-project issue tracker choice (PAN-5152)', () => {
  it('shows the Jira site field and sends tracker: jira with the site', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AddProjectDialog variant="modal" initialMode="new" onCreated={onCreated} onCancel={() => {}} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText('Project name'), 'acme');
    await user.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.queryByLabelText('Jira site URL')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Issue tracker'), 'jira');
    const site = screen.getByLabelText('Jira site URL');
    expect(screen.getByText('The issue prefix is your Jira project key, for example ACME.')).toBeTruthy();
    await user.type(site, 'https://acme.atlassian.net');

    await waitFor(() => expect(bodiesFor('/api/projects/resolve').at(-1)).toMatchObject({
      tracker: 'jira',
      jiraSite: 'https://acme.atlassian.net',
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(bodiesFor('/api/projects')).toHaveLength(1));
    expect(bodiesFor('/api/projects')[0]).toMatchObject({ tracker: 'jira', jiraSite: 'https://acme.atlassian.net' });
  });
});
