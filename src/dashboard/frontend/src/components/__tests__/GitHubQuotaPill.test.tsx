import { fireEvent, render, screen, within } from '@testing-library/react';
import type { GitHubQuotaSnapshot } from '@overdeck/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import { GitHubQuotaPill } from '../GitHubQuotaPill';

// PAN-4264 Work Item 17: GH <remaining>/<limit>, and the top callers in descending points.

function usage(caller: GitHubQuotaSnapshot['callers'][number]['caller'], graphql: number, rest: number) {
  return { caller, graphql: { points: graphql, calls: 1 }, rest: { points: rest, calls: 1 }, estimated: false };
}

function quota(overrides: Partial<GitHubQuotaSnapshot> = {}): GitHubQuotaSnapshot {
  return {
    generatedAt: '2026-09-27T15:00:00.000Z',
    login: 'octo-login',
    callers: [
      usage('pr-sync', 40, 0),
      usage('pipeline-membership', 300, 10),
      usage('agent', 0, 0),
      usage('ci-repair', 0, 90),
      usage('close-out', 5, 0),
      usage('pr-cache', 20, 0),
      usage('issue-poller', 0, 12),
    ],
    samples: [{ pool: 'user', bucket: 'graphql', ts: '2026-09-27T14:59:00.000Z', remaining: 4956, limit: 5000 }],
    pauses: [],
    ownUsageLow: true,
    unattributed: 120,
    refusals: { primary: 0, secondary: 0 },
    ...overrides,
  };
}

describe('GitHubQuotaPill (PAN-4264)', () => {
  afterEach(() => {
    useDashboardStore.setState({ githubQuota: null });
  });

  it('renders nothing until the publisher reports', () => {
    render(<GitHubQuotaPill />);
    expect(screen.queryByTestId('github-quota-pill')).toBeNull();
  });

  it('shows the user GraphQL sample, or a dash without one', () => {
    useDashboardStore.setState({ githubQuota: quota() });
    const { unmount } = render(<GitHubQuotaPill />);
    expect(screen.getByTestId('github-quota-pill').textContent).toBe('GH 4956/5000');
    unmount();

    useDashboardStore.setState({ githubQuota: quota({ samples: [] }) });
    render(<GitHubQuotaPill />);
    expect(screen.getByTestId('github-quota-pill').textContent).toBe('GH —');
  });

  it('lists the top 5 callers by points in descending order plus the unattributed row', () => {
    useDashboardStore.setState({ githubQuota: quota() });
    render(<GitHubQuotaPill />);
    fireEvent.click(screen.getByTestId('github-quota-pill'));

    const rows = within(screen.getByTestId('github-quota-callers')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'pipeline-membership310 pts',
      'ci-repair90 pts',
      'pr-sync40 pts',
      'pr-cache20 pts',
      'issue-poller12 pts',
    ]);
    expect(screen.getByRole('dialog').textContent).toContain('120 pts');
  });

  it('uses the warning tone while calls are paused', () => {
    useDashboardStore.setState({
      githubQuota: quota({
        pauses: [{ pool: 'user', bucket: 'graphql', kind: 'primary', caller: 'pr-sync', since: 'a', until: '2026-09-27T15:10:00.000Z' }],
      }),
    });
    render(<GitHubQuotaPill />);
    expect(screen.getByTestId('github-quota-pill').className).toContain('text-warning-foreground');
  });
});
