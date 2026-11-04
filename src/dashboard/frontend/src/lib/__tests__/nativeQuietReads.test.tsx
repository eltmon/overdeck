/**
 * PAN-4837 WI-17c: in the phone app transcript rendering reads nothing the
 * phone token cannot call (settings, file-path lookups) and offers no
 * bookmark, Compare or pull-request link editing. Outside the app each still
 * renders or requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const transport = vi.hoisted(() => ({ request: vi.fn(async () => ({ exists: true, kind: 'file' })) }));
vi.mock('../wsTransport', () => ({ getTransport: () => transport }));

import { ChatMarkdownSettingsProvider } from '../../components/chat/ChatMarkdown';
import { DiffPanel } from '../../components/DiffPanel';
import { ConversationBookmarksProvider } from '../../components/chat/bookmarks/ConversationBookmarks';
import { MessageRoleIcon } from '../../components/chat/bookmarks/MessageRoleIcon';
import type { ChatMessage } from '../../components/chat/chat-types';
import { useFilePathExists } from '../../hooks/useFilePathExists';

const native = globalThis as { __OVERDECK_NATIVE__?: boolean };
let clients: QueryClient[] = [];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const fetched = (): string[] => vi.mocked(fetch).mock.calls.map(([input]) => String(input));

const message = { id: 'm-1', role: 'assistant', text: 'hello', createdAt: '2026-11-03T00:00:00Z' } as unknown as ChatMessage;

beforeEach(() => {
  transport.request.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/bookmarks')) return Response.json({ bookmarks: [] });
    if (url.startsWith('/api/diffs/refs')) return Response.json({ branches: [], tags: [], commits: [] });
    if (url === '/api/settings') return Response.json({ experimental: {} });
    return Response.json({ files: [] });
  }));
});

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients = [];
  delete native.__OVERDECK_NATIVE__;
  vi.unstubAllGlobals();
});

describe.each([
  ['in the phone app', true],
  ['outside the phone app', false],
])('transcript reads %s (PAN-4837)', (_label, isNative) => {
  beforeEach(() => {
    if (isNative) native.__OVERDECK_NATIVE__ = true;
  });

  it(isNative ? 'skips the settings read for rendered markdown' : 'reads settings for rendered markdown', async () => {
    render(<ChatMarkdownSettingsProvider><p>message</p></ChatMarkdownSettingsProvider>, { wrapper });
    if (isNative) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetched()).not.toContain('/api/settings');
    } else {
      await waitFor(() => expect(fetched()).toContain('/api/settings'));
    }
  });

  it(isNative ? 'resolves file paths without an RPC' : 'resolves file paths over RPC', async () => {
    const { result } = renderHook(() => useFilePathExists('/home/user/project', `src/native-${String(isNative)}.ts`));
    if (isNative) {
      expect(result.current).toEqual({ state: 'missing' });
      expect(transport.request).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(transport.request).toHaveBeenCalledTimes(1));
    }
  });

  it(isNative ? 'shows no bookmark control' : 'shows the bookmark control', () => {
    render(
      <ConversationBookmarksProvider conversationName="conv-1">
        <MessageRoleIcon message={message} role="assistant" bookmarkable />
      </ConversationBookmarksProvider>,
      { wrapper },
    );
    const control = screen.queryByRole('button', { name: 'Bookmark this message' });
    if (isNative) expect(control).toBeNull();
    else expect(control).not.toBeNull();
  });

  it(isNative ? 'hides the Compare chip' : 'shows the Compare chip', () => {
    render(
      <DiffPanel mode="inline" agentId="conv-1" turnDiffSummaries={[]} diffUrlPrefix="/api/conversations/conv-1/diffs" repoPath="/repo/path" />,
      { wrapper },
    );
    if (isNative) expect(screen.queryByText('Compare…')).toBeNull();
    else expect(screen.queryByText('Compare…')).not.toBeNull();
  });
});
