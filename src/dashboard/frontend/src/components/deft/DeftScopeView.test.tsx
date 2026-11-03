/**
 * PAN-4849 WI-11: Deft scopes in Plan › Tasks, with Sign off only where Deft
 * needs a human provenance.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

const state = vi.hoisted(() => ({ value: null as unknown }));
const mutate = vi.fn();
vi.mock('./queries', () => ({
  useDeftIssueState: () => ({ data: state.value }),
  useSignOffScope: () => ({ mutate, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { DeftScopeView } from './DeftScopeView';

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

describe('DeftScopeView', () => {
  it('groups scopes by folder in board order and shows evidence', () => {
    state.value = golden;
    render(<DeftScopeView issueId="PAN-1" />);
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Deft scopes · In progress',
      'Deft scopes · Planned',
      'Deft scopes · Proposed',
      'Deft scopes · Done',
      'Deft scopes · Cancelled',
    ]);
    expect(screen.getByTestId('deft-item-scope-ui-u1').textContent).toContain('commit: abc1234');
  });

  it('offers Sign off for an agent disposition and posts the scope path and item id', () => {
    state.value = golden;
    render(<DeftScopeView issueId="PAN-1" />);
    const item = screen.getByTestId('deft-item-scope-ui-u2');
    expect(item.textContent).toContain('waived — Covered by unit tests');
    fireEvent.click(within(item).getByRole('button', { name: 'Sign off' }));
    expect(mutate).toHaveBeenCalledWith({ scopePath: 'xbrief/active/ui.xbrief.json', itemId: 'u2' }, expect.any(Object));
  });

  it('shows no Sign off for a human-event disposition', () => {
    const scopes = golden.scopes.map((scope) => ({
      ...scope,
      items: scope.items.map((item) =>
        'disposition' in item ? { ...item, disposition: { ...item.disposition, provenanceKind: 'human-event' } } : item),
    }));
    state.value = { ...golden, scopes };
    render(<DeftScopeView issueId="PAN-1" />);
    expect(within(screen.getByTestId('deft-item-scope-ui-u2')).queryByRole('button')).toBeNull();
  });

  it('renders nothing without Deft state', () => {
    state.value = undefined;
    const { container } = render(<DeftScopeView issueId="PAN-2" />);
    expect(container.innerHTML).toBe('');
  });
});
