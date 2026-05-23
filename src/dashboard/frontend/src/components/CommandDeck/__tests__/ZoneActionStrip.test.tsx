import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZoneActionStrip } from '../ZoneActionStrip';

vi.mock('../../IssueActionMenu', () => ({
  IssueActionMenu: ({ issueId, mode, className }: { issueId: string; mode: string; className?: string }) => (
    <div data-testid="issue-action-menu" data-issue={issueId} data-mode={mode} className={className} />
  ),
}));

describe('ZoneActionStrip', () => {
  it('renders the shared issue action menu in hybrid mode', () => {
    render(<ZoneActionStrip issueId="PAN-1190" issue={{ identifier: 'PAN-1190', state: 'verifying_on_main' } as any} />);

    expect(screen.getByTestId('issue-action-menu')).toHaveAttribute('data-issue', 'PAN-1190');
    expect(screen.getByTestId('issue-action-menu')).toHaveAttribute('data-mode', 'hybrid');
  });
});
