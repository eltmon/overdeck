/**
 * PAN-4499 WI-8 — the held-conversation composer. A `--hold` successor shows a
 * waiting notice and seeds the composer with its stored kickoff; Send goes to
 * the kickoff door, never the message route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore } from '../../../lib/composerStore';

const { editorState, rootState, mockToastError } = vi.hoisted(() => ({
  editorState: { text: '' },
  rootState: { paragraphs: [] as string[] },
  mockToastError: vi.fn(),
}));

vi.mock('lexical', () => ({
  $getRoot: () => ({
    getTextContent: () => editorState.text,
    clear: () => {
      editorState.text = '';
      rootState.paragraphs = [];
    },
    append: (paragraph: { text: string }) => {
      rootState.paragraphs.push(paragraph.text);
    },
  }),
  $createParagraphNode: () => {
    const node = { text: '', append: (textNode: { text: string }) => { node.text = textNode.text; } };
    return node;
  },
  $createTextNode: (text: string) => ({ text }),
}));

vi.mock('../ComposerPromptEditor', () => ({
  loadDraft: () => '',
  ComposerPromptEditor: ({ editorRef, onChange, disabled }: { editorRef: { current: unknown }; onChange: (value: string) => void; disabled: boolean }) => {
    editorRef.current = {
      read: (callback: () => void) => callback(),
      update: (callback: () => void) => {
        callback();
        // A programmatic update (e.g. seeding the kickoff) re-renders the
        // composer's own text mirror, same as Lexical's OnChangePlugin would.
        editorState.text = rootState.paragraphs.join('\n');
        onChange(editorState.text);
      },
      focus: vi.fn(),
    };
    return (
      <textarea
        aria-label="Composer editor"
        data-testid="composer-editor"
        disabled={disabled}
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
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../Settings/modelCatalog', () => ({
  modelSupportsImages: vi.fn(() => true),
  findModelDef: vi.fn(() => ({ name: 'Claude Sonnet 4.6' })),
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

const conversation = {
  id: 1,
  name: 'held-conv',
  tmuxSession: 'conv-held-conv',
  status: 'active' as const,
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-04-18T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Held Conversation',
  model: 'claude-sonnet-4-6',
  effort: 'medium',
};

const KICKOFF_TEXT = 'line one\nline two';

function kickoffGetResponse() {
  return new Response(JSON.stringify({ held: true, text: KICKOFF_TEXT }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function messagePosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/message'));
}

function kickoffPosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input], index) => String(input).endsWith('/kickoff') && String(fetchMock.mock.calls[index]?.[1]?.method ?? 'GET').toUpperCase() === 'POST');
}

describe('held conversation composer (PAN-4499 WI-8)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    editorState.text = '';
    rootState.paragraphs = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the waiting notice and seeds the composer with the kickoff', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/kickoff') ? kickoffGetResponse() : new Response('{}', { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);

    render(<ComposerFooter conversation={conversation} />);

    await waitFor(() => expect(screen.getByTestId('held-kickoff-notice')).toBeInTheDocument());
    expect(screen.getByTestId('held-kickoff-notice')).toHaveTextContent('Waiting to start');
    await waitFor(() => expect(rootState.paragraphs).toEqual(['line one', 'line two']));

    vi.unstubAllGlobals();
  });

  it('Send on a held conversation posts to the kickoff door, not the message route', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/kickoff') && (init?.method ?? 'GET').toUpperCase() === 'GET') return kickoffGetResponse();
      if (url.endsWith('/kickoff') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, conversation: { ...conversation, forkStatus: 'spawning' } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ComposerFooter conversation={conversation} />);
    await waitFor(() => expect(screen.getByTestId('held-kickoff-notice')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(kickoffPosts(fetchMock)).toHaveLength(1));
    expect(messagePosts(fetchMock)).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('an unchanged kickoff posts no text; an edited one posts the edited text', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/kickoff') && (init?.method ?? 'GET').toUpperCase() === 'GET') return kickoffGetResponse();
      if (url.endsWith('/kickoff') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, conversation: { ...conversation, forkStatus: 'spawning' } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ComposerFooter conversation={conversation} />);
    await waitFor(() => expect(screen.getByTestId('held-kickoff-notice')).toBeInTheDocument());
    await waitFor(() => expect(rootState.paragraphs).toEqual(['line one', 'line two']));

    // Unchanged (whitespace-collapsed-equal to the kickoff): no edited text in the body.
    editorState.text = KICKOFF_TEXT;
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: KICKOFF_TEXT } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => expect(kickoffPosts(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(kickoffPosts(fetchMock)[0]?.[1]?.body))).toEqual({});

    vi.unstubAllGlobals();
  });

  it('an edited kickoff posts the edited text', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/kickoff') && (init?.method ?? 'GET').toUpperCase() === 'GET') return kickoffGetResponse();
      if (url.endsWith('/kickoff') && init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, conversation: { ...conversation, forkStatus: 'spawning' } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ComposerFooter conversation={conversation} />);
    await waitFor(() => expect(screen.getByTestId('held-kickoff-notice')).toBeInTheDocument());
    await waitFor(() => expect(rootState.paragraphs).toEqual(['line one', 'line two']));

    editorState.text = 'a brand new kickoff';
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'a brand new kickoff' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => expect(kickoffPosts(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(kickoffPosts(fetchMock)[0]?.[1]?.body))).toEqual({ text: 'a brand new kickoff' });

    vi.unstubAllGlobals();
  });

  it('a 409 shows the already-started toast', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/kickoff') && (init?.method ?? 'GET').toUpperCase() === 'GET') return kickoffGetResponse();
      if (url.endsWith('/kickoff') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'No held kickoff: the conversation was already started or was never held' }), { status: 409 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ComposerFooter conversation={conversation} />);
    await waitFor(() => expect(screen.getByTestId('held-kickoff-notice')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('This conversation was already started'));

    vi.unstubAllGlobals();
  });
});
