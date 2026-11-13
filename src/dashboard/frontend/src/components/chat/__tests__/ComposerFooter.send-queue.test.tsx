import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';

const { editorState, mockFocus, mockToastError } = vi.hoisted(() => ({
  editorState: { text: '' },
  mockFocus: vi.fn(),
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
      focus: mockFocus,
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

// Deliberately NOT mocking `../../lib/composerDraft` — these tests assert the
// real localStorage draft is cleared on Send (PAN-5184 AC4).

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
};

function messagePosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/message'));
}

describe('ComposerFooter send queue (PAN-5184)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    localStorage.clear();
    editorState.text = '';
    let uuid = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      uuid += 1;
      return `00000000-0000-4000-8000-${String(uuid).padStart(12, '0')}`;
    });
    fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears the editor right after Send while the POST is pending', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/message')) return new Promise<Response>(() => {});
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    const onSend = vi.fn();

    render(<ComposerFooter conversation={conversation} onSend={onSend} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(editorState.text).toBe('');
    expect(screen.getByTestId('composer-editor')).not.toBeDisabled();
  });

  it('accepts a second Send while the first is pending and posts it after the first settles', async () => {
    let resolveFirst: (() => void) | null = null;
    let messageCallCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (!String(input).endsWith('/message')) {
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      messageCallCount += 1;
      if (messageCallCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = () => resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });
      }
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'one' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(1));

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'two' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    // The second Send is accepted into the queue, but its POST waits.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messagePosts(fetchMock)).toHaveLength(1);
    expect(JSON.parse(String(messagePosts(fetchMock)[0]![1]!.body))).toMatchObject({ message: 'one' });

    resolveFirst?.();
    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(2));
    expect(JSON.parse(String(messagePosts(fetchMock)[1]![1]!.body))).toMatchObject({ message: 'two' });
  });

  it('a failed send goes to the outbox and the composer stays empty', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/message')) return Promise.resolve(new Response('server error', { status: 500 }));
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    const onSend = vi.fn((text: string, clientMessageId?: string) => {
      useComposerStore.getState().addOptimistic('test-conv', text, 0, { clientMessageId });
    });
    const onSendFailed = vi.fn((text: string, kind: 'command' | 'prompt', details?: Record<string, unknown>) => {
      useComposerStore.getState().failSend('test-conv', text, kind, details);
    });

    render(<ComposerFooter conversation={conversation} onSend={onSend} onSendFailed={onSendFailed} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(useComposerStore.getState().byConversation['test-conv']?.failed[0]?.text).toBe('hello'));
    expect(editorState.text).toBe('');
  });

  it('text typed during an in-flight send survives the acknowledgement', async () => {
    let resolveFirst: (() => void) | null = null;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/message')) {
        return new Promise<Response>((resolve) => {
          resolveFirst = () => resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });
      }
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'one' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(1));

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'draft two' } });
    resolveFirst?.();
    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editorState.text).toBe('draft two');
  });

  it('the localStorage draft is gone after Send', async () => {
    localStorage.setItem('conv-draft:test-conv', 'hi');
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/message')) return new Promise<Response>(() => {});
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(messagePosts(fetchMock)).toHaveLength(1));
    expect(localStorage.getItem('conv-draft:test-conv')).toBeNull();
  });

  it('a /pan command still disables the composer until its result arrives', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/message')) return new Promise<Response>(() => {});
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: '/pan status' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(screen.getByTestId('composer-editor')).toBeDisabled());
    expect(editorState.text).toBe('/pan status');
  });
});
