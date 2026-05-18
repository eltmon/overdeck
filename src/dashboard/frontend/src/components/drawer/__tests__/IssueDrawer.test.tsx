import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IssueDrawer } from '../IssueDrawer';
import { useDashboardStore } from '../../../lib/store';

vi.mock('../../../lib/store', () => ({
  useDashboardStore: vi.fn(),
}));

function mockStore(state: Partial<ReturnType<typeof useDashboardStore.getState>>) {
  (useDashboardStore as unknown as vi.Mock).mockImplementation((selector: any) =>
    selector({
      drawerIssueId: null,
      drawerTab: 'overview',
      closeDrawerIssue: vi.fn(),
      ...state,
    }),
  );
}

describe('IssueDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders nothing when drawer is closed', () => {
    mockStore({ drawerIssueId: null });
    render(<IssueDrawer />);
    expect(screen.queryByTestId('issue-drawer')).not.toBeInTheDocument();
  });

  it('renders drawer panel when an issue is open', () => {
    mockStore({ drawerIssueId: 'PAN-42' });
    render(<IssueDrawer />);
    expect(screen.getByTestId('issue-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('issue-drawer-panel')).toBeInTheDocument();
    expect(screen.getByText('PAN-42')).toBeInTheDocument();
  });

  it('closes on scrim click', () => {
    const closeDrawer = vi.fn();
    mockStore({ drawerIssueId: 'PAN-42', closeDrawerIssue: closeDrawer });
    render(<IssueDrawer />);
    fireEvent.click(screen.getByTestId('issue-drawer-scrim'));
    expect(closeDrawer).toHaveBeenCalled();
  });

  it('closes on X button click', () => {
    const closeDrawer = vi.fn();
    mockStore({ drawerIssueId: 'PAN-42', closeDrawerIssue: closeDrawer });
    render(<IssueDrawer />);
    fireEvent.click(screen.getByTestId('issue-drawer-close'));
    expect(closeDrawer).toHaveBeenCalled();
  });

  it('closes on Escape key', () => {
    const closeDrawer = vi.fn();
    mockStore({ drawerIssueId: 'PAN-42', closeDrawerIssue: closeDrawer });
    render(<IssueDrawer />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeDrawer).toHaveBeenCalled();
  });
});
