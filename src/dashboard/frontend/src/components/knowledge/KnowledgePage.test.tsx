import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAB_PATHS } from '../../App/routes';
import { KnowledgePage, knowledgeViewerPostureCopy } from './KnowledgePage';

function renderPage(projectKey = 'overdeck') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KnowledgePage projectKey={projectKey} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('KnowledgePage', () => {
  it('registers /knowledge without changing existing tab paths', () => {
    const { knowledge, ...legacyPaths } = TAB_PATHS;
    expect(knowledge).toBe('/knowledge');
    expect(legacyPaths).toEqual({
      home: '/',
      pipeline: '/pipeline',
      kanban: '/board',
      'command-deck': '/command-deck',
      agents: '/agents',
      flywheel: '/flywheel',
      backlog: '/backlog',
      resources: '/resources',
      autopreso: '/autopreso',
      activity: '/activity',
      metrics: '/metrics',
      costs: '/costs',
      skills: '/skills',
      context: '/context',
      health: '/health',
      settings: '/settings',
      'god-view': '/god-view',
      deacon: '/deacon',
      sessions: '/sessions',
      'awaiting-merge': '/awaiting-merge',
    });
  });

  it('renders /okf init guidance when no bundle is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      projectKey: 'overdeck',
      bundleConfigured: false,
      installed: false,
      starting: false,
      running: false,
    })));

    renderPage();

    expect(await screen.findByText('No knowledge bundle configured')).toBeInTheDocument();
    expect(screen.getByText('/okf init')).toBeInTheDocument();
  });

  it('renders an install action and shows progress while the explicit install is pending', async () => {
    let resolveInstall!: (value: Response) => void;
    const installResponse = new Promise<Response>((resolve) => { resolveInstall = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/install')) return installResponse;
      return Promise.resolve(jsonResponse({
        projectKey: 'overdeck',
        bundleConfigured: true,
        installed: false,
        starting: false,
        running: false,
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Install viewer' }));

    expect(await screen.findByRole('button', { name: 'Installing viewer' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-viewer/install', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ project: 'overdeck' }),
    }));
    resolveInstall(jsonResponse({ installed: true }));
  });

  it('renders the machine-active starting state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      projectKey: 'overdeck',
      bundleConfigured: true,
      installed: true,
      starting: true,
      running: false,
    })));

    renderPage();

    expect(await screen.findByText('Starting knowledge viewer')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('starts an installed idle viewer and transitions to ready', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/start')) {
        return Promise.resolve(jsonResponse({
          projectKey: 'overdeck',
          bundleConfigured: true,
          installed: true,
          starting: false,
          running: true,
          url: 'http://127.0.0.1:39847',
        }));
      }
      return Promise.resolve(jsonResponse({
        projectKey: 'overdeck',
        bundleConfigured: true,
        installed: true,
        starting: false,
        running: false,
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();

    expect(await screen.findByText('Viewer ready')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-viewer/start', expect.objectContaining({
      method: 'POST',
    })));
  });

  it('uses the recorded lossy-spike posture copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      projectKey: 'overdeck',
      bundleConfigured: false,
      installed: false,
      starting: false,
      running: false,
    })));

    renderPage();

    expect(await screen.findByText(knowledgeViewerPostureCopy(false))).toHaveTextContent(
      'View and search here; edit knowledge through /okf author',
    );
    expect(knowledgeViewerPostureCopy(true)).toContain('Browse, search, and edit');
  });
});
