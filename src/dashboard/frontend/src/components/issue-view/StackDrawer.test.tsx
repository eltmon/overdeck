import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useWorkspaceQueryMock = vi.fn();
const useIssueActionsMock = vi.fn();

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useWorkspaceQuery: (...args: unknown[]) => useWorkspaceQueryMock(...args),
}));
vi.mock('../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: (...args: unknown[]) => useIssueActionsMock(...args),
}));

import { StackDrawer } from './StackDrawer';

const WORKSPACE = {
  exists: true,
  containers: {
    frontend: { running: true, health: 'healthy', status: 'Up 2 minutes' },
  },
  stackHealth: { healthy: true },
  git: { branch: 'feature/pan-5253', ahead: 2, behind: 0, dirty: false },
  services: [],
};

describe('StackDrawer', () => {
  it('renders nothing without a workspace', () => {
    useWorkspaceQueryMock.mockReturnValue({ data: { exists: false } });
    useIssueActionsMock.mockReturnValue({ all: [] });

    const { container } = render(<StackDrawer issueId="PAN-1" branch="feature/pan-5253" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('summarises container health and opens the stack details', () => {
    useWorkspaceQueryMock.mockReturnValue({ data: WORKSPACE });
    useIssueActionsMock.mockReturnValue({ all: [] });

    render(<StackDrawer issueId="PAN-1" branch="feature/pan-5253" />);
    fireEvent.click(screen.getByRole('button', { name: /Stack/ }));

    expect(screen.getByText(/Containers/)).toBeInTheDocument();
    expect(screen.getByText('Git')).toBeInTheDocument();
    expect(screen.getByText('feature/pan-5253')).toBeInTheDocument();
  });

  it("the root has data-section='StackDrawer'", () => {
    useWorkspaceQueryMock.mockReturnValue({ data: WORKSPACE });
    useIssueActionsMock.mockReturnValue({ all: [] });

    render(<StackDrawer issueId="PAN-1" branch="feature/pan-5253" />);

    expect(document.querySelector('[data-section="StackDrawer"]')).toBeInTheDocument();
  });

  it('offers the enabled stack actions and invokes one', () => {
    useWorkspaceQueryMock.mockReturnValue({ data: WORKSPACE });
    const invoke = vi.fn();
    useIssueActionsMock.mockReturnValue({
      all: [
        { action: { key: 'syncMain', label: 'Sync main' }, enabled: true, isPending: false, invoke },
      ],
    });

    render(<StackDrawer issueId="PAN-1" branch="feature/pan-5253" />);
    fireEvent.click(screen.getByRole('button', { name: /Stack/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync main' }));

    expect(invoke).toHaveBeenCalledOnce();
  });
});
