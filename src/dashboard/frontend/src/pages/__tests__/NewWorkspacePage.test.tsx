/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/CommandDeck/NewProjectModal.js', () => ({
  NewProjectModal: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="new-project-modal-mount" data-open={String(isOpen)} />
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
let intentInitialized: boolean;

beforeEach(() => {
  window.history.replaceState(null, '', '/workspaces/new');
  currentIntent = makeIntent();
  intentInitialized = false;
  mockUseWorkspaceCreateIntent.mockImplementation((options = {}) => {
    if (!intentInitialized) {
      currentIntent = makeIntent(options.initialProjectKey);
      intentInitialized = true;
    }
    return currentIntent;
  });
  mockFetchWithTimeout.mockImplementation(async (url) => ({
    ok: true,
    json: vi.fn(async () => String(url).includes('project-targets')
      ? { primaryPath: '/repo', targets: [{ path: '/repo' }, { path: '/work' }] }
      : { workspaces: [] }),
  } as unknown as Response));
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
      /Memory enabled\s*·\s*Files shared\s*·\s*git repository\s*·\s*parent release/,
    );
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
});
