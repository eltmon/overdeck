/** PAN-4651 WI-18 (D-4651-14): the Add this project dialog preselects .env-style files. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

import { AddProjectToMachineDialog } from '../AddProjectToMachineDialog';

const SOURCE = {
  key: 'od', name: 'Overdeck', issuePrefix: 'PAN', gitOrigin: 'github.com/eltmon/overdeck', cloneUrl: 'https://github.com/eltmon/overdeck.git',
  ignoredFiles: [{ path: '.env', bytes: 10, preselected: true }, { path: 'apps/web/.dev.vars', bytes: 8, preselected: true }, { path: 'notes.local', bytes: 4, preselected: false }],
};

let posts: unknown[];

beforeEach(() => {
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/fleet/projects/source') || url.startsWith('/api/fleet/projects/local-source')) return { ok: true, status: 200, json: async () => SOURCE };
    if (url === '/api/registered-projects') return { ok: true, status: 200, json: async () => [{ key: 'overdeck', name: 'Overdeck', path: '/p' }] };
    if (url === '/api/fleet/projects/add-there' && init?.method === 'POST') {
      posts.push({ there: JSON.parse(String(init.body)) });
      return { ok: true, status: 202, json: async () => ({ jobId: 'add-2', machine: 'env-desk' }) };
    }
    if (url === '/api/fleet/projects/add-jobs/add-2?machine=env-desk') return { ok: true, status: 200, json: async () => ({ step: 'done', projectKey: 'overdeck', files: [] }) };
    if (url === '/api/fleet/projects/add-here' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return { ok: true, status: 202, json: async () => ({ jobId: 'add-1' }) };
    }
    if (url === '/api/fleet/projects/add-jobs/add-1') return { ok: true, status: 200, json: async () => ({ step: 'done', projectKey: 'overdeck', files: [{ path: '.env', result: 'written' }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});

afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddProjectToMachineDialog target={{ machine: 'env-desk', machineLabel: 'desk', projectKey: 'od', projectName: 'Overdeck', thisLabel: 'laptop' }} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('AddProjectToMachineDialog (PAN-4651 WI-18)', () => {
  it('ac18: preselects .env-style files and lists other files unchecked', async () => {
    renderDialog();
    await waitFor(() => expect((screen.getByLabelText('.env') as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText('apps/web/.dev.vars') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('notes.local') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('heading', { name: 'Add Overdeck to laptop' })).toBeTruthy();
  });

  it('posts the checked files and follows the job to done', async () => {
    renderDialog();
    await waitFor(() => expect((screen.getByLabelText('.env') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByLabelText('apps/web/.dev.vars'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to laptop' }));
    await waitFor(() => expect(posts).toEqual([{ machine: 'env-desk', projectKey: 'od', files: ['.env'] }]));
    await waitFor(() => expect(screen.getByTestId('add-project-step')).toHaveTextContent('Done'));
  });

  it('there: chooses a local project and posts it to the linked machine, following the job there', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AddProjectToMachineDialog target={{ direction: 'there', machine: 'env-desk', machineLabel: 'desk', thisLabel: 'laptop' }} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Add a project to desk' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Overdeck' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'overdeck' } });
    await waitFor(() => expect((screen.getByLabelText('.env') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Add to desk' }));
    await waitFor(() => expect(posts).toEqual([{ there: { machine: 'env-desk', projectKey: 'overdeck', files: ['.env', 'apps/web/.dev.vars'] } }]));
    await waitFor(() => expect(screen.getByTestId('add-project-step')).toHaveTextContent('Done'));
  });
});
