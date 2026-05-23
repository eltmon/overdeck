import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZoneActionStrip } from '../ZoneActionStrip';

vi.mock('../../IssueActionMenu', () => ({
  IssueActionMenu: ({ issueId, mode, className }: { issueId: string; mode: string; className?: string }) => (
    <div data-testid="issue-action-menu" data-issue={issueId} data-mode={mode} className={className} />
  ),
}));

vi.mock('../../MergeAutoMergeCountdown', () => ({
  MergeAutoMergeCountdown: ({ issueId, executeAt }: { issueId: string; executeAt: string }) => (
    <div data-testid="auto-merge-countdown" data-issue={issueId} data-execute-at={executeAt}>Auto-merging in</div>
  ),
}));

describe('ZoneActionStrip', () => {
  it('renders the shared issue action menu in hybrid mode', () => {
    render(<ZoneActionStrip issueId="PAN-1190" issue={{ identifier: 'PAN-1190', state: 'verifying_on_main' } as any} />);

    expect(screen.getByTestId('issue-action-menu')).toHaveAttribute('data-issue', 'PAN-1190');
    expect(screen.getByTestId('issue-action-menu')).toHaveAttribute('data-mode', 'hybrid');
  });

  it('renders auto-merge countdown while cooldown is scheduled', () => {
    render(
      <ZoneActionStrip
        issueId="PAN-1418"
        issue={{
          identifier: 'PAN-1418',
          state: 'in_review',
          autoMergeScheduled: {
            executeAt: '2026-05-23T12:02:05.000Z',
            scheduledAt: '2026-05-23T12:00:00.000Z',
          },
        } as any}
      />,
    );

    expect(screen.getByTestId('auto-merge-countdown')).toHaveAttribute('data-issue', 'PAN-1418');
    expect(screen.getByTestId('auto-merge-countdown')).toHaveAttribute('data-execute-at', '2026-05-23T12:02:05.000Z');
    expect(screen.getByText('Auto-merging in')).toBeInTheDocument();
  });

  it('does not render auto-merge countdown when no cooldown is scheduled', () => {
    render(<ZoneActionStrip issueId="PAN-1418" issue={{ identifier: 'PAN-1418', state: 'in_review' } as any} />);

    expect(screen.queryByTestId('auto-merge-countdown')).not.toBeInTheDocument();
  });
});
