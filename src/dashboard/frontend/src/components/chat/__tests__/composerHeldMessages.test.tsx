/**
 * PAN-4279 WI-7 — held composer messages. A prompt submitted while the server
 * is unreachable is held (never POSTed) and sent once the phase returns to
 * `live`; a `/pan` command keeps its draft instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { useComposerDeliveryState } from '../useComposerDeliveryState';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';
import { useConnectionState } from '../../../lib/connectionState';

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

const UNREACHABLE = { serverReachable: false, streamLive: false, restarting: false };
const LIVE = { serverReachable: true, streamLive: true, restarting: false };

function messagePosts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/message'));
}

function heldEntries() {
  return (useComposerStore.getState().byConversation[conversation.name]?.failed ?? []).filter((f) => f.heldOffline);
}

describe('held composer messages (PAN-4279)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
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
    useConnectionState.setState({ serverReachable: true, streamLive: false, restarting: false });
  });

  it('holds a prompt submitted while unreachable: no POST, editor cleared', async () => {
    useConnectionState.setState(UNREACHABLE);
    const onSend = vi.fn();
    render(<ComposerFooter conversation={conversation} onSend={onSend} />);

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'held ping' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(heldEntries()).toHaveLength(1));
    expect(heldEntries()[0]).toMatchObject({ text: 'held ping', kind: 'prompt', clientMessageId: '00000000-0000-4000-8000-000000000001' });
    expect(messagePosts(fetchMock)).toHaveLength(0);
    expect(onSend).not.toHaveBeenCalled();
    expect(editorState.text).toBe('');
  });

  it('keeps a /pan command draft and explains that commands need a live connection', async () => {
    useConnectionState.setState(UNREACHABLE);
    render(<ComposerFooter conversation={conversation} />);

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: '/pan status' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Can't reach the Overdeck server — commands need a live connection"));
    expect(messagePosts(fetchMock)).toHaveLength(0);
    expect(heldEntries()).toHaveLength(0);
    expect(editorState.text).toBe('/pan status');
  });

  it('sends held messages once, oldest first, when the phase returns to live', async () => {
    useConnectionState.setState(UNREACHABLE);
    const { holdSend } = useComposerStore.getState();
    holdSend(conversation.name, 'first held', { clientMessageId: 'client-1' });
    holdSend(conversation.name, 'second held', { clientMessageId: 'client-2' });

    renderHook(() => useComposerDeliveryState({ conversation, serverBaseCount: 0 }));
    renderHook(() => useComposerDeliveryState({ conversation, serverBaseCount: 0 }));
    expect(messagePosts(fetchMock)).toHaveLength(0);

    act(() => {
      useConnectionState.setState(LIVE);
    });

    await waitFor(() => expect(heldEntries()).toHaveLength(0));
    const posts = messagePosts(fetchMock);
    expect(posts).toHaveLength(2);
    expect(posts.map(([input]) => String(input))).toEqual([
      '/api/conversations/test-conv/message',
      '/api/conversations/test-conv/message',
    ]);
    expect(posts.map(([, init]) => JSON.parse(String((init as RequestInit).body)))).toEqual([
      { message: 'first held', clientMessageId: 'client-1' },
      { message: 'second held', clientMessageId: 'client-2' },
    ]);
  });

  it('does not send held messages while the server stays unreachable', async () => {
    useConnectionState.setState(UNREACHABLE);
    useComposerStore.getState().holdSend(conversation.name, 'held ping', { clientMessageId: 'client-1' });

    renderHook(() => useComposerDeliveryState({ conversation, serverBaseCount: 0 }));
    act(() => {
      useConnectionState.setState({ serverReachable: true, streamLive: false });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(messagePosts(fetchMock)).toHaveLength(0);
    expect(heldEntries()).toHaveLength(1);
  });
});
