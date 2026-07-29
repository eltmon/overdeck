import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAB_PATHS } from '../../App/routes';
import { KnowledgePage, knowledgeViewerPostureCopy, type KnowledgeViewerStatus } from './KnowledgePage';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'test-csrf-token',
  })),
}));

function renderPage(projectKey = 'overdeck') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <KnowledgePage projectKey={projectKey} />
      </QueryClientProvider>,
    ),
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function runningStatus(overrides: Partial<KnowledgeViewerStatus> = {}): KnowledgeViewerStatus {
  return {
    projectKey: 'overdeck',
    bundleConfigured: true,
    installed: true,
    starting: false,
    running: true,
    url: 'http://127.0.0.1:39847',
    proxyUrl: 'about:blank#knowledge-viewer',
    embeddable: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
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
      orders: '/orders',
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
      workspace: '/workspace',
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

  it('renders the setup plan and sends an authenticated install mutation', async () => {
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
        message: 'open-knowledge requires Node 24+',
        setupPlan: {
          kind: 'install-node-via-manager',
          steps: [
            'Install Node 24 with Volta without changing your default Node.',
            'Pin only the OpenKnowledge viewer to that runtime.',
          ],
        },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    expect(await screen.findByText('open-knowledge requires Node 24+')).toBeInTheDocument();
    expect(screen.getByText('Install Node 24 with Volta without changing your default Node.')).toBeInTheDocument();
    expect(screen.getByText('Pin only the OpenKnowledge viewer to that runtime.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up the viewer' }));

    expect(await screen.findByRole('button', { name: 'Setting up the viewer' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-viewer/install', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-overdeck-csrf-token': 'test-csrf-token',
      },
      body: JSON.stringify({ project: 'overdeck' }),
    }));
    resolveInstall(jsonResponse({ installed: true }));
  });

  it('renders an install failure in the existing error region', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/install')) {
        return Promise.resolve(jsonResponse({ error: 'volta fetch failed with code 7' }, false));
      }
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
    fireEvent.click(await screen.findByRole('button', { name: 'Set up the viewer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('volta fetch failed with code 7');
  });

  it('keeps the current not-installed copy without an empty setup-plan list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      projectKey: 'overdeck',
      bundleConfigured: true,
      installed: false,
      starting: false,
      running: false,
    })));

    renderPage();

    expect(await screen.findByText('Install the local knowledge viewer')).toBeInTheDocument();
    expect(screen.getByText(/OpenKnowledge is installed only after this explicit request/)).toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-setup-plan')).not.toBeInTheDocument();
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

  it('starts an installed idle viewer and embeds the origin-isolated snapshot', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/start')) return Promise.resolve(jsonResponse(runningStatus()));
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

    const iframe = await screen.findByTitle('OpenKnowledge viewer');
    fireEvent.load(iframe);
    expect(iframe).toHaveAttribute('src', 'about:blank#knowledge-viewer');
    expect(iframe).toHaveAttribute('sandbox');
    expect(screen.getByText(/Read-only snapshot/)).toBeInTheDocument();
    expect(screen.queryByText('Loading knowledge workspace')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-viewer/start', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    })));
  });

  it('uses the direct read-only snapshot fallback when framing is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(runningStatus({ embeddable: false }))));

    renderPage();

    expect(await screen.findByTestId('knowledge-viewer-blocked')).toBeInTheDocument();
    expect(screen.getByText(/disposable read-only snapshot/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open viewer' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:39847',
    );
    expect(screen.queryByTitle('OpenKnowledge viewer')).not.toBeInTheDocument();
  });

  it('automatically restarts after a previously running viewer crashes', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/start')) return Promise.resolve(jsonResponse(runningStatus()));
      return Promise.resolve(jsonResponse(runningStatus()));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient } = renderPage();
    const iframe = await screen.findByTitle('OpenKnowledge viewer');
    fireEvent.load(iframe);

    await act(async () => {
      queryClient.setQueryData(['knowledge-viewer-status', 'overdeck'], runningStatus({
        running: false,
        proxyUrl: undefined,
        embeddable: undefined,
      }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-viewer/start', expect.objectContaining({
      method: 'POST',
    })));
    expect(await screen.findByTitle('OpenKnowledge viewer')).toBeInTheDocument();
  });

  it('renders a retry action when restart fails', async () => {
    let starts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/start')) {
        starts += 1;
        return Promise.resolve(jsonResponse({ error: 'viewer exited' }, false));
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
    const retry = await screen.findByRole('button', { name: 'Retry viewer' });
    expect(screen.getByText('viewer exited')).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(starts).toBe(2));
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
