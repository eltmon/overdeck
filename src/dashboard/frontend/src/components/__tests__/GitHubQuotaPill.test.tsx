import { render, screen, within } from '@testing-library/react';
import type { GitHubQuotaSnapshot } from '@overdeck/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import { GitHubQuotaSection } from '../GitHubQuotaPill';

// PAN-4264 Work Item 17, retargeted by PAN-5292 WI-E4: the quota label, and the top callers in descending points.

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

describe('GitHubQuotaSection (PAN-4264, PAN-5292 WI-E4)', () => {
  afterEach(() => {
    useDashboardStore.setState({ githubQuota: null });
  });

  it('renders nothing until the publisher reports', () => {
    const { container } = render(<GitHubQuotaSection />);
    expect(screen.queryByTestId('github-quota-section')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the user GraphQL sample, or "No sample yet" without one', () => {
    useDashboardStore.setState({ githubQuota: quota() });
    const { unmount } = render(<GitHubQuotaSection />);
    expect(screen.getByTestId('github-quota-label').textContent).toBe('4956 of 5000 GraphQL points left this hour');
    unmount();

    useDashboardStore.setState({ githubQuota: quota({ samples: [] }) });
    render(<GitHubQuotaSection />);
    expect(screen.getByTestId('github-quota-label').textContent).toBe('No sample yet');
  });

  it('lists the top 5 callers by points in descending order plus the unattributed row, without a click', () => {
    useDashboardStore.setState({ githubQuota: quota() });
    render(<GitHubQuotaSection />);

    const rows = within(screen.getByTestId('github-quota-callers')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'pipeline-membership310 pts',
      'ci-repair90 pts',
      'pr-sync40 pts',
      'pr-cache20 pts',
      'issue-poller12 pts',
    ]);
    const section = screen.getByRole('region', { name: 'GitHub quota' });
    expect(section.textContent).toContain('Unattributed (other tools and installs)120 pts');
  });

  it('uses the warning tone on the label while calls are paused', () => {
    useDashboardStore.setState({
      githubQuota: quota({
        pauses: [{ pool: 'user', bucket: 'graphql', kind: 'primary', caller: 'pr-sync', since: 'a', until: '2026-09-27T15:10:00.000Z' }],
      }),
    });
    render(<GitHubQuotaSection />);
    expect(screen.getByTestId('github-quota-label')).toHaveClass('text-warning-foreground');
  });
});
