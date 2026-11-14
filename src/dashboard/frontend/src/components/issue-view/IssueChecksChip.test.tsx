import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./VerificationGates', () => ({ VerificationGates: () => <div data-testid="mock-gates" /> }));

import { IssueChecksChip } from './IssueChecksChip';

describe('IssueChecksChip', () => {
  it('renders nothing without a PR check state', () => {
    const { container } = render(<IssueChecksChip issueId="PAN-1" checks={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it.each([
    ['green', 'Checks pass', 'passed'],
    ['red', 'Checks failed', 'failed'],
    ['pending', 'Checks running', 'running'],
  ] as const)('checks %s shows "%s" with data-status %s', (checks, label, status) => {
    render(<IssueChecksChip issueId="PAN-1" checks={checks} />);
    const chip = screen.getByTestId('drawer-checks-chip');
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('data-status', status);
  });

  it('opens the gates popover and closes it on Escape pressed on the chip', () => {
    render(<IssueChecksChip issueId="PAN-1" checks="green" />);
    const chip = screen.getByTestId('drawer-checks-chip');
    fireEvent.click(chip);
    expect(screen.getByTestId('drawer-checks-popover')).toBeInTheDocument();
    expect(screen.getByTestId('mock-gates')).toBeInTheDocument();
    expect(chip).toHaveAttribute('aria-expanded', 'true');

    const event = createEvent.keyDown(chip, { key: 'Escape' });
    fireEvent(chip, event);

    expect(screen.queryByTestId('drawer-checks-popover')).toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not mount the gates until the popover opens', () => {
    render(<IssueChecksChip issueId="PAN-1" checks="red" />);
    expect(screen.queryByTestId('mock-gates')).toBeNull();
    fireEvent.click(screen.getByTestId('drawer-checks-chip'));
    expect(screen.getByTestId('mock-gates')).toBeInTheDocument();
  });
});
