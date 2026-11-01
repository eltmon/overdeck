import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-4714: a plain click on a resolvable tracker issue link inside a
// conversation transcript opens the issue drawer instead of a new tab;
// modified clicks, unresolved links, PR links, links outside a conversation,
// and links in a host that doesn't mount <IssueDrawer /> keep today's
// new-tab behaviour.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

import { ChatMarkdown } from '../ChatMarkdown';
import { ConversationPullRequestProvider } from '../TranscriptPullRequestLink';
import { IssueDrawerAvailableContext } from '../../drawer/issueDrawerAvailableContext';
import { useDashboardStore } from '../../../lib/store';

const REGISTERED_PROJECTS = [
  { key: 'panopticon-cli', name: 'Overdeck', path: '/p', linearTeam: 'PAN', githubRepo: 'eltmon/overdeck', tracker: 'github' },
  { key: 'lexerra', name: 'Lexerra', path: '/l', linearTeam: 'LEX', githubRepo: 'eltmon/lexerra', tracker: 'linear' },
  { key: 'mind-your-now', name: 'MYN', path: '/m', linearTeam: 'MIN', githubRepo: null, tracker: 'linear' },
];

const originalOpenIssue = useDashboardStore.getState().openIssue;
const originalIssuesRaw = useDashboardStore.getState().issuesRaw;
const openIssueMock = vi.fn();
const fetchMock = vi.fn();

function renderIn(children: ReactNode, { inConversation = true, drawerAvailable = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = inConversation
    ? <ConversationPullRequestProvider conversation={{ name: 'conv-a', pullRequest: null }}>{children}</ConversationPullRequestProvider>
    : children;
  render(
    <QueryClientProvider client={client}>
      <IssueDrawerAvailableContext.Provider value={drawerAvailable}>
        {tree}
      </IssueDrawerAvailableContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  openIssueMock.mockReset();
  useDashboardStore.setState({ openIssue: openIssueMock });
  fetchMock.mockReset();
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/registered-projects')) return Promise.resolve(Response.json(REGISTERED_PROJECTS));
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useDashboardStore.setState({ openIssue: originalOpenIssue, issuesRaw: originalIssuesRaw });
});

describe('ChatMarkdown issue links (PAN-4714)', () => {
  it('opens the issue drawer on a plain click', async () => {
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />);
    const link = await screen.findByRole('link', { name: 'PAN-4645' });
    await waitFor(() => expect(link).toHaveAttribute('data-issue-id', 'PAN-4645'));

    expect(fireEvent.click(link)).toBe(false);

    expect(openIssueMock).toHaveBeenCalledOnce();
    expect(openIssueMock).toHaveBeenCalledWith('PAN-4645', 'overview', 'https://github.com/eltmon/overdeck/issues/4645');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens the issue drawer on a plain click of a resolvable Linear URL', async () => {
    renderIn(<ChatMarkdown text="See [MIN-663](https://linear.app/mindyournow/issue/min-663/some-title) please." />);
    const link = await screen.findByRole('link', { name: 'MIN-663' });
    await waitFor(() => expect(link).toHaveAttribute('data-issue-id', 'MIN-663'));

    expect(fireEvent.click(link)).toBe(false);

    expect(openIssueMock).toHaveBeenCalledOnce();
    expect(openIssueMock).toHaveBeenCalledWith('MIN-663', 'overview', 'https://linear.app/mindyournow/issue/min-663/some-title');
  });

  it('keeps the new tab on every modifier and middle-click', async () => {
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />);
    const link = await screen.findByRole('link', { name: 'PAN-4645' });
    await waitFor(() => expect(link).toHaveAttribute('data-issue-id', 'PAN-4645'));

    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
    expect(fireEvent.click(link, { altKey: true })).toBe(true);
    // Browsers fire `auxclick`, not `click`, for the middle button; `onClick`
    // never runs, so the default anchor navigation always applies.
    expect(fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }))).toBe(true);

    expect(openIssueMock).not.toHaveBeenCalled();
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/issues/4645');
  });

  it("keeps today's behaviour for an unregistered repo and a tracker mismatch", async () => {
    renderIn(
      <ChatMarkdown text={[
        '[unregistered](https://github.com/someone/else/issues/7)',
        '[mismatch](https://github.com/eltmon/lexerra/issues/1)',
        '[control](https://github.com/eltmon/overdeck/issues/4645)',
      ].join(' ')} />,
    );
    const control = await screen.findByRole('link', { name: 'control' });
    // The resolvable control link proves the registered-projects query has
    // resolved before asserting the other two links stayed unresolved.
    await waitFor(() => expect(control).toHaveAttribute('data-issue-id', 'PAN-4645'));

    const unregistered = screen.getByRole('link', { name: 'unregistered' });
    const mismatch = screen.getByRole('link', { name: 'mismatch' });
    expect(unregistered).not.toHaveAttribute('data-issue-id');
    expect(mismatch).not.toHaveAttribute('data-issue-id');

    expect(fireEvent.click(unregistered)).toBe(true);
    expect(fireEvent.click(mismatch)).toBe(true);
    expect(openIssueMock).not.toHaveBeenCalled();
  });

  it('keeps the PR link menu and new-tab click for a PR URL', async () => {
    renderIn(<ChatMarkdown text="See [the PR](https://github.com/eltmon/overdeck/pull/42) please." />);
    const link = screen.getByRole('link', { name: 'the PR' });

    fireEvent.contextMenu(link);
    expect(await screen.findByText('Link to conversation')).toBeInTheDocument();

    expect(fireEvent.click(link)).toBe(true);
    expect(openIssueMock).not.toHaveBeenCalled();
  });

  it('keeps a plain link outside a conversation', async () => {
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />, { inConversation: false });
    const link = screen.getByRole('link', { name: 'PAN-4645' });

    expect(link).not.toHaveAttribute('data-issue-id');
    expect(fireEvent.click(link)).toBe(true);
    expect(openIssueMock).not.toHaveBeenCalled();
  });

  it('keeps a plain link in a conversation host with no issue drawer mounted', async () => {
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />, { drawerAvailable: false });
    const link = screen.getByRole('link', { name: 'PAN-4645' });

    expect(link).not.toHaveAttribute('data-issue-id');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/registered-projects');
    expect(fireEvent.click(link)).toBe(true);
    expect(openIssueMock).not.toHaveBeenCalled();
  });

  it('opens the drawer for an issue absent from the store snapshot (PAN-4717)', async () => {
    useDashboardStore.setState({
      issuesRaw: [{
        id: 'PAN-4645',
        identifier: 'PAN-4645',
        title: 'Present issue',
        status: 'Todo',
        priority: 3,
        labels: [],
        url: 'https://github.com/eltmon/overdeck/issues/4645',
        createdAt: '2026-05-18T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      }],
    } as Parameters<typeof useDashboardStore.setState>[0]);
    renderIn(<ChatMarkdown text={[
      '[PAN-3659](https://github.com/eltmon/overdeck/issues/3659)',
      '[PAN-4645](https://github.com/eltmon/overdeck/issues/4645)',
    ].join(' ')} />);
    const absentLink = await screen.findByRole('link', { name: 'PAN-3659' });
    const presentLink = screen.getByRole('link', { name: 'PAN-4645' });
    await waitFor(() => expect(absentLink).toHaveAttribute('data-issue-id', 'PAN-3659'));
    await waitFor(() => expect(presentLink).toHaveAttribute('data-issue-id', 'PAN-4645'));

    expect(fireEvent.click(absentLink)).toBe(false);
    expect(fireEvent.click(presentLink)).toBe(false);

    expect(openIssueMock).toHaveBeenCalledWith('PAN-3659', 'overview', 'https://github.com/eltmon/overdeck/issues/3659');
    expect(openIssueMock).toHaveBeenCalledWith('PAN-4645', 'overview', 'https://github.com/eltmon/overdeck/issues/4645');
    expect(window.open).not.toHaveBeenCalled();
  });
});
