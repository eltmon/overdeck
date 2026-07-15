import { beforeEach, describe, expect, it } from 'vitest';
import { getIssueIdFromPath } from '../App/routes';
import { useDashboardStore } from '../lib/store';

describe('direct issue route drawer lifecycle', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/issues/PAN-1234');
    useDashboardStore.setState({ drawer: { issueId: null, tab: 'overview' } });
  });

  it('opens through the drawer store and closes onto the remembered parent surface', () => {
    const issueId = getIssueIdFromPath();
    expect(issueId).toBe('PAN-1234');

    useDashboardStore.getState().openIssueFromRoute(issueId!, '/board');
    expect(useDashboardStore.getState().drawer).toEqual({ issueId: 'PAN-1234', tab: 'overview' });
    expect(window.location.pathname).toBe('/issues/PAN-1234');

    useDashboardStore.getState().closeIssue();
    expect(window.location.pathname).toBe('/board');
    expect(useDashboardStore.getState().drawer).toEqual({ issueId: null, tab: 'overview' });

    useDashboardStore.getState().syncDrawerFromUrl();
    expect(useDashboardStore.getState().drawer).toEqual({ issueId: null, tab: 'overview' });
  });
});
