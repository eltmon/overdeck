import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-4714: a plain click on a resolvable tracker issue link inside a
// conversation transcript opens the issue drawer instead of a new tab;
// modified clicks, unresolved links, PR links and links outside a
// conversation keep today's new-tab behaviour.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

import { ChatMarkdown } from '../ChatMarkdown';
import { ConversationPullRequestProvider } from '../TranscriptPullRequestLink';
import { useDashboardStore } from '../../../lib/store';

const REGISTERED_PROJECTS = [
  { key: 'panopticon-cli', name: 'Overdeck', path: '/p', linearTeam: 'PAN', githubRepo: 'eltmon/overdeck', tracker: 'github' },
  { key: 'lexerra', name: 'Lexerra', path: '/l', linearTeam: 'LEX', githubRepo: 'eltmon/lexerra', tracker: 'linear' },
];

const originalOpenIssue = useDashboardStore.getState().openIssue;
const openIssueMock = vi.fn();
const fetchMock = vi.fn();

function renderIn(children: ReactNode, inConversation = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {inConversation
        ? <ConversationPullRequestProvider conversation={{ name: 'conv-a', pullRequest: null }}>{children}</ConversationPullRequestProvider>
        : children}
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
  useDashboardStore.setState({ openIssue: originalOpenIssue });
});

describe('ChatMarkdown issue links (PAN-4714)', () => {
  it('opens the issue drawer on a plain click', async () => {
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />);
    const link = await screen.findByRole('link', { name: 'PAN-4645' });
    await waitFor(() => expect(link).toHaveAttribute('data-issue-id', 'PAN-4645'));

    expect(fireEvent.click(link)).toBe(false);

    expect(openIssueMock).toHaveBeenCalledOnce();
    expect(openIssueMock).toHaveBeenCalledWith('PAN-4645', 'overview');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('keeps the new tab on Ctrl-click and Cmd-click', async () => {
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />);
    const link = await screen.findByRole('link', { name: 'PAN-4645' });
    await waitFor(() => expect(link).toHaveAttribute('data-issue-id', 'PAN-4645'));

    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);

    expect(openIssueMock).not.toHaveBeenCalled();
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/issues/4645');
  });

  it("keeps today's behaviour for an unregistered repo and a tracker mismatch", async () => {
    renderIn(
      <ChatMarkdown text={[
        '[unregistered](https://github.com/someone/else/issues/7)',
        '[mismatch](https://github.com/eltmon/lexerra/issues/1)',
      ].join(' ')} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/registered-projects'));

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
    renderIn(<ChatMarkdown text="See [PAN-4645](https://github.com/eltmon/overdeck/issues/4645) please." />, false);
    const link = screen.getByRole('link', { name: 'PAN-4645' });

    expect(link).not.toHaveAttribute('data-issue-id');
    expect(fireEvent.click(link)).toBe(true);
    expect(openIssueMock).not.toHaveBeenCalled();
  });
});
