/**
 * PAN-5353: Ctrl/Cmd+Enter on an empty Claude Code composer presses
 * Send now instead of steering a plain submit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';

const { editorState, mockSendNowQueued } = vi.hoisted(() => ({
  editorState: { text: '', onCommandKeyDown: null as null | ((key: 'Enter' | 'SteerEnter') => void) },
  mockSendNowQueued: vi.fn(async (_name: string, _agentId?: string) => {}),
}));

vi.mock('../../../lib/composerSendNow', () => ({ sendNowQueued: mockSendNowQueued }));

vi.mock('lexical', () => ({
  $getRoot: () => ({
    getTextContent: () => editorState.text,
    clear: () => {
      editorState.text = '';
    },
  }),
}));

vi.mock('../ComposerPromptEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ComposerPromptEditor')>();
  return {
    loadDraft: actual.loadDraft,
    ComposerPromptEditor: ({ editorRef, onChange, disabled, onCommandKeyDown, conversationName }: {
      editorRef: { current: unknown };
      onChange: (value: string) => void;
      disabled: boolean;
      onCommandKeyDown: (key: 'Enter' | 'SteerEnter') => void;
      conversationName: string;
    }) => {
      // The real editor seeds itself from the saved draft on mount; this mock
      // mirrors that so a draft written before render is what a key-time read sees.
      if (editorState.text === '') editorState.text = actual.loadDraft(conversationName);
      editorState.onCommandKeyDown = onCommandKeyDown;
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
  };
});

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
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
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
  name: 'test-conv',
  tmuxSession: 'conv-test-conv',
  status: 'active' as const,
  cwd: '/tmp/project',
  issueId: null,
  createdAt: '2026-04-18T00:00:00Z',
  endedAt: null,
  lastAttachedAt: null,
  sessionAlive: true,
  title: 'Test Conversation',
  model: 'claude-sonnet-4-6',
  effort: 'medium',
  harness: 'claude-code' as const,
};

function messagePosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/message'));
}

describe('Ctrl+Enter on an empty composer presses Send now (PAN-5353)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    localStorage.clear();
    editorState.text = '';
    editorState.onCommandKeyDown = null;
    mockSendNowQueued.mockClear();
    mockSendNowQueued.mockResolvedValue(undefined);
    fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('(a) empty Claude Code composer: Ctrl+Enter calls sendNowQueued once, no /message fetch', async () => {
    render(<ComposerFooter conversation={conversation} />);
    editorState.onCommandKeyDown?.('SteerEnter');

    await waitFor(() => expect(mockSendNowQueued).toHaveBeenCalledTimes(1));
    expect(mockSendNowQueued).toHaveBeenCalledWith('test-conv', undefined);
    expect(messagePosts(fetchMock)).toHaveLength(0);
  });

  it('(b) composer holds text: Ctrl+Enter steers, no sendNowQueued', async () => {
    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello' } });
    editorState.onCommandKeyDown?.('SteerEnter');

    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(1));
    expect(mockSendNowQueued).not.toHaveBeenCalled();
    expect(JSON.parse(String(messagePosts(fetchMock)[0]![1]!.body))).toMatchObject({ message: 'hello', deliverAs: 'steer' });
  });

  it('(c) codex conversation, empty composer: Ctrl+Enter calls neither sendNowQueued nor a /message fetch', async () => {
    render(<ComposerFooter conversation={{ ...conversation, harness: 'codex' as const }} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fetchMock.mockClear();

    editorState.onCommandKeyDown?.('SteerEnter');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSendNowQueued).not.toHaveBeenCalled();
    expect(messagePosts(fetchMock)).toHaveLength(0);
  });

  it('(d) Claude Code with an uploading attachment and no text: sendNowQueued is not called', async () => {
    const file = new File(['png-bytes'], 'paste.png', { type: 'image/png' });
    useComposerStore.getState().enqueueAttachments(conversation.name, [file]);

    render(<ComposerFooter conversation={conversation} />);
    editorState.onCommandKeyDown?.('SteerEnter');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSendNowQueued).not.toHaveBeenCalled();
  });

  it('(e) a restored draft: Ctrl+Enter does not call sendNowQueued and sends a steer POST containing the draft', async () => {
    localStorage.setItem('conv-draft:test-conv', 'restored text');

    render(<ComposerFooter conversation={conversation} />);
    editorState.onCommandKeyDown?.('SteerEnter');

    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(1));
    expect(mockSendNowQueued).not.toHaveBeenCalled();
    expect(JSON.parse(String(messagePosts(fetchMock)[0]![1]!.body))).toMatchObject({ message: 'restored text', deliverAs: 'steer' });
  });
});
