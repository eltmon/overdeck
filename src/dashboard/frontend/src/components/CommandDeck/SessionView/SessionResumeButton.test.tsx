import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionResumeButton } from './SessionResumeButton';

const resumeView = {
  action: { key: 'resumeSession', label: 'Resume session' },
  enabled: true,
  isPending: false,
  invoke: vi.fn(),
};

const mockActions = { all: [resumeView], activeDialog: null, closeDialog: vi.fn(), submitDialogAction: vi.fn() };

vi.mock('../../IssueActionMenu/useIssueActions', () => ({
  useIssueActions: () => mockActions,
}));
vi.mock('../../IssueActionMenu/IssueActionMenu', () => ({
  IssueActionDialogHost: () => null,
}));

describe('SessionResumeButton', () => {
  it('renders the resume button when the resumeSession action is enabled', () => {
    render(<SessionResumeButton issueId="MIN-865" />);
    expect(screen.getByTestId('session-resume-button')).toBeTruthy();
    expect(screen.getByText('Resume session')).toBeTruthy();
  });

  it('renders nothing when the action is disabled', () => {
    resumeView.enabled = false;
    const { container } = render(<SessionResumeButton issueId="MIN-865" />);
    expect(container.querySelector('[data-testid="session-resume-button"]')).toBeNull();
    resumeView.enabled = true;
  });
});
