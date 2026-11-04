/**
 * PAN-4849 WI-7: the Decisions tab renders the golden Deft state and
 * resolves an escalation through the mutation hook.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

const mutate = vi.fn();
vi.mock('./queries', () => ({
  useDeftIssueState: () => ({ data: golden, isLoading: false, error: null }),
  useResolveEscalation: () => ({ mutate, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { DeftDecisionsTab } from './DeftDecisionsTab';

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

describe('DeftDecisionsTab', () => {
  it('renders open escalations first, then resolved ones, with the dangerous pill', () => {
    render(<DeftDecisionsTab issueId="PAN-1" />);
    const rows = screen.getAllByTestId(/^deft-escalation-/).map((row) => row.getAttribute('data-testid'));
    expect(rows).toEqual([
      'deft-escalation-esc-20261102120000-aaaaaa',
      'deft-escalation-esc-20261102120100-bbbbbb',
      'deft-escalation-esc-20261102120200-cccccc',
      'deft-escalation-esc-20261101120000-dddddd',
    ]);
    const danger = screen.getByTestId('deft-escalation-esc-20261102120000-aaaaaa');
    expect(danger.textContent).toContain('Run the database migration');
    expect(danger.textContent).toContain('dangerous');
    expect(danger.textContent).toContain('overdue');
    expect(screen.getByTestId('deft-escalation-esc-20261101120000-dddddd').textContent).toContain('approved by operator:eltmon');
  });

  it('renders the decision record and the policy', () => {
    render(<DeftDecisionsTab issueId="PAN-1" />);
    expect(screen.getByText('The plan tab is where operators look')).toBeInTheDocument();
    const policy = document.querySelector('[data-section="Deft policy"]') as HTMLElement;
    expect(policy.textContent).toContain('requireHumanMergetrue');
    expect(policy.textContent).toContain('{"reviewers":["greptile"],"minGreptileConfidence":4}');
  });

  it('resolves an escalation with the chosen decision', () => {
    render(<DeftDecisionsTab issueId="PAN-1" />);
    const row = screen.getByTestId('deft-escalation-esc-20261102120000-aaaaaa');
    fireEvent.change(row.querySelector('select') as HTMLSelectElement, { target: { value: 'denied' } });
    fireEvent.click(row.querySelector('button') as HTMLButtonElement);
    expect(mutate).toHaveBeenCalledWith({ escId: 'esc-20261102120000-aaaaaa', decision: 'denied' }, expect.any(Object));
  });
});
