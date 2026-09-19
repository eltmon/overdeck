/**
 * The server adapter for the FR-6 derivation (PAN-3917).
 *
 * The derivation is shared with the CLI; what the server adds is where the
 * facts come from — the issue cache for the tracker row, the backend inventory
 * for panes. A route that asks for one issue id and nothing else must still
 * see `closed`, and an issue no tracker has answered for must not be reported
 * as open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTrackerIssue: vi.fn(),
  getBackendPanes: vi.fn(),
}));

vi.mock('../issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ getTrackerIssue: mocks.getTrackerIssue }),
}));
vi.mock('../backend-inventory.js', () => ({
  getBackendPanes: mocks.getBackendPanes,
}));

import { getDerivedIssueState, loadIssueStatesForProject } from '../derived-issue-state.js';

const offline = {
  now: () => 1_800_000_000_000,
  readPr: async () => null,
  readBranch: async () => null,
  readPaneText: async () => '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBackendPanes.mockResolvedValue([]);
});

describe('getDerivedIssueState reads the tracker through the shared issue cache', () => {
  it('reports a closed issue as closed even with an open pull request', async () => {
    mocks.getTrackerIssue.mockReturnValue({ open: false, labels: [] });

    const derived = await getDerivedIssueState('PAN-3917', {
      ...offline,
      readPr: async () => ({
        url: 'https://example.test/pr/1', number: 1, reviewState: 'review-requested' as const,
        checks: 'pending' as const, mergeable: null, merged: false,
      }),
    });

    expect(mocks.getTrackerIssue).toHaveBeenCalledWith('PAN-3917');
    expect(derived.state).toBe('closed');
  });

  it('carries the tracker labels, so a parked issue reads as parked', async () => {
    mocks.getTrackerIssue.mockReturnValue({ open: true, labels: ['Parked'] });

    const derived = await getDerivedIssueState('PAN-3917', offline);

    expect(derived.state).toBe('parked');
  });

  it('marks an issue no tracker answered for as unknown rather than open', async () => {
    mocks.getTrackerIssue.mockReturnValue(null);

    const derived = await getDerivedIssueState('PAN-3917', offline);

    expect(derived.trackerUnknown).toBe(true);
    expect(derived.state).not.toBe('closed');
  });
});

describe('the batch door', () => {
  it('fills the tracker rows from the cache when the caller has none', async () => {
    mocks.getTrackerIssue.mockImplementation((id: string) =>
      (id === 'PAN-1' ? { open: false, labels: [] } : { open: true, labels: [] }));

    const states = await loadIssueStatesForProject('/tmp/does-not-exist', ['PAN-1', 'PAN-2'], offline);

    expect(states.get('PAN-1')?.state).toBe('closed');
    expect(states.get('PAN-2')?.state).not.toBe('closed');
  });
});
