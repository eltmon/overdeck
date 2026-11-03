/**
 * PAN-4849 WI-8: a Deft issue's board card shows a Deft chip and its scope
 * counts in AD-20's labels; a non-Deft issue shows nothing.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SUMMARY = {
  issueId: 'PAN-1',
  scopeCounts: { proposed: 1, pending: 1, active: 1, completed: 1, cancelled: 1 },
  specDriftUnresolved: 1,
  installDrift: 0,
  handoffState: 'pr_open',
  openEscalations: 3,
};
vi.mock('./queries', () => ({
  useDeftIssueSummary: (issueId: string) =>
    issueId.toUpperCase() === 'PAN-1'
      ? { isDeft: true, summary: SUMMARY, isLoading: false }
      : { isDeft: false, summary: null, isLoading: false },
}));

import { DeftScopeSummary } from './DeftScopeSummary';

afterEach(cleanup);

describe('DeftScopeSummary', () => {
  it('renders the Deft chip and the scope counts in board order', () => {
    const { container } = render(<DeftScopeSummary issueId="PAN-1" />);
    expect(container.textContent).toBe('DeftIn progress 1 · Planned 1 · Proposed 1 · Done 1 · Cancelled 1');
  });

  it('renders nothing for a non-Deft issue', () => {
    const { container } = render(<DeftScopeSummary issueId="PAN-2" />);
    expect(container.innerHTML).toBe('');
  });
});
