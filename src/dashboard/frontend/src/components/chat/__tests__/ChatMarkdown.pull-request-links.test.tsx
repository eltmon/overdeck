import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-3822 WI-7: right-clicking a PR URL in a conversation transcript offers
// Link / Unlink; other URLs and transcripts outside a conversation don't.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

import { ChatMarkdown } from '../ChatMarkdown';
import { ConversationPullRequestProvider } from '../TranscriptPullRequestLink';

const PR_URL = 'https://github.com/eltmon/overdeck/pull/42';
const fetchMock = vi.fn();

const effective = {
  host: 'github.com', repository: 'eltmon/overdeck', number: 42, url: PR_URL, source: 'manual' as const,
  linkedAt: '2026-09-24T00:00:00.000Z', dismissedAt: null, snapshot: null,
};

function renderIn(children: ReactNode, pullRequest: typeof effective | null = null, inConversation = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      {inConversation
        ? <ConversationPullRequestProvider conversation={{ name: 'conv-a', pullRequest }}>{children}</ConversationPullRequestProvider>
        : children}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatMarkdown PR links (PAN-3822)', () => {
  it('offers "Link to conversation" on a PR URL and POSTs it', async () => {
    renderIn(<ChatMarkdown text={`See [the PR](${PR_URL}/files) please.`} />);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'the PR' }));

    fireEvent.click(await screen.findByText('Link to conversation'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conv-a/pull-requests', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ ref: PR_URL }),
    })));
  });

  it('offers "Unlink from conversation" when that PR is the one the conversation shows', async () => {
    renderIn(<ChatMarkdown text={`Done: ${PR_URL}`} />, effective);
    fireEvent.contextMenu(screen.getByRole('link', { name: PR_URL }));

    expect(screen.queryByText('Link to conversation')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('Unlink from conversation'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/conversations/conv-a/pull-requests?ref=${encodeURIComponent(PR_URL)}`, { method: 'DELETE' },
    ));
  });

  it('adds no menu to a non-PR URL or outside a conversation', async () => {
    renderIn(<ChatMarkdown text="Docs: [issue](https://github.com/eltmon/overdeck/issues/42)" />);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'issue' }));
    expect(screen.queryByText('Link to conversation')).not.toBeInTheDocument();

    renderIn(<ChatMarkdown text={`[elsewhere](${PR_URL})`} />, null, false);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'elsewhere' }));
    expect(screen.queryByText('Link to conversation')).not.toBeInTheDocument();
  });
});
