/**
 * @vitest-environment jsdom
 */
import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as testingRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/CommandDeck/NewProjectModal.js', () => ({
  NewProjectModal: ({ isOpen, onCreated }: { isOpen: boolean; onCreated: (project: { key: string; name: string; path: string }) => void }) => (
    <div data-testid="new-project-modal-mount" data-open={String(isOpen)}>
      {isOpen && <button onClick={() => onCreated({ key: 'new-project', name: 'New Project', path: '/new' })}>Create mocked project</button>}
    </div>
  ),
}));

vi.mock('../../components/CommandDeck/FolderPicker.js', () => ({
  FolderPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button data-testid="folder-picker" onClick={() => onSelect('/picked/from/browser')}>Pick folder</button>
  ),
}));

vi.mock('../../components/workspace/new/useWorkspaceCreateIntent.js', () => ({
  useWorkspaceCreateIntent: vi.fn(),
}));

vi.mock('../../lib/apiFetch.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { getConversationRouteState, getNewWorkspaceProjectFromSearch } from '../../App/routes.js';
import { useWorkspaceCreateIntent } from '../../components/workspace/new/useWorkspaceCreateIntent.js';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { NewWorkspacePage } from '../NewWorkspacePage.js';

const mockUseWorkspaceCreateIntent = vi.mocked(useWorkspaceCreateIntent);
const mockFetchWithTimeout = vi.mocked(fetchWithTimeout);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function render(ui: ReactElement, queryClient = createQueryClient()) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, ...testingRender(ui, { wrapper: Wrapper }) };
}

function makeResolvedIntent(isGitRepository = true) {
  return {
    projectId: 'project',
    kind: 'user',
    name: 'workspace',
    path: '/repo/workspace',
    branchName: null,
    parentBranch: 'main',
    parentBranchGuessed: true,
    isGitRepository,
    wouldCreateWorktree: false,
    unregisteredTargetPath: false,
    findings: [],
  };
}

function mockProjectData(
  projects: Array<{ key: string; name: string; path: string }>,
  workspaces: Array<{ projectId: string; lastAccessedAt: number }> = [],
) {
  mockFetchWithTimeout.mockImplementation(async (url) => {
    const path = String(url);
    const body = path === '/api/registered-projects'
      ? projects
      : path === '/api/workspace-registry'
        ? { workspaces }
        : path.includes('project-targets')
          ? { primaryPath: '/repo', targets: [] }
          : { workspaces: [{ id: 'main' }] };
    return { ok: true, json: vi.fn(async () => body) } as unknown as Response;
  });
}

function makeIntent(initialProjectKey = ''): ReturnType<typeof useWorkspaceCreateIntent> {
  return {
    name: '',
    setName: vi.fn(),
    projectKey: initialProjectKey,
    setProjectKey: vi.fn(),
    targetPath: '',
    setTargetPath: vi.fn(),
    mode: 'shared',
    setMode: vi.fn(),
    parentBranch: '',
    setParentBranch: vi.fn(),
    effectiveTargetPath: '',
    intent: null,
    stale: true,
    creating: false,
    error: null,
    findingsFor: vi.fn(() => []),
    hasFindings: false,
    canCreate: false,
    submitIntent: vi.fn(async () => null),
  };
}

let currentIntent: ReturnType<typeof useWorkspaceCreateIntent>;
let currentOnCreated: ((workspaceId: string) => void) | undefined;
let intentInitialized: boolean;

beforeEach(() => {
  window.history.replaceState(null, '', '/workspaces/new');
  currentIntent = makeIntent();
  currentOnCreated = undefined;
  intentInitialized = false;
  mockUseWorkspaceCreateIntent.mockImplementation((options = {}) => {
    currentOnCreated = options.onCreated;
    if (!intentInitialized) {
      currentIntent = makeIntent(options.initialProjectKey);
      intentInitialized = true;
    }
    return currentIntent;
  });
  mockFetchWithTimeout.mockImplementation(async (url) => {
    const path = String(url);
    const body = path === '/api/registered-projects'
      ? []
      : path.includes('project-targets')
        ? { primaryPath: '/repo', targets: [{ path: '/repo' }, { path: '/work' }] }
        : { workspaces: [] };
    return { ok: true, json: vi.fn(async () => body) } as unknown as Response;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NewWorkspacePage shell', () => {
  it('renders the seven creation regions in the mockup order', () => {
    render(<NewWorkspacePage />);

    const page = screen.getByTestId('new-workspace-page');
    expect(Array.from(page.querySelectorAll('[data-region]')).map((node) => node.getAttribute('data-region'))).toEqual([
      'project-chip-row',
      'hero-title',
      'target-row',
      'hairline-top',
      'status-strip',
      'hairline-bottom',
      'idea-grid',
    ]);
    expect(screen.getByTestId('new-project-modal-mount')).toHaveAttribute('data-open', 'false');
  });

  it('stays stable while the project queries cold-load', async () => {
    mockFetchWithTimeout.mockImplementation(() => new Promise<Response>(() => {}));

    render(<NewWorkspacePage />);
    await Promise.resolve();

    expect(screen.getByTestId('new-workspace-page')).toBeInTheDocument();
    expect(screen.queryAllByTestId('new-workspace-project-chip')).toHaveLength(0);
  });

  it('renders an autofocused display-scale hero title with the empty-state placeholder', () => {
    render(<NewWorkspacePage />);

    const title = screen.getByTestId('new-workspace-hero-title');
    expect(title).toHaveAttribute('placeholder', 'Untitled workspace');
    expect(title).toHaveAttribute('autocomplete', 'off');
    expect(title).toHaveAttribute('spellcheck', 'false');
    expect(title).toHaveClass('display-xl');
    expect(title).toHaveFocus();
  });

  it('restores the workspace creation route and project preset from a deep link', () => {
    window.history.replaceState(null, '', '/workspaces/new?project=Overdeck%20CLI');

    expect(getConversationRouteState().tab).toBe('workspace-new');
    expect(getNewWorkspaceProjectFromSearch()).toBe('Overdeck CLI');

    render(<NewWorkspacePage />);

    expect(mockUseWorkspaceCreateIntent).toHaveBeenCalledWith({ initialProjectKey: 'Overdeck CLI' });
    expect(screen.getByTestId('new-workspace-project-chip-row')).toHaveAttribute(
      'data-selected-project',
      'Overdeck CLI',
    );
  });

  it('applies a project preset once and keeps a later chip selection', async () => {
    window.history.replaceState(null, '', '/workspaces/new?project=Overdeck%20CLI');
    mockProjectData([
      { key: 'overdeck', name: 'Overdeck CLI', path: '/overdeck' },
      { key: 'other', name: 'Other Project', path: '/other' },
    ]);
    const { rerender } = render(<NewWorkspacePage />);

    await waitFor(() => expect(currentIntent.setProjectKey).toHaveBeenCalledWith('overdeck'));
    vi.mocked(currentIntent.setProjectKey).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Other Project' }));
    currentIntent.projectKey = 'other';
    rerender(<NewWorkspacePage />);

    expect(currentIntent.setProjectKey).toHaveBeenCalledTimes(1);
    expect(currentIntent.setProjectKey).toHaveBeenCalledWith('other');
  });

  it('renders registered targets and mounts FolderPicker from Browse', async () => {
    currentIntent = makeIntent('overdeck');
    intentInitialized = true;
    render(<NewWorkspacePage />);

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      '/api/workspace-registry/project-targets?project=overdeck',
      { credentials: 'include' },
    ));
    await waitFor(() => expect(currentIntent.setTargetPath).toHaveBeenCalledWith('/repo'));

    fireEvent.click(screen.getByTestId('new-workspace-target-chip'));
    expect(screen.getByRole('button', { name: '/repo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '/work' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    fireEvent.click(screen.getByTestId('folder-picker'));

    expect(currentIntent.setTargetPath).toHaveBeenCalledWith('/picked/from/browser');
  });

  it('toggles isolated mode and disables the target picker', () => {
    currentIntent = makeIntent('overdeck');
    intentInitialized = true;
    const { rerender } = render(<NewWorkspacePage />);

    fireEvent.click(screen.getByTestId('new-workspace-mode-isolated'));
    expect(currentIntent.setMode).toHaveBeenCalledWith('isolated');

    currentIntent = { ...currentIntent, mode: 'isolated' };
    rerender(<NewWorkspacePage />);
    expect(screen.getByTestId('new-workspace-target-chip')).toBeDisabled();
  });

  it('reveals the parent branch input and updates the resolve state', () => {
    render(<NewWorkspacePage />);

    fireEvent.click(screen.getByTestId('new-workspace-advanced-toggle'));
    fireEvent.change(screen.getByTestId('new-workspace-parent-branch-input'), { target: { value: 'release' } });

    expect(currentIntent.setParentBranch).toHaveBeenCalledWith('release');
  });

  it('drops the previous target selection when the project changes', async () => {
    currentIntent = { ...makeIntent('project-a'), targetPath: '/project-a' };
    intentInitialized = true;
    const { rerender } = render(<NewWorkspacePage />);
    await waitFor(() => expect(currentIntent.setTargetPath).toHaveBeenCalledWith(''));

    const nextIntent = { ...makeIntent('project-b'), targetPath: '/project-a' };
    currentIntent = nextIntent;
    rerender(<NewWorkspacePage />);

    await waitFor(() => expect(nextIntent.setTargetPath).toHaveBeenCalledWith(''));
  });

  it('offers bootstrap registration when the selected project has no main workspace', async () => {
    currentIntent = makeIntent('overdeck');
    intentInitialized = true;
    render(<NewWorkspacePage />);

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      '/api/workspace-registry?project=overdeck&kind=main&includeArchived=true',
      { credentials: 'include' },
    ));
    expect(await screen.findByTestId('new-workspace-bootstrap-main')).toBeInTheDocument();
  });

  it('submits the bootstrap-main body from the registration action', async () => {
    currentIntent = makeIntent('overdeck');
    intentInitialized = true;
    render(<NewWorkspacePage />);

    fireEvent.click(await screen.findByTestId('new-workspace-bootstrap-main-button'));
    expect(currentIntent.submitIntent).toHaveBeenCalledWith({ project: 'overdeck', bootstrapMain: true });
  });

  it('hides bootstrap registration when an archived or active main workspace exists', async () => {
    mockFetchWithTimeout.mockImplementation(async (url) => ({
      ok: true,
      json: vi.fn(async () => String(url).includes('project-targets')
        ? { primaryPath: '/repo', targets: [] }
        : { workspaces: [{ id: 'main', isArchived: true }] }),
    } as unknown as Response));
    currentIntent = makeIntent('overdeck');
    intentInitialized = true;
    render(<NewWorkspacePage />);

    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      '/api/workspace-registry?project=overdeck&kind=main&includeArchived=true',
      { credentials: 'include' },
    ));
    expect(screen.queryByTestId('new-workspace-bootstrap-main')).not.toBeInTheDocument();
  });

  it('reuses the workspace registry query cache for project recency', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(['workspace-registry'], [
      { projectId: 'b', lastAccessedAt: 20 },
      { projectId: 'a', lastAccessedAt: 30 },
    ]);
    mockProjectData([
      { key: 'a', name: 'Alpha', path: '/a' },
      { key: 'b', name: 'Beta', path: '/b' },
    ]);

    render(<NewWorkspacePage />, queryClient);

    await waitFor(() => expect(screen.getAllByTestId('new-workspace-project-chip')).toHaveLength(2));
    expect(screen.getAllByTestId('new-workspace-project-chip').map((chip) => chip.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(mockFetchWithTimeout.mock.calls.filter(([url]) => String(url) === '/api/workspace-registry')).toEqual([]);
  });

  it('orders project chips by the most recent workspace access', async () => {
    mockProjectData(
      [
        { key: 'a', name: 'Alpha', path: '/a' },
        { key: 'b', name: 'Beta', path: '/b' },
        { key: 'c', name: 'Gamma', path: '/c' },
      ],
      [
        { projectId: 'b', lastAccessedAt: 20 },
        { projectId: 'a', lastAccessedAt: 30 },
        { projectId: 'c', lastAccessedAt: 10 },
      ],
    );
    render(<NewWorkspacePage />);

    await waitFor(() => expect(screen.getAllByTestId('new-workspace-project-chip')).toHaveLength(3));
    expect(screen.getAllByTestId('new-workspace-project-chip').map((chip) => chip.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('preselects the sole registered project when no preset exists', async () => {
    mockProjectData([{ key: 'solo', name: 'Solo', path: '/solo' }]);
    render(<NewWorkspacePage />);

    await waitFor(() => expect(currentIntent.setProjectKey).toHaveBeenCalledWith('solo'));
  });

  it('collapses projects beyond five into a selectable overflow menu', async () => {
    mockProjectData(Array.from({ length: 6 }, (_, index) => ({
      key: `project-${index + 1}`,
      name: `Project ${index + 1}`,
      path: `/project-${index + 1}`,
    })));
    render(<NewWorkspacePage />);

    await waitFor(() => expect(screen.getAllByTestId('new-workspace-project-chip')).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: /more projects/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Project 6' }));
    expect(currentIntent.setProjectKey).toHaveBeenCalledWith('project-6');
  });

  it('opens NewProjectModal and selects the project returned by onCreated', async () => {
    currentIntent.setProjectKey = vi.fn((key) => { currentIntent.projectKey = key; });
    intentInitialized = true;
    const { queryClient } = render(<NewWorkspacePage />);

    fireEvent.click(screen.getByRole('button', { name: /new project/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create mocked project' }));

    expect(currentIntent.setProjectKey).toHaveBeenCalledWith('new-project');
    expect(queryClient.getQueryData(['registered-projects'])).toEqual([
      { key: 'new-project', name: 'New Project', path: '/new' },
    ]);
    expect(await screen.findByRole('button', { name: 'New Project' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders all six static idea cards with uppercase mono categories', () => {
    render(<NewWorkspacePage />);

    expect(screen.getAllByTestId('new-workspace-idea-card')).toHaveLength(6);
    for (const category of ['AUTOMATE', 'DELEGATE', 'EXPLORE', 'BUILD', 'PLAN', 'DESIGN']) {
      expect(screen.getByText(category)).toHaveClass('eyebrow', 'font-mono');
    }
    expect(screen.getByText('Nightly dependency-audit sweep across all registered projects')).toBeInTheDocument();
  });

  it('prefills and focuses the hero when an idea is selected without extra network activity', async () => {
    render(<NewWorkspacePage />);
    await waitFor(() => expect(mockFetchWithTimeout).toHaveBeenCalled());
    mockFetchWithTimeout.mockClear();

    fireEvent.click(screen.getByText('Map how the merge train decides dispatch order'));

    expect(currentIntent.setName).toHaveBeenCalledWith('Map how the merge train decides dispatch order');
    expect(screen.getByTestId('new-workspace-hero-title')).toHaveFocus();
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('renders the resolved shared-mode status line and parent override', () => {
    currentIntent = {
      ...makeIntent(),
      parentBranch: 'release',
      intent: makeResolvedIntent(true),
      stale: false,
    };
    intentInitialized = true;
    render(<NewWorkspacePage />);

    expect(screen.getByTestId('new-workspace-status-strip')).toHaveTextContent(
      /Memory enabled\s*·\s*Files shared\s*·\s*git repository.*parent release/,
    );
    expect(screen.getByTestId('new-workspace-status-parent')).not.toHaveTextContent('inferred');
  });

  it('renders the resolver-inferred parent branch when no override is entered', () => {
    currentIntent = {
      ...makeIntent(),
      intent: makeResolvedIntent(true),
      stale: false,
    };
    intentInitialized = true;
    render(<NewWorkspacePage />);

    expect(screen.getByTestId('new-workspace-status-parent')).toHaveTextContent('parent main (inferred)');
  });

  it('renders resolved path, branch, worktree, and unregistered-target posture in place', () => {
    currentIntent = {
      ...makeIntent(),
      intent: {
        ...makeResolvedIntent(),
        path: '/repo/workspace',
        branchName: 'workspace/feature',
        wouldCreateWorktree: true,
        unregisteredTargetPath: true,
      },
      stale: false,
    };
    intentInitialized = true;
    render(<NewWorkspacePage />);

    expect(screen.getByTestId('new-workspace-status-strip')).toHaveTextContent('/repo/workspace');
    expect(screen.getByTestId('new-workspace-status-strip')).toHaveTextContent('creates workspace/feature');
    expect(screen.getByTestId('new-workspace-status-strip')).toHaveTextContent('worktree');
    expect(screen.getByText('unregistered target')).toHaveClass('text-destructive-foreground');
  });

  it('renders isolated mode and non-git posture', () => {
    currentIntent = {
      ...makeIntent(),
      mode: 'isolated',
      intent: makeResolvedIntent(false),
      stale: false,
    };
    intentInitialized = true;
    render(<NewWorkspacePage />);

    expect(screen.getByTestId('new-workspace-status-strip')).toHaveTextContent(
      /Memory enabled\s*·\s*Isolated worktree\s*·\s*no git detected/,
    );
  });

  it('renders resolver findings in the status strip without a separate error panel', () => {
    const finding = { field: 'targetPath' as const, code: 'outside-project', message: 'Choose a registered target' };
    currentIntent = {
      ...makeIntent(),
      intent: { ...makeResolvedIntent(), findings: [finding] },
      findingsFor: vi.fn((field) => field === 'targetPath' ? [finding] : []),
      hasFindings: true,
      stale: false,
    };
    intentInitialized = true;
    render(<NewWorkspacePage />);

    expect(screen.getByTestId('new-workspace-status-finding')).toHaveTextContent('Choose a registered target');
    expect(screen.queryByTestId('new-workspace-error-panel')).not.toBeInTheDocument();
  });

  it('uses app navigation when Cancel is opened from a direct route', () => {
    const onCancel = vi.fn();
    window.history.replaceState(null, '', '/workspaces/new');
    render(<NewWorkspacePage onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId('new-workspace-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables Start workspace while the intent is stale or invalid', () => {
    render(<NewWorkspacePage />);
    expect(screen.getByTestId('new-workspace-submit')).toBeDisabled();
  });

  it('submits exactly once when Enter is pressed in the hero field', async () => {
    currentIntent = {
      ...makeIntent(),
      intent: makeResolvedIntent(),
      stale: false,
      canCreate: true,
    };
    intentInitialized = true;
    render(<NewWorkspacePage />);

    await userEvent.type(screen.getByTestId('new-workspace-hero-title'), '{Enter}');
    expect(currentIntent.submitIntent).toHaveBeenCalledTimes(1);
  });

  it('threads successful creation to the app-level workspace callback', () => {
    const onCreated = vi.fn();
    render(<NewWorkspacePage onCreated={onCreated} />);

    currentOnCreated?.('workspace/id');
    expect(onCreated).toHaveBeenCalledWith('workspace/id');
  });
});
