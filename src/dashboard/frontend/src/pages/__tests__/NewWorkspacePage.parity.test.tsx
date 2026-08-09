/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/CommandDeck/NewProjectModal.js', () => ({
  NewProjectModal: ({ isOpen, onCreated }: {
    isOpen: boolean;
    onCreated: (project: { key: string; name: string; path: string }) => void;
  }) => isOpen ? (
    <button onClick={() => onCreated({ key: 'new-project', name: 'New Project', path: '/new' })}>
      Create audited project
    </button>
  ) : null,
}));

vi.mock('../../components/CommandDeck/FolderPicker.js', () => ({
  FolderPicker: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button onClick={() => onSelect('/picked')}>Choose audited folder</button>
  ),
}));

vi.mock('../../components/workspace/new/useWorkspaceCreateIntent.js', () => ({
  useWorkspaceCreateIntent: vi.fn(),
}));

vi.mock('../../lib/apiFetch.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { useWorkspaceCreateIntent } from '../../components/workspace/new/useWorkspaceCreateIntent.js';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { NewWorkspacePage } from '../NewWorkspacePage.js';

const mockUseWorkspaceCreateIntent = vi.mocked(useWorkspaceCreateIntent);
const mockFetchWithTimeout = vi.mocked(fetchWithTimeout);
const setName = vi.fn();
const setProjectKey = vi.fn();
const setTargetPath = vi.fn();
const setMode = vi.fn();
const setParentBranch = vi.fn();
const submitIntent = vi.fn(async () => 'workspace-id');
let onIntentCreated: ((workspaceId: string) => void) | undefined;

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/workspaces/new');
  onIntentCreated = undefined;
  mockUseWorkspaceCreateIntent.mockImplementation((options = {}) => {
    onIntentCreated = options.onCreated;
    return {
      name: 'Audit workspace',
      setName,
      projectKey: 'overdeck',
      setProjectKey,
      targetPath: '/repo',
      setTargetPath,
      mode: 'shared',
      setMode,
      parentBranch: '',
      setParentBranch,
      effectiveTargetPath: '/repo',
      intent: {
        projectId: 'overdeck',
        kind: 'user',
        name: 'audit-workspace',
        path: '/repo/audit-workspace',
        branchName: 'scratch/audit-workspace',
        parentBranch: 'main',
        parentBranchGuessed: true,
        isGitRepository: true,
        wouldCreateWorktree: false,
        unregisteredTargetPath: false,
        findings: [],
      },
      stale: false,
      creating: false,
      error: null,
      findingsFor: vi.fn(() => []),
      hasFindings: false,
      canCreate: true,
      submitIntent,
    };
  });
  mockFetchWithTimeout.mockImplementation(async (url) => {
    const path = String(url);
    const body = path === '/api/registered-projects'
      ? [{ key: 'overdeck', name: 'Overdeck', path: '/repo' }]
      : path === '/api/workspace-registry'
        ? { workspaces: [] }
        : path.includes('project-targets')
          ? { primaryPath: '/repo', targets: [{ path: '/target' }] }
          : { workspaces: [] };
    return { ok: true, json: vi.fn(async () => body) } as unknown as Response;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('New Workspace modal-to-page no-loss audit', () => {
  it('renders and operates every creation control from the removed modal', async () => {
    const onCreated = vi.fn();
    render(<NewWorkspacePage onCreated={onCreated} />, { wrapper: Wrapper });

    expect(await screen.findByRole('button', { name: 'Overdeck' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add existing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Audit workspace');
    expect(screen.getByTestId('new-workspace-target-chip')).toHaveTextContent('/repo');
    expect(screen.getByTestId('new-workspace-mode-shared')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('new-workspace-mode-isolated')).toBeInTheDocument();
    expect(screen.getByTestId('new-workspace-advanced-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('new-workspace-status-strip')).toHaveTextContent(
      /git repository.*scratch\/audit-workspace.*parent main \(inferred\)/,
    );
    expect(screen.getByTestId('new-workspace-submit')).toBeEnabled();
    expect(screen.getByTestId('new-workspace-cancel')).toBeInTheDocument();
    expect(screen.getAllByTestId('new-workspace-idea-card')).toHaveLength(6);

    fireEvent.click(screen.getByTestId('new-workspace-target-chip'));
    expect(screen.getByRole('button', { name: '/target' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose audited folder' }));
    expect(setTargetPath).toHaveBeenCalledWith('/picked');

    fireEvent.click(screen.getByTestId('new-workspace-mode-isolated'));
    expect(setMode).toHaveBeenCalledWith('isolated');
    fireEvent.click(screen.getByTestId('new-workspace-advanced-toggle'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Parent branch' }), {
      target: { value: 'release' },
    });
    expect(setParentBranch).toHaveBeenCalledWith('release');

    fireEvent.click(await screen.findByTestId('new-workspace-bootstrap-main-button'));
    expect(submitIntent).toHaveBeenCalledWith({ project: 'overdeck', bootstrapMain: true });
    fireEvent.click(screen.getByTestId('new-workspace-submit'));
    expect(submitIntent).toHaveBeenCalledWith();

    onIntentCreated?.('created-id');
    expect(onCreated).toHaveBeenCalledWith('created-id');
  });

  it('keeps creation blocked when the resolver state is stale', () => {
    mockUseWorkspaceCreateIntent.mockImplementation((options = {}) => ({
      name: '',
      setName,
      projectKey: options.initialProjectKey ?? '',
      setProjectKey,
      targetPath: '',
      setTargetPath,
      mode: 'shared',
      setMode,
      parentBranch: '',
      setParentBranch,
      effectiveTargetPath: '',
      intent: null,
      stale: true,
      creating: false,
      error: null,
      findingsFor: vi.fn(() => []),
      hasFindings: false,
      canCreate: false,
      submitIntent,
    }));

    render(<NewWorkspacePage />, { wrapper: Wrapper });

    expect(screen.getByTestId('new-workspace-submit')).toBeDisabled();
  });
});
