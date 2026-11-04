import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore, useComposerStore } from '../../../lib/composerStore';
import { addCitation, getConversationCitations, resetCitationStore } from '../../../lib/composerCitations';
import { CITATION_BLOCK_HEADER } from '../../../lib/citationFormat';

const { editorState, mockFocus } = vi.hoisted(() => ({
  editorState: { text: '', onCommandKeyDown: null as null | ((key: 'Enter' | 'SteerEnter') => void) },
  mockFocus: vi.fn(),
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
  ComposerPromptEditor: ({ editorRef, onChange, disabled, onCommandKeyDown }: { editorRef: { current: unknown }; onChange: (value: string) => void; disabled: boolean; onCommandKeyDown: (key: 'Enter' | 'SteerEnter') => void }) => {
    editorState.onCommandKeyDown = onCommandKeyDown;
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
  EffortPicker: () => <button type="button" data-testid="effort-picker" />,
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
};

const SOURCE = { kind: 'message' as const, messageId: 'asst-1', role: 'assistant' as const };

const EXPECTED_FIXTURE = [
  CITATION_BLOCK_HEADER,
  '1. > First line',
  '   > second line',
  "   I don't agree",
  '2. > Use X',
  '',
  'Please revise.',
].join('\n');

function seedFixtureCitations(conversationName: string): void {
  addCitation(conversationName, { source: SOURCE, quotedText: 'First line\nsecond line', comment: "I don't agree" });
  addCitation(conversationName, { source: SOURCE, quotedText: 'Use X', comment: '' });
}

// ComposerFooter's held-kickoff check (`GET .../kickoff`) fires on mount regardless
// of citations, so message-send assertions must find the `/message` call by URL
// rather than assume it is the only (or first) fetch call.
function messageCall(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>): [string, RequestInit] | undefined {
  return fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/message')) as [string, RequestInit] | undefined;
}

function postedMessage(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>): string {
  const call = messageCall(fetchMock);
  const body = JSON.parse(call?.[1]?.body as string) as { message: string };
  return body.message;
}

let idCounter = 0;

describe('ComposerFooter citations (PAN-4642 WI-7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    localStorage.clear();
    resetCitationStore();
    editorState.text = '';
    idCounter = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `id-${idCounter++}` as unknown as `${string}-${string}-${string}-${string}-${string}`);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('prepends two citations in order and clears the chips store on a successful send', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    seedFixtureCitations(conversation.name);

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'Please revise.' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(messageCall(fetchMock)).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/test-conv/message', expect.objectContaining({ method: 'POST' }));
    expect(postedMessage(fetchMock)).toBe(EXPECTED_FIXTURE);
    expect(getConversationCitations(conversation.name)).toEqual([]);
  });

  it('omits a removed citation from the posted message', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    seedFixtureCitations(conversation.name);

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove citation' })[0]!);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'Please revise.' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(messageCall(fetchMock)).toBeDefined());
    const message = postedMessage(fetchMock);
    expect(message).not.toContain('First line');
    expect(message).toContain('1. > Use X');
  });

  it('posts an identical message across claude-code, codex and ohmypi harnesses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const posted: string[] = [];
    for (const harness of ['claude-code', 'codex', 'ohmypi'] as const) {
      fetchMock.mockClear();
      seedFixtureCitations(conversation.name);
      const view = render(<ComposerFooter conversation={{ ...conversation, harness }} />);
      fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'Please revise.' } });
      fireEvent.click(screen.getByTitle('Send message (Enter)'));
      await waitFor(() => expect(messageCall(fetchMock)).toBeDefined());
      posted.push(postedMessage(fetchMock));
      view.unmount();
    }

    expect(posted[0]).toBe(EXPECTED_FIXTURE);
    expect(new Set(posted).size).toBe(1);
  });

  it('on a failed send, onSendFailed receives the citation block and the store is cleared', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
    seedFixtureCitations(conversation.name);
    const onSendFailed = vi.fn();

    render(<ComposerFooter conversation={conversation} onSendFailed={onSendFailed} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'Please revise.' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(onSendFailed).toHaveBeenCalled());
    const [failedText, kind] = onSendFailed.mock.calls[0]!;
    expect(failedText).toContain(CITATION_BLOCK_HEADER);
    expect(failedText).toBe(EXPECTED_FIXTURE);
    expect(kind).toBe('prompt');
    expect(getConversationCitations(conversation.name)).toEqual([]);

    // composerStore.retryFailed resends the same (citation-laden) text.
    useComposerStore.getState().failSend(conversation.name, failedText, 'prompt');
    const failedId = useComposerStore.getState().byConversation[conversation.name]!.failed[0]!.id;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await useComposerStore.getState().retryFailed(conversation.name, failedId, failedText, 0);

    expect(postedMessage(fetchMock)).toBe(EXPECTED_FIXTURE);
  });

  it('leaves a citation pending when the typed text is a slash command', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    addCitation(conversation.name, { source: SOURCE, quotedText: 'Use X', comment: '' });

    render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: '/compact' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(messageCall(fetchMock)).toBeDefined());
    expect(postedMessage(fetchMock)).toBe('/compact');
    expect(getConversationCitations(conversation.name)).toHaveLength(1);
  });

  it('sends the bare citation block when the editor is empty', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    addCitation(conversation.name, { source: SOURCE, quotedText: 'Use X', comment: '' });

    render(<ComposerFooter conversation={conversation} />);
    expect(screen.getByTitle('Send message (Enter)')).not.toBeDisabled();
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(messageCall(fetchMock)).toBeDefined());
    expect(postedMessage(fetchMock)).toBe(`${CITATION_BLOCK_HEADER}\n1. > Use X`);
  });
});
