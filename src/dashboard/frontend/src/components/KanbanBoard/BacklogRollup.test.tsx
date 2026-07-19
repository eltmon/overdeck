/**
 * PAN-2908 · C-BOARD — BacklogRollup tests.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BacklogRollup, backlogGroups } from './BacklogRollup';
import type { Issue } from '../../types';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.identifier ?? 'PAN-1',
    identifier: 'PAN-1',
    title: 'A backlog item',
    status: 'Todo',
    priority: 4,
    labels: [],
    url: '',
    state: 'todo',
    updatedAt: '2026-07-01T00:00:00Z',
    ...overrides,
  } as Issue;
}

describe('backlogGroups', () => {
  it('groups by project, sorted by size desc and priority inside', () => {
    const groups = backlogGroups([
      issue({ identifier: 'PAN-1', priority: 4, project: { id: 'a', name: 'Alpha', color: '#fff' } }),
      issue({ identifier: 'PAN-2', priority: 1, project: { id: 'a', name: 'Alpha', color: '#fff' } }),
      issue({ identifier: 'PAN-3', priority: 2, project: { id: 'b', name: 'Beta', color: '#fff' } }),
      issue({ identifier: 'PAN-4', priority: 3, project: { id: 'b', name: 'Beta', color: '#fff' } }),
      issue({ identifier: 'PAN-5', priority: 4, project: { id: 'b', name: 'Beta', color: '#fff' } }),
    ]);
    expect(groups.map((g) => g.project)).toEqual(['Beta', 'Alpha']);
    expect(groups[0].issues.map((i) => i.identifier)).toEqual(['PAN-3', 'PAN-4', 'PAN-5']);
    expect(groups[1].issues.map((i) => i.identifier)).toEqual(['PAN-2', 'PAN-1']);
  });
});

describe('BacklogRollup', () => {
  it('shows top-N per project and expands to every card on Show all', () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      issue({ identifier: `PAN-${i + 1}`, priority: i === 0 ? 1 : 4, project: { id: 'a', name: 'Alpha', color: '#fff' } }),
    );
    const renderCard = (i: Issue) => <div data-testid={`card-${i.identifier}`} />;
    render(<BacklogRollup issues={issues} renderCard={renderCard} onOpenIssue={() => {}} />);

    // top 3 collapsed rows, no cards yet
    expect(screen.getAllByRole('button', { name: /PAN-/ })).toHaveLength(3);
    expect(screen.queryByTestId('card-PAN-4')).toBeNull();

    fireEvent.click(screen.getByText('Show all 5 →'));
    expect(screen.getByTestId('card-PAN-4')).toBeInTheDocument();
    expect(screen.getByTestId('card-PAN-5')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.queryByTestId('card-PAN-4')).toBeNull();
  });

  it('collapsed rows open the issue', () => {
    const opened: string[] = [];
    render(
      <BacklogRollup
        issues={[issue({ identifier: 'PAN-9' })]}
        renderCard={(i) => <div />}
        onOpenIssue={(id) => opened.push(id)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /PAN-9/ }));
    expect(opened).toEqual(['PAN-9']);
  });
});
