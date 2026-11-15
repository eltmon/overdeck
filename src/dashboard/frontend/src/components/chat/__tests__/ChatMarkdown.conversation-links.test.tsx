import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-5339: a message that names another conversation renders as a link,
// under both the plain and Streamdown markdown renderers.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/wsTransport', () => ({ getTransport: () => ({ request: vi.fn(), resolveFilePathExists: vi.fn() }) }));

import { ChatMarkdown } from '../ChatMarkdown';
import { ConversationPullRequestProvider } from '../TranscriptPullRequestLink';
import { ConversationLinkOpenerContext, type ConversationLinkOpener } from '../ConversationLinkOpenerContext';
import type { Conversation } from '../../CommandDeck/ConversationList';

const CURRENT_NAME = '20261115-0001';

const LISTED: Conversation = {
  id: 3904, name: '20261113-6031', title: 'Refactor the deck',
  tmuxSession: 'conv-20261113-6031', status: 'active', cwd: '/x', issueId: null,
  createdAt: '2026-11-13T00:00:00.000Z', endedAt: null, lastAttachedAt: null, sessionAlive: false,
};
const CURRENT: Conversation = {
  id: 3905, name: CURRENT_NAME, title: 'Current',
  tmuxSession: 'conv-20261115-0001', status: 'active', cwd: '/x', issueId: null,
  createdAt: '2026-11-15T00:00:00.000Z', endedAt: null, lastAttachedAt: null, sessionAlive: false,
};
const ARCHIVED: Conversation = {
  id: 3906, name: '20260824-343d', title: 'Archived one',
  tmuxSession: 'conv-20260824-343d', status: 'ended', cwd: '/x', issueId: null,
  createdAt: '2026-08-24T00:00:00.000Z', endedAt: '2026-08-24T01:00:00.000Z', lastAttachedAt: null, sessionAlive: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/conversations') return Response.json([LISTED, CURRENT]);
    if (url === `/api/conversations/${encodeURIComponent(ARCHIVED.name)}`) return Response.json(ARCHIVED);
    if (url === '/api/conversations/20990101-1234') return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMarkdown(
  node: ReactElement,
  { streamdownRenderer = false, inConversation = true, opener = null as ConversationLinkOpener | null } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const withRenderer = (child: ReactElement) =>
    cloneElement(child as ReactElement<{ useStreamdown?: boolean }>, { useStreamdown: streamdownRenderer });
  const wrap = (child: ReactNode) => (
    <QueryClientProvider client={client}>
      <ConversationLinkOpenerContext.Provider value={opener}>
        {inConversation
          ? <ConversationPullRequestProvider conversation={{ name: CURRENT_NAME }}>{child}</ConversationPullRequestProvider>
          : child}
      </ConversationLinkOpenerContext.Provider>
    </QueryClientProvider>
  );
  return render(wrap(withRenderer(node)));
}

describe.each([false, true])('ChatMarkdown conversation links (PAN-5339, useStreamdown=%s)', (useStreamdown) => {
  beforeEach(async () => {
    if (useStreamdown) await import('streamdown');
  });

  describe('chatmarkdown-wiring.ac1', () => {
    it('renders a plain-text reference as a link with the resolved title', async () => {
      renderMarkdown(<ChatMarkdown text="Tell 20261113-6031 now" />, { streamdownRenderer: useStreamdown });

      const link = await screen.findByRole('link', { name: '20261113-6031' });
      expect(link).toHaveAttribute('href', '/conv/3904');
      expect(link).toHaveAttribute('title', 'Refactor the deck');
    });

    it('renders a whole-value inline code reference as a link wrapping a <code> element', async () => {
      renderMarkdown(<ChatMarkdown text="Tell `20261113-6031` now" />, { streamdownRenderer: useStreamdown });

      const link = await screen.findByRole('link', { name: '20261113-6031' });
      expect(link).toHaveAttribute('href', '/conv/3904');
      expect(link.querySelector('code')).not.toBeNull();
    });
  });

  describe('chatmarkdown-wiring.ac2', () => {
    it.each([
      ['conv 3904', 'conv 3904'],
      ['conversation 3904', 'conversation 3904'],
      ['conv #3904', 'conv #3904'],
      ['/conv/3904', '/conv/3904'],
    ])('renders %s as a link to /conv/3904', async (text, name) => {
      renderMarkdown(<ChatMarkdown text={text} />, { streamdownRenderer: useStreamdown });
      const link = await screen.findByRole('link', { name });
      expect(link).toHaveAttribute('href', '/conv/3904');
    });

    it('renders an archived unlisted key once its fetch resolves', async () => {
      // "conv 20260824-343d" is a name-form match (the hex suffix fails
      // NUMBERED_PATTERN's decimal-only digits), so only the id substring
      // becomes the link; "conv " stays separate plain text.
      renderMarkdown(<ChatMarkdown text="conv 20260824-343d" />, { streamdownRenderer: useStreamdown });
      const link = await screen.findByRole('link', { name: '20260824-343d' });
      expect(link).toHaveAttribute('href', '/conv/3906');
    });
  });

  describe('chatmarkdown-wiring.ac3', () => {
    it('renders no link for a 404 key and keeps the text visible', async () => {
      renderMarkdown(<ChatMarkdown text="conv 20990101-1234" />, { streamdownRenderer: useStreamdown });
      await waitFor(() => {
        const urls = fetchMock.mock.calls.map(([url]) => String(url));
        expect(urls).toContain('/api/conversations/20990101-1234');
      });
      expect(screen.getByText('conv 20990101-1234')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'conv 20990101-1234' })).not.toBeInTheDocument();
    });

    it('renders no link for a reference inside a fenced code block', async () => {
      renderMarkdown(<ChatMarkdown text={'```\nconv 20261113-6031\n```'} />, { streamdownRenderer: useStreamdown });
      await waitFor(() => expect(screen.getByText('conv 20261113-6031')).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: 'conv 20261113-6031' })).not.toBeInTheDocument();
    });

    it('renders no link for the conversation being viewed', async () => {
      renderMarkdown(<ChatMarkdown text={`conv 3905`} />, { streamdownRenderer: useStreamdown });
      await waitFor(() => {
        const urls = fetchMock.mock.calls.map(([url]) => String(url));
        expect(urls).toContain('/api/conversations');
      });
      expect(screen.getByText('conv 3905')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'conv 3905' })).not.toBeInTheDocument();
    });
  });

  describe('chatmarkdown-wiring.ac4', () => {
    it('a hand-written /conv/<key> link opens through the opener on a plain click', async () => {
      const openMock = vi.fn();
      vi.stubGlobal('open', vi.fn());
      renderMarkdown(<ChatMarkdown text="[open it](/conv/3904)" />, { streamdownRenderer: useStreamdown, opener: openMock });

      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'open it' })).toHaveAttribute('data-conversation-id', '3904');
      });
      const link = screen.getByRole('link', { name: 'open it' });
      expect(fireEvent.click(link)).toBe(false);

      expect(openMock).toHaveBeenCalledWith(LISTED);
      expect(window.open).not.toHaveBeenCalled();
    });
  });

  describe('chatmarkdown-wiring.ac5', () => {
    it('renders no link and issues no request outside a transcript context', async () => {
      renderMarkdown(<ChatMarkdown text="Tell 20261113-6031 now" />, { streamdownRenderer: useStreamdown, inConversation: false });

      await waitFor(() => expect(screen.getByText(/20261113-6031/)).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: '20261113-6031' })).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renders no link in a linked transcript', async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <ConversationPullRequestProvider conversation={{ name: '@env-1/20261115-0001' }}>
            {cloneElement(<ChatMarkdown text="conv 3904" />, { useStreamdown })}
          </ConversationPullRequestProvider>
        </QueryClientProvider>,
      );

      await waitFor(() => expect(screen.getByText('conv 3904')).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: 'conv 3904' })).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
