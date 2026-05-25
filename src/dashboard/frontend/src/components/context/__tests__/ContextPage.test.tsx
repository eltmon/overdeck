import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { ContextLayerSaveRequest, ContextLayersResponse, ContextPreviewRequest } from '@panctl/contracts';

import { ContextPage } from '../ContextPage';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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

const initialLayersResponse: ContextLayersResponse = {
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

let layersResponse: ContextLayersResponse;
let syncCount = 0;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function fetchPaths(method?: string) {
  return fetchMock.mock.calls
    .filter(([, init]) => !method || init?.method === method)
    .map(([input]) => String(input));
}

function installFetchHandler() {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    if (path === '/api/context/layers' && method === 'GET') {
      return jsonResponse(layersResponse);
    }
    if (path === '/api/context/preview' && method === 'POST') {
      const request = JSON.parse(init?.body as string) as ContextPreviewRequest;
      const content = request.drafts.at(-1)?.content ?? layersResponse.layers[0]?.content ?? '';
      return jsonResponse({
        operation: 'preview',
        previews: {
          'claude-code': content.includes('claude-only') ? 'shared claude-only' : `Claude preview: ${content}`,
          pi: content.includes('pi-only') ? 'shared pi-only' : `Pi preview: ${content}`,
          fullPrompt: `Full injected prompt\n\n${content}\n\nMemory/status/briefing placeholders`,
        },
        diagnostics: content.includes('broken-harness')
          ? [{ level: 'error', message: 'Malformed harness block', layer: request.selectedLayer }]
          : [],
      });
    }
    if (path === '/api/context/layers' && method === 'PUT') {
      const request = JSON.parse(init?.body as string) as ContextLayerSaveRequest;
      if (request.content === 'fail-save') {
        return jsonResponse({ error: 'Save failed' }, { status: 500 });
      }
      layersResponse = {
        ...layersResponse,
        layers: layersResponse.layers.map((layer) => {
          if (request.target.kind === 'global' && layer.kind === 'global') return { ...layer, content: request.content, exists: true };
          if (request.target.kind === 'project' && layer.kind === 'project' && layer.projectKey === request.target.projectKey) return { ...layer, content: request.content, exists: true };
          if (request.target.kind === 'workspace' && layer.kind === 'workspace' && layer.workspacePath === request.target.workspacePath) return { ...layer, content: request.content, exists: true };
          return layer;
        }),
      };
      return jsonResponse({ operation: 'save', layer: layersResponse.layers[0], savedAt: '2026-05-25T00:00:00.000Z' });
    }
    if (path === '/api/context/sync' && method === 'POST') {
      syncCount += 1;
      return jsonResponse({ operation: 'sync', success: true, stdout: 'synced', stderr: '', syncedAt: '2026-05-25T00:00:00.000Z' });
    }
    return jsonResponse({ error: `Unexpected ${method} ${path}` }, { status: 404 });
  });
}

beforeEach(() => {
  syncCount = 0;
  layersResponse = structuredClone(initialLayersResponse);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  installFetchHandler();
});

afterEach(() => {
  vi.useRealTimers();
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

  it('updates harness-specific previews after the debounce without saving', async () => {
    renderWithQuery(<ContextPage />);
    const editor = await screen.findByLabelText('Context markdown editor');
    vi.useFakeTimers();

    fireEvent.change(editor, {
      target: { value: 'shared {{#harness:claude}}claude-only{{/harness:claude}}{{#harness:pi}}pi-only{{/harness:pi}}' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    vi.useRealTimers();

    await waitFor(() => expect(screen.getByText(/shared claude-only/)).toBeTruthy());
    fireEvent.click(screen.getByText('Pi output'));
    expect(screen.getByText(/shared pi-only/)).toBeTruthy();
    fireEvent.click(screen.getByText('Full injected prompt'));
    expect(screen.getByText(/Memory\/status\/briefing placeholders/)).toBeTruthy();
    expect(fetchPaths('PUT')).toEqual([]);
    expect(fetchPaths('POST').filter((path) => path === '/api/context/sync')).toEqual([]);
  });

  it('shows validation diagnostics returned by preview', async () => {
    renderWithQuery(<ContextPage />);
    const editor = await screen.findByLabelText('Context markdown editor');
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: 'broken-harness' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    vi.useRealTimers();

    expect(await screen.findByText(/Malformed harness block/)).toBeTruthy();
  });

  it('saves dirty content through PUT without syncing', async () => {
    renderWithQuery(<ContextPage />);
    const editor = await screen.findByLabelText('Context markdown editor');

    fireEvent.change(editor, { target: { value: 'updated global context' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(fetchPaths('PUT')).toEqual(['/api/context/layers']));
    expect(syncCount).toBe(0);
  });

  it('saves before syncing exactly once', async () => {
    renderWithQuery(<ContextPage />);
    const editor = await screen.findByLabelText('Context markdown editor');

    fireEvent.change(editor, { target: { value: 'updated global context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Sync' }));

    await waitFor(() => expect(syncCount).toBe(1));
    const writePaths = fetchMock.mock.calls
      .filter(([input, init]) => init?.method === 'PUT' || String(input) === '/api/context/sync')
      .map(([input]) => String(input));
    expect(writePaths).toEqual(['/api/context/layers', '/api/context/sync']);
  });

  it('keeps unsaved content visible when save fails', async () => {
    renderWithQuery(<ContextPage />);
    const editor = await screen.findByLabelText('Context markdown editor');

    fireEvent.change(editor, { target: { value: 'fail-save' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText('Save failed')).toBeTruthy();
    expect(screen.getByDisplayValue('fail-save')).toBeTruthy();
  });
});
