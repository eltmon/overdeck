import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ContextLayersResponse } from '@panctl/contracts';

import { ContextPage } from '../ContextPage';

vi.mock('../ContextEditor', () => ({
  ContextEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Context markdown editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

const layersResponse: ContextLayersResponse = {
  operation: 'load',
  projects: [
    {
      projectKey: 'panopticon-cli',
      name: 'Panopticon CLI',
      path: '/repo/panopticon-cli',
      workspaceRoot: '/repo/panopticon-cli/workspaces',
    },
  ],
  workspaces: [
    {
      projectKey: 'panopticon-cli',
      name: 'feature-pan-1201-slot-3',
      path: '/repo/panopticon-cli/workspaces/feature-pan-1201-slot-3',
      issueId: 'PAN-1201',
    },
  ],
  layers: [
    {
      kind: 'global',
      file: '/home/user/.panopticon/context/global.md',
      exists: true,
      content: 'global context',
      editable: true,
    },
    {
      kind: 'project',
      projectKey: 'panopticon-cli',
      file: '/repo/panopticon-cli/.pan/context/project.md',
      exists: true,
      content: 'project context',
      editable: true,
    },
    {
      kind: 'workspace',
      projectKey: 'panopticon-cli',
      workspacePath: '/repo/panopticon-cli/workspaces/feature-pan-1201-slot-3',
      file: '/repo/panopticon-cli/workspaces/feature-pan-1201-slot-3/.pan/context/workspace.md',
      exists: false,
      content: 'workspace context',
      editable: true,
    },
  ],
};

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify(layersResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContextPage', () => {
  it('loads the global layer into the editor by default', async () => {
    renderWithQuery(<ContextPage />);

    expect(await screen.findByDisplayValue('global context')).toBeTruthy();
    expect(screen.getByText('~/.panopticon/context/global.md')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/context/layers', expect.objectContaining({ method: 'GET' }));
  });

  it('switches to the selected project layer and labels the project context path', async () => {
    renderWithQuery(<ContextPage />);
    await screen.findByDisplayValue('global context');

    fireEvent.click(screen.getByLabelText('Project context'));

    expect(await screen.findByDisplayValue('project context')).toBeTruthy();
    expect(screen.getByText('.pan/context/project.md')).toBeTruthy();
  });

  it('switches to the selected workspace layer and explains workspace context creation', async () => {
    renderWithQuery(<ContextPage />);
    await screen.findByDisplayValue('global context');

    fireEvent.click(screen.getByLabelText('Workspace context'));

    expect(await screen.findByDisplayValue('workspace context')).toBeTruthy();
    expect(screen.getByText('.pan/context/workspace.md')).toBeTruthy();
    expect(screen.getByText(/may not exist until a workspace is created/i)).toBeTruthy();
    expect(screen.getByText('File has not been created yet')).toBeTruthy();
  });

  it('edits layer content through the editor wrapper', async () => {
    renderWithQuery(<ContextPage />);
    const editor = await screen.findByLabelText('Context markdown editor');

    fireEvent.change(editor, { target: { value: 'updated global context' } });

    await waitFor(() => expect(screen.getByDisplayValue('updated global context')).toBeTruthy());
    expect(screen.getByText('Edited')).toBeTruthy();
  });
});
