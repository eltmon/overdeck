import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DerivedIssueState } from '@overdeck/contracts';
import { useDashboardStore } from '../../lib/store';
import { IssueCostChip, IssueStateBadge } from './IssueHeaderFacts';

function seedDerived(state: DerivedIssueState['state'] | null) {
  useDashboardStore.setState({
    derivedIssueStateByIssueId: state ? { 'PAN-1': { issueId: 'PAN-1', state } as DerivedIssueState } : {},
  } as Parameters<typeof useDashboardStore.setState>[0]);
}

function renderCost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <IssueCostChip issueId="PAN-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  seedDerived(null);
});

describe('IssueStateBadge', () => {
  it.each([
    ['working', 'Working', 'badge-bg-info'],
    ['merged', 'Merged', 'badge-bg-success'],
  ] as const)('IssueStateBadge shows the derived state with its tone class (%s)', (state, label, toneClass) => {
    seedDerived(state);
    render(<IssueStateBadge issueId="PAN-1" agents={[]} />);
    const badge = screen.getByTestId('drawer-state-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveClass(toneClass);
  });

  it('IssueStateBadge shows Planning while a plan agent is live', () => {
    seedDerived('planned');
    render(<IssueStateBadge issueId="PAN-1" agents={[{ id: 'planning-pan-1', role: 'plan', status: 'running' }]} />);
    expect(screen.getByTestId('drawer-state-badge')).toHaveTextContent('Planning');
  });

  it('IssueStateBadge renders nothing without a state or a tracker status', () => {
    const { container } = render(<IssueStateBadge issueId="PAN-1" agents={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('IssueCostChip', () => {
  it('IssueCostChip formats the resolved total', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ totalCost: 12, resolvedTotalCost: 18.9, totalTokens: 0, sessions: [], byModel: {} })));
    renderCost();
    expect(await screen.findByTestId('drawer-cost')).toHaveTextContent('$18.90');
  });

  it('IssueCostChip renders nothing at zero', async () => {
    const fetchMock = vi.fn(async () => Response.json({ totalCost: 0, totalTokens: 0, sessions: [], byModel: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderCost();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
