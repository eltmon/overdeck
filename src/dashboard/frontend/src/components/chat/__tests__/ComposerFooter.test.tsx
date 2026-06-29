import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';
import { resetComposerStore } from '../../../lib/composerStore';

const { editorState, mockFocus, mockToastError, mockSaveStoredModel, voiceWidgetRenders } = vi.hoisted(() => ({
  editorState: { text: '' },
  mockFocus: vi.fn(),
  mockToastError: vi.fn(),
  mockSaveStoredModel: vi.fn(),
  voiceWidgetRenders: [] as Array<{ autoStartToken?: number }>,
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
  ComposerPromptEditor: ({ editorRef, onChange, disabled, onPaste }: { editorRef: { current: unknown }; onChange: (value: string) => void; disabled: boolean; onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void }) => {
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
        onPaste={onPaste}
      />
    );
  },
}));

vi.mock('../ModelPicker', () => ({
  ModelPicker: ({ value }: { value: string }) => <div data-testid="model-picker">{value}</div>,
  MODEL_EFFORT_SUPPORT: { 'claude-sonnet-4-6': ['low', 'medium', 'high'] },
  loadStoredHarness: () => 'claude-code',
  saveStoredHarness: vi.fn(),
  saveStoredModel: (...args: unknown[]) => mockSaveStoredModel(...args),
}));

vi.mock('../defaultConversationModel', () => ({
  getDefaultConversationModel: () => 'claude-sonnet-4-6',
}));

vi.mock('../EffortPicker', () => ({
  EffortPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <button type="button" data-testid="effort-picker" onClick={() => onChange('high')}>{value}</button>
  ),
  loadStoredEffort: () => 'medium',
}));

vi.mock('../VoiceWidget', () => ({
  VoiceWidget: (props: { autoStartToken?: number }) => {
    voiceWidgetRenders.push(props);
    return <div data-testid="voice-widget" data-auto-start-token={props.autoStartToken ?? 0} />;
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
    warning: vi.fn(),
  },
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

const secondConversation = {
  ...conversation,
  id: 2,
  name: 'other-conv',
  tmuxSession: 'conv-other-conv',
  title: 'Other Conversation',
};

describe('ComposerFooter image attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetComposerStore();
    voiceWidgetRenders.length = 0;
    editorState.text = '';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('image-1');
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:preview-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uploads pasted images and sends their server paths with the message', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response(JSON.stringify({ path: '/tmp/overdeck-paste-uploaded.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/message')) {
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const onSend = vi.fn();
    render(<ComposerFooter conversation={conversation} onSend={onSend} />);

    const file = new File(['png-bytes'], 'paste.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
    });

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello world' } });
    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/upload-image',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/message',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: '@/tmp/overdeck-paste-uploaded.png\nhello world' }),
        }),
      );
    });
    expect(onSend).toHaveBeenCalledWith('@/tmp/overdeck-paste-uploaded.png\nhello world');
    expect(screen.queryByText('paste.png')).not.toBeInTheDocument();
  });

  it('opens voice input and starts recording with Ctrl+Shift+M', async () => {
    render(<ComposerFooter conversation={conversation} />);

    fireEvent.keyDown(window, { key: 'M', ctrlKey: true, shiftKey: true });

    const widget = await screen.findByTestId('voice-widget');
    expect(widget).toHaveAttribute('data-auto-start-token', '1');
    expect(voiceWidgetRenders.at(-1)?.autoStartToken).toBe(1);
  });

  it('uploads dropped images through the same endpoint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ path: '/tmp/overdeck-paste-dropped.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'drop.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    });

    fireEvent.drop(screen.getByTestId('composer-editor'), {
      dataTransfer: {
        files: [file],
        items: [{ type: 'image/png' }],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/upload-image',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('drop.png')).toBeInTheDocument();
  });

  it('deletes uploaded images when the user removes them before sending', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response(JSON.stringify({ path: '/tmp/overdeck-paste-uploaded.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/delete-image')) {
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'remove-me.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
    });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('remove-me.png')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Remove remove-me.png'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/delete-image',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/tmp/overdeck-paste-uploaded.png' }),
        }),
      );
    });
    expect(screen.queryByText('remove-me.png')).not.toBeInTheDocument();
  });

  it('persists pasted images per-conversation across switches without remounting', async () => {
    // Images are keyed per-conversation (like drafts). Switching away must
    // hide — not discard — the pasted image: no delete-image call fires, and
    // switching back reveals it again. ComposerFooter is reused across
    // conversation switches (no remount), so this exercises the persistence
    // contract directly.
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response(JSON.stringify({ path: '/tmp/overdeck-paste-switched.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/delete-image')) {
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const view = render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'switch-me.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('switch-me.png')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    // Switch to another conversation — the image is hidden, not deleted.
    view.rerender(<ComposerFooter conversation={secondConversation} />);
    expect(screen.queryByText('switch-me.png')).not.toBeInTheDocument();

    // Switch back — the image is still there, having survived the round-trip.
    view.rerender(<ComposerFooter conversation={conversation} />);
    expect(await screen.findByText('switch-me.png')).toBeInTheDocument();

    // No delete-image request was ever made for either conversation.
    const deleteCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/delete-image'));
    expect(deleteCalls).toHaveLength(0);
  });

  it('preserves the editor draft when the conversation prop changes without remounting (deck reuse)', () => {
    // Regression: drafts vanished on navigate-away-and-back. The project-scoped
    // deck reuses ComposerFooter across conversation switches, so the
    // conversation-change effect fires after the keyed LexicalComposer has
    // remounted and reloaded the new conversation's draft. Calling
    // $getRoot().clear() in that effect wiped the just-loaded draft AND the
    // resulting onChange('') deleted it from localStorage. The effect must not
    // touch the editor content on a switch.
    const view = render(<ComposerFooter conversation={conversation} />);

    fireEvent.change(screen.getByTestId('composer-editor'), {
      target: { value: 'half-written message' },
    });
    expect(editorState.text).toBe('half-written message');

    view.rerender(<ComposerFooter conversation={secondConversation} />);

    expect(editorState.text).toBe('half-written message');
  });

  it('keeps pasted images (and their server upload) across a full unmount/remount', async () => {
    // PAN-1591's pane splits unmount the composer on every conversation switch.
    // Pasted images live in the module-level composerStore, so unmounting must
    // NOT delete the server upload, and remounting the same conversation must
    // show the image again — the durability contract that makes images behave
    // like drafts.
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response(JSON.stringify({ path: '/tmp/overdeck-paste-abandoned.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/delete-image')) {
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const view = render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'abandon.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('abandon.png')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    // Unmount == switching to another pane. The image must survive, not delete.
    view.unmount();

    // Remount the same conversation == switching back. The image is still there.
    render(<ComposerFooter conversation={conversation} />);
    expect(await screen.findByText('abandon.png')).toBeInTheDocument();

    const deleteCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/delete-image'));
    expect(deleteCalls).toHaveLength(0);
  });

  it('keeps the Sending state across unmount/remount and never leaks it to another conversation', async () => {
    // The user's report: send a message, switch away and back, and "Sending…"
    // is gone. PAN-1591 unmounts the composer on switch, so a component-local
    // flag could not survive. Sourcing it from the per-conversation composerStore
    // makes it survive a remount of the same conversation — and stay isolated
    // from any other conversation.
    const fetchMock = vi.mocked(fetch);
    let resolveSend: (() => void) | null = null;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/message')) {
        return new Promise<Response>((resolve) => {
          resolveSend = () => resolve(new Response('{}', { status: 200 }));
        });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const view = render(<ComposerFooter conversation={conversation} />);
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hi there' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    // Send is in flight → the composer is disabled.
    await waitFor(() => {
      expect(screen.getByTestId('composer-editor')).toBeDisabled();
    });

    // Switch away and back (full unmount/remount): still sending.
    view.unmount();
    const back = render(<ComposerFooter conversation={conversation} />);
    expect(screen.getByTestId('composer-editor')).toBeDisabled();
    back.unmount();

    // A different conversation must NOT inherit the sending state.
    render(<ComposerFooter conversation={secondConversation} />);
    expect(screen.getByTestId('composer-editor')).not.toBeDisabled();

    // Let the in-flight send settle so it doesn't leak into the next test.
    resolveSend?.();
    await waitFor(() => {
      expect(screen.getByTestId('composer-editor')).not.toBeDisabled();
    });
  });

  it('includes the selected pi delivery mode in message sends', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const onSendAcknowledged = vi.fn();
    const piConversation = { ...conversation, harness: 'pi' as const };

    render(<ComposerFooter conversation={piConversation} agentBusy onSendAcknowledged={onSendAcknowledged} />);

    fireEvent.change(screen.getByLabelText('Pi delivery mode'), { target: { value: 'follow_up' } });
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello pi' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(onSendAcknowledged).toHaveBeenCalledWith('hello pi'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/test-conv/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'hello pi', deliverAs: 'follow_up' }),
      }),
    );
  });

  it('omits pi delivery mode for idle sends so the server uses prompt delivery', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const onSendAcknowledged = vi.fn();
    const piConversation = { ...conversation, harness: 'pi' as const };

    render(<ComposerFooter conversation={piConversation} onSendAcknowledged={onSendAcknowledged} />);

    expect(screen.getByLabelText('Pi delivery mode')).toHaveValue('auto');
    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello pi' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    await waitFor(() => expect(onSendAcknowledged).toHaveBeenCalledWith('hello pi'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/conversations/test-conv/message',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'hello pi' }),
      }),
    );
  });

  it('posts live thinking-level changes for pi conversations', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const piConversation = { ...conversation, harness: 'ohmypi' as const };

    render(<ComposerFooter conversation={piConversation} />);

    fireEvent.click(screen.getByTestId('effort-picker'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/thinking-level',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ level: 'high' }),
        }),
      );
    });
  });

  it('posts compact requests for pi conversations', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const piConversation = { ...conversation, harness: 'pi' as const };

    render(<ComposerFooter conversation={piConversation} />);

    fireEvent.click(screen.getByRole('button', { name: 'Compact context' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/compact',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('blocks send while image uploads are still in progress', async () => {
    const fetchMock = vi.mocked(fetch);
    let resolveUpload: ((response: Response) => void) | null = null;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Promise<Response>((resolve) => {
          resolveUpload = resolve;
        });
      }
      if (url.includes('/delete-image')) {
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/message')) {
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const onSend = vi.fn();
    render(<ComposerFooter conversation={conversation} onSend={onSend} />);

    const file = new File(['png-bytes'], 'slow.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
    });

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello world' } });
    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('slow.png')).toBeInTheDocument();
    expect(screen.getByText('Uploading…')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    expect(mockToastError).toHaveBeenCalledWith('Please wait for image uploads to finish');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/conversations/test-conv/message',
      expect.anything(),
    );
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Remove slow.png'));
    resolveUpload?.(new Response(JSON.stringify({ path: '/tmp/overdeck-paste-uploaded.png' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/delete-image',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/tmp/overdeck-paste-uploaded.png' }),
        }),
      );
    });
  });

  it('only enqueues one image when Chromium surfaces it in both .files and .items', async () => {
    // Regression for the "Ctrl+V pastes two copies" bug: Chromium often
    // populates BOTH clipboardData.files AND clipboardData.items (kind:'file')
    // for a single image paste. The two File objects can have differing
    // `lastModified` values (microsecond-apart synth), so name|size|lastModified
    // dedup is unreliable. The handler must prefer .files and ignore .items
    // when .files already has entries.
    const fetchMock = vi.mocked(fetch);
    let uploadCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        uploadCalls += 1;
        return new Response(JSON.stringify({ path: `/tmp/overdeck-paste-${uploadCalls}.png` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ComposerFooter conversation={conversation} />);

    // Two File objects with same content/name but a different lastModified —
    // the previous dedup key would treat these as distinct images.
    const fileA = new File(['png-bytes'], 'image.png', { type: 'image/png', lastModified: 1_700_000_000_000 });
    const fileB = new File(['png-bytes'], 'image.png', { type: 'image/png', lastModified: 1_700_000_000_001 });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        files: [fileA],
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => fileB },
        ],
        types: ['Files', 'image/png'],
      },
    });

    await waitFor(() => {
      expect(uploadCalls).toBe(1);
    });
    // Exactly one image card should be visible.
    expect(screen.getAllByText('image.png')).toHaveLength(1);
  });

  it('falls back to .items when .files is empty (Wayland screenshot-tool paste)', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ path: '/tmp/overdeck-paste-wayland.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'wayland.png', { type: 'image/png' });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        files: [],
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => file },
        ],
        types: ['image/png'],
      },
    });

    expect(await screen.findByText('wayland.png')).toBeInTheDocument();
  });

  it('blocks send when any pending image upload has failed', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response('upload failed', { status: 500 });
      }
      if (url.includes('/message')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/settings/claude-auth')) {
        return Promise.resolve(new Response(JSON.stringify({ loggedIn: true, hasAnthropicApiKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const onSend = vi.fn();
    render(<ComposerFooter conversation={conversation} onSend={onSend} />);

    const file = new File(['png-bytes'], 'broken.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([9, 9, 9, 9]).buffer),
    });

    fireEvent.change(screen.getByTestId('composer-editor'), { target: { value: 'hello world' } });
    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('broken.png')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Failed to upload image/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Send message (Enter)'));

    expect(mockToastError).toHaveBeenCalledWith('Remove failed image uploads before sending');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/conversations/test-conv/message',
      expect.anything(),
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});
