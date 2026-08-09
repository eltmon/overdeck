/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../components/CommandDeck/NewProjectModal.js', () => ({
  NewProjectModal: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="new-project-modal-mount" data-open={String(isOpen)} />
  ),
}));

vi.mock('../../components/workspace/new/useWorkspaceCreateIntent.js', () => ({
  useWorkspaceCreateIntent: vi.fn(),
}));

import { getConversationRouteState, getNewWorkspaceProjectFromSearch } from '../../App/routes.js';
import { useWorkspaceCreateIntent } from '../../components/workspace/new/useWorkspaceCreateIntent.js';
import { NewWorkspacePage } from '../NewWorkspacePage.js';

const mockUseWorkspaceCreateIntent = vi.mocked(useWorkspaceCreateIntent);

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

beforeEach(() => {
  window.history.replaceState(null, '', '/workspaces/new');
  mockUseWorkspaceCreateIntent.mockImplementation((options = {}) => makeIntent(options.initialProjectKey));
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
});
