/**
 * PAN-4837 WI-17a: in the phone app the conversation header and ⋮ menu hide
 * every control whose route the phone token cannot call; "Stop agent" stays.
 * Outside the app every control renders as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { ConversationPanel } from '../ConversationPanel';

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => ({
    request: () => new Promise(() => {}),
    subscribe: (createStream: (client: unknown) => unknown, listener: (event: unknown) => void) => {
      createStream(new Proxy({}, { get: () => () => ({}) }));
      listener({ kind: 'messages', snapshot: true, messages: [], workLog: [], streaming: false });
      return vi.fn();
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../DialogProvider', () => ({
  DialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirm: () => vi.fn().mockResolvedValue(true),
  useAlert: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../XTerminal', () => ({ XTerminal: () => <div data-testid="xterminal" /> }));
vi.mock('../MessagesTimeline', () => ({ MessagesTimeline: () => null }));
vi.mock('../../DiffWorkerPoolProvider', () => ({
  DiffWorkerPoolProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../DiffPanel', () => ({ DiffPanel: () => <div data-testid="diff-panel" /> }));
vi.mock('../ComposerFooter', () => ({ ComposerFooter: () => <div data-testid="composer-footer" /> }));
vi.mock('../../PanOpenInPicker', () => ({ PanOpenInPicker: () => <div data-testid="open-in-picker" /> }));

const native = globalThis as { __OVERDECK_NATIVE__?: boolean };

const conversation: React.ComponentProps<typeof ConversationPanel>['conversation'] = {
  id: 1,
  name: 'test-conv',
  tmuxSession: 'test-session',
  status: 'running' as const,
  cwd: '/home/user',
  issueId: null,
  createdAt: '2024-01-01T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'My Panel Title',
  model: 'claude-opus-4-6',
};

function defaultResponse(method: string, url: string): Response | undefined {
  if (method === 'POST' && url === 'http://localhost:3000/api/dashboard/session') return Response.json({ csrfToken: 'csrf' });
  if (method === 'GET' && /^\/api\/conversations\/test-conv\/diffs$/.test(url)) return Response.json({ summaries: [] });
  if (method === 'GET' && url.endsWith('/api/conversations/pending-input')) return Response.json([]);
  if (method === 'GET' && /^\/api\/conversations\/[^/]+\/kickoff$/.test(url)) return Response.json({ held: false });
  if (method === 'GET' && /^\/api\/conversations\/[^/]+\/bookmarks$/.test(url)) return Response.json({ bookmarks: [] });
  if (method === 'GET' && /^\/api\/conversations\/[^/]+\/scheduled-messages$/.test(url)) {
    return Response.json({ supported: true, limit: null, messages: [] });
  }
  return undefined;
}

let client: QueryClient;
let fetchControl: ReturnType<typeof installStrictFetchMock>;

function renderPanel() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(['conversation-messages', 'test-conv'], { messages: [], workLog: [], streaming: false });
  return render(
    <QueryClientProvider client={client}>
      <ConversationPanel conversation={conversation} viewMode="conversation" onArchived={() => {}} />
    </QueryClientProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More conversation actions' }));
  return screen.getByRole('menu', { name: 'Conversation actions' });
}

describe('ConversationPanel in the phone app (PAN-4837)', () => {
  beforeEach(() => {
    fetchControl = installStrictFetchMock(({ method, url }) => defaultResponse(method, url));
    localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    await client.cancelQueries();
    client.clear();
    await fetchControl.assertNoUnexpectedRequests();
    delete native.__OVERDECK_NATIVE__;
    localStorage.clear();
  });

  it('keeps Stop agent and hides every admin action, the rename pencil and the open-in picker', () => {
    native.__OVERDECK_NATIVE__ = true;
    renderPanel();
    const menu = openMenu();
    expect(menu.textContent).toContain('Stop agent');
    for (const label of ['Favorite', 'Regenerate title', 'Share', 'Archive conversation', 'Export transcript']) {
      expect(menu.textContent).not.toContain(label);
    }
    expect(screen.queryByRole('button', { name: 'Rename test-conv' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('open-in-picker')).not.toBeInTheDocument();
  });

  it('shows every action outside the phone app', () => {
    renderPanel();
    const menu = openMenu();
    for (const label of ['Stop agent', 'Favorite', 'Regenerate title', 'Archive conversation', 'Export transcript']) {
      expect(menu.textContent).toContain(label);
    }
    expect(screen.getByRole('button', { name: 'Rename test-conv' })).toBeInTheDocument();
    expect(screen.getByTestId('open-in-picker')).toBeInTheDocument();
  });
});
