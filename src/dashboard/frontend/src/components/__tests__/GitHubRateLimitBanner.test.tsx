import { render, screen } from '@testing-library/react';
import type { GitHubQuotaPause, GitHubQuotaSnapshot } from '@overdeck/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { useDashboardStore } from '../../lib/store';
import { GitHubRateLimitBanner } from '../GitHubRateLimitBanner';

// PAN-4264 Work Item 16: the four decision-table texts, and nothing without a pause.

const UNTIL = '2026-09-27T15:12:00.000Z';
const HHMM = (() => {
  const d = new Date(UNTIL);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
})();

function pause(kind: GitHubQuotaPause['kind']): GitHubQuotaPause {
  return { pool: 'user', bucket: 'graphql', kind, caller: 'pipeline-membership', since: '2026-09-27T15:02:00.000Z', until: UNTIL };
}

function quota(overrides: Partial<GitHubQuotaSnapshot> = {}): GitHubQuotaSnapshot {
  return {
    generatedAt: '2026-09-27T15:03:00.000Z',
    login: 'octo-login',
    callers: [
      { caller: 'pr-sync', graphql: { points: 40, calls: 40 }, rest: { points: 0, calls: 0 }, estimated: true },
      { caller: 'pipeline-membership', graphql: { points: 700, calls: 30 }, rest: { points: 5, calls: 5 }, estimated: false },
    ],
    samples: [],
    pauses: [pause('primary')],
    ownUsageLow: false,
    unattributed: 0,
    refusals: { primary: 1, secondary: 0 },
    ...overrides,
  };
}

function bannerText(): string {
  return screen.getByTestId('github-rate-limit-banner').textContent ?? '';
}

describe('GitHubRateLimitBanner (PAN-4264)', () => {
  afterEach(() => {
    useDashboardStore.setState({ githubQuota: null });
  });

  it('renders nothing without a quota snapshot or without a pause', () => {
    useDashboardStore.setState({ githubQuota: null });
    const { unmount } = render(<GitHubRateLimitBanner />);
    expect(screen.queryByTestId('github-rate-limit-banner')).toBeNull();
    unmount();

    useDashboardStore.setState({ githubQuota: quota({ pauses: [] }) });
    render(<GitHubRateLimitBanner />);
    expect(screen.queryByTestId('github-rate-limit-banner')).toBeNull();
  });

  it('explains a secondary limit', () => {
    useDashboardStore.setState({ githubQuota: quota({ pauses: [pause('secondary')] }) });
    render(<GitHubRateLimitBanner />);
    expect(bannerText()).toBe(
      `GitHub secondary rate limit for octo-login: calls paused until ${HHMM}. Overdeck sent requests too fast; pollers resume automatically.`,
    );
  });

  it('says a primary limit is not caused by this machine when own usage is low', () => {
    useDashboardStore.setState({ githubQuota: quota({ ownUsageLow: true }) });
    render(<GitHubRateLimitBanner />);
    expect(bannerText()).toBe(
      `GitHub rate limit for octo-login: calls paused until ${HHMM}; not caused by this machine (this machine used 740 points in the last hour). Another tool or Overdeck install using this account is spending the shared limit.`,
    );
  });

  it('names the top caller for a primary limit this machine can explain', () => {
    useDashboardStore.setState({ githubQuota: quota() });
    render(<GitHubRateLimitBanner />);
    expect(bannerText()).toBe(
      `GitHub rate limit for octo-login: calls paused until ${HHMM}. This machine used 740 points in the last hour; top caller: pipeline-membership (700 points).`,
    );
  });

  it('falls back to the short text with no metered callers, and to "your account" without a login', () => {
    useDashboardStore.setState({ githubQuota: quota({ callers: [], login: null }) });
    render(<GitHubRateLimitBanner />);
    expect(bannerText()).toBe(`GitHub rate limit for your account: calls paused until ${HHMM}.`);
  });
});
