/**
 * PAN-4641 WI-13: the composer offers "When limits reset" and, while the
 * conversation is stopped on a usage limit, a notice whose button queues the
 * typed message on the server and clears the editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore } from '../../../lib/composerStore';

const { editorState, mockToastError } = vi.hoisted(() => ({
  editorState: { text: '' },
  mockToastError: vi.fn(),
}));

vi.mock('lexical', () => ({
  $getRoot: () => ({
    getTextContent: () => editorState.text,
    clear: () => {
      editorState.text = '';
    },
  }),
}));

vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ editorRef, onChange, disabled }: { editorRef: { current: unknown }; onChange: (value: string) => void; disabled: boolean }) => {
    editorRef.current = {
      read: (callback: () => void) => callback(),
      update: (callback: () => void) => callback(),
      focus: vi.fn(),
    };
    return (
      <textarea
        aria-label="Composer editor"
        data-testid="composer-editor"
        disabled={disabled}
        value={editorState.text}
        onChange={(event) => {
          editorState.text = event.target.value;
          onChange(event.target.value);
        }}
      />
    );
  },
}));

vi.mock('../ModelPicker', () => ({
  ModelPicker: ({ value }: { value: string }) => <div data-testid="model-picker">{value}</div>,
  MODEL_EFFORT_SUPPORT: { 'claude-sonnet-4-6': ['low', 'medium', 'high'] },
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: vi.fn(),
  saveStoredModel: vi.fn(),
}));

vi.mock('../defaultConversationModel', () => ({
  getDefaultConversationModel: () => 'claude-sonnet-4-6',
}));

vi.mock('../EffortPicker', () => ({
  EffortPicker: ({ value }: { value: string }) => <button type="button" data-testid="effort-picker">{value}</button>,
  loadStoredEffort: () => 'medium',
}));

vi.mock('../VoiceWidget', () => ({
  VoiceWidget: () => <div data-testid="voice-widget" />,
}));

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../Settings/modelCatalog', () => ({
  modelSupportsImages: vi.fn(() => true),
  findModelDef: vi.fn(() => ({ name: 'Claude Sonnet 4.6' })),
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function conversationNamed(name: string) {
  return {
    id: 1,
    name,
    tmuxSession: `conv-${name}`,
    status: 'active' as const,
    cwd: '/tmp/project',
    issueId: null,
    createdAt: '2026-04-18T00:00:00Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
    title: 'Limited Conversation',
    model: 'claude-sonnet-4-6',
    effort: 'medium',
    harness: 'claude-code' as const,
  };
}

const RESETS_AT = new Date(Date.now() + 3 * 60 * 60_000).toISOString();

function stubServer(scheduled: { supported: boolean; limited: boolean }) {
  const posts: Array<{ url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/scheduled-messages') && method === 'GET') {
      return Response.json({
        supported: scheduled.supported,
        limit: scheduled.limited
          ? { limited: true, resetsAt: RESETS_AT, window: 'five_hour', source: 'quota-limits', errorAt: new Date().toISOString() }
          : null,
        messages: [],
      });
    }
    if (url.endsWith('/scheduled-messages') && method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ message: { id: 1 }, limit: null }, { status: 201 });
    }
    if (url.endsWith('/kickoff')) return Response.json({ held: false });
    if (url.startsWith('/api/effort/default')) return Response.json({ effort: 'high', source: 'default', requested: 'high', clamped: false });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, posts };
}

describe('ComposerFooter: send when limits reset (PAN-4641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    editorState.text = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the limit notice and the "When limits reset" option while limited', async () => {
    stubServer({ supported: true, limited: true });
    render(<ComposerFooter conversation={conversationNamed('limited-a')} />);

    const notice = await screen.findByTestId('limit-reset-notice');
    expect(notice).toHaveTextContent(/Your 5-hour limit resets at about \d{2}:\d{2}\./);
    expect(screen.getByRole('button', { name: 'Send when limits reset' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'When limits reset' })).toBeInTheDocument();
  });

  it('the notice button POSTs the typed text and clears the editor', async () => {
    const { posts } = stubServer({ supported: true, limited: true });
    const onSend = vi.fn();
    render(<ComposerFooter conversation={conversationNamed('limited-b')} onSend={onSend} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'pick up where you left off' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Send when limits reset' }));

    await waitFor(() => expect(posts).toEqual([
      { url: '/api/conversations/limited-b/scheduled-messages', body: { message: 'pick up where you left off' } },
    ]));
    await waitFor(() => expect(editorState.text).toBe(''));
    expect(onSend).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('choosing "When limits reset" in the selector queues instead of sending', async () => {
    const { posts, fetchMock } = stubServer({ supported: true, limited: false });
    render(<ComposerFooter conversation={conversationNamed('limited-c')} />);
    await screen.findByRole('option', { name: 'When limits reset' });
    fireEvent.change(screen.getByLabelText('Delivery mode'), { target: { value: 'when_limit_resets' } });
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'later please' } });

    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toEqual({ message: 'later please' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/message'))).toBe(false);
  });

  it('shows neither the option nor the notice when scheduling is unsupported', async () => {
    const { fetchMock } = stubServer({ supported: false, limited: true });
    render(<ComposerFooter conversation={conversationNamed('limited-d')} />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/scheduled-messages'))).toBe(true));

    expect(screen.queryByRole('option', { name: 'When limits reset' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('limit-reset-notice')).not.toBeInTheDocument();
  });
});
