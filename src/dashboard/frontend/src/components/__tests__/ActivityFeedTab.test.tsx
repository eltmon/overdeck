/**
 * PAN-5293 WI-18: /activity opens on the Feed tab, the Awareness feed with
 * its scopes, scoped to the selected project.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_STREAM_STORAGE_KEY, ActivityPanel } from '../ActivityPanel';
import type { ProjectData } from '../CommandDeck/projectsData';

const feedProps = vi.fn();
vi.mock('../sessionFeed/SessionFeedSidebar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sessionFeed/SessionFeedSidebar')>();
  return {
    SessionFeedSidebar: (props: Parameters<typeof actual.SessionFeedSidebar>[0]) => {
      feedProps(props);
      return <actual.SessionFeedSidebar {...props} />;
    },
  };
});

const project: ProjectData = {
  key: 'proj', name: 'proj', path: '/p/proj',
  features: [{ issueId: 'PAN-1' } as ProjectData['features'][number]],
};

function renderPanel({ experimental = false, selectedProjectKey = null as string | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['settings', 'experimental-features'], experimental);
  client.setQueryData(['command-deck-projects'], [project]);
  client.setQueryData(['session-trees', 'proj'], []);
  client.setQueryData(['registered-projects'], [{ key: 'proj', name: 'proj', path: '/p/proj' }]);
  client.setQueryData(['conversations'], [{
    id: 7, name: 'c7', tmuxSession: 'conv-c7', status: 'ended', cwd: '/p/proj', issueId: null,
    createdAt: '2026-11-15T00:00:00Z', endedAt: null, lastAttachedAt: null, sessionAlive: false,
  }]);
  return render(
    <QueryClientProvider client={client}>
      <ActivityPanel onClose={vi.fn()} selectedProjectKey={selectedProjectKey} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  feedProps.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ActivityPanel Feed tab (PAN-5293 F-D21)', () => {
  it('opens on Feed with the Awareness scopes', () => {
    renderPanel({ experimental: true, selectedProjectKey: 'proj' });
    expect(screen.getByTestId('activity-stream-feed')).toHaveAttribute('aria-selected', 'true');
    const scopes = screen.getByRole('tablist', { name: 'Awareness scope' });
    for (const label of ['Needs you', 'Project', 'Global']) {
      expect(within(scopes).getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(feedProps).toHaveBeenLastCalledWith(expect.objectContaining({ embedded: true, hideHeader: true, scopeSwitcher: true, projectScopeAvailable: true }));
    expect(feedProps.mock.lastCall?.[0]).not.toHaveProperty('onClose', expect.anything());
  });

  // PAN-5335 WI-6: the tab header already names the view; the sidebar must not duplicate it.
  it('has no duplicate "Feed" heading inside the tab', () => {
    renderPanel({ experimental: true, selectedProjectKey: 'proj' });
    expect(within(screen.getByTestId('activity-feed-tab')).queryByText('Feed')).not.toBeInTheDocument();
  });

  it('hides the Project scope and shows only Needs you and Global without a selected project', () => {
    window.localStorage.setItem('overdeck.ui.awarenessScope', 'project');
    renderPanel({ experimental: true, selectedProjectKey: null });

    const scopes = screen.getByRole('tablist', { name: 'Awareness scope' });
    expect(within(scopes).getByRole('tab', { name: /Needs you/ })).toBeInTheDocument();
    expect(within(scopes).getByRole('tab', { name: /Global/ })).toBeInTheDocument();
    expect(within(scopes).queryByRole('tab', { name: /Project/ })).not.toBeInTheDocument();
    expect(within(scopes).getByRole('tab', { name: /Global/ })).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem('overdeck.ui.awarenessScope')).toBe('project');
  });

  it('shows only the Feed, with no stream tabs, while experimental features are off', () => {
    renderPanel({ experimental: false });
    expect(screen.getByTestId('activity-feed-tab')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Activity streams' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-stream-normal')).not.toBeInTheDocument();
  });

  it('remembers the chosen stream across remounts', () => {
    const first = renderPanel({ experimental: true });
    fireEvent.click(screen.getByTestId('activity-stream-normal'));
    expect(screen.getByTestId('activity-stream-normal')).toHaveTextContent('Activity Log');
    expect(localStorage.getItem(ACTIVITY_STREAM_STORAGE_KEY)).toBe('normal');
    first.unmount();

    renderPanel({ experimental: true });
    expect(screen.getByTestId('activity-stream-normal')).toHaveAttribute('aria-selected', 'true');
  });

  it("scopes Project to the selected project's issues and conversations, and to nothing without one", () => {
    const first = renderPanel({ selectedProjectKey: 'proj' });
    const scoped = feedProps.mock.lastCall?.[0];
    expect(scoped.projectIssueIds).toEqual(['PAN-1']);
    expect(scoped.projectConversationIds.has(7)).toBe(true);
    first.unmount();

    feedProps.mockClear();
    renderPanel({ selectedProjectKey: null });
    const unscoped = feedProps.mock.lastCall?.[0];
    expect(unscoped.projectIssueIds).toBeUndefined();
    expect(unscoped.projectConversationIds).toBeUndefined();
  });
});
