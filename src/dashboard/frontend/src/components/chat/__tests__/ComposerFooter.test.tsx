import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComposerFooter } from '../ComposerFooter';

const { editorState, mockFocus, mockToastError, mockSaveStoredModel } = vi.hoisted(() => ({
  editorState: { text: '' },
  mockFocus: vi.fn(),
  mockToastError: vi.fn(),
  mockSaveStoredModel: vi.fn(),
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
  saveStoredModel: (...args: unknown[]) => mockSaveStoredModel(...args),
}));

vi.mock('../defaultConversationModel', () => ({
  getDefaultConversationModel: () => 'claude-sonnet-4-6',
}));

vi.mock('../EffortPicker', () => ({
  EffortPicker: ({ value }: { value: string }) => <div data-testid="effort-picker">{value}</div>,
  loadStoredEffort: () => 'medium',
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('../../MissionControl/styles/mission-control.module.css', () => ({
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
        return new Response(JSON.stringify({ path: '/tmp/panopticon-paste-uploaded.png' }), {
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
          body: JSON.stringify({ message: '@/tmp/panopticon-paste-uploaded.png\nhello world' }),
        }),
      );
    });
    expect(onSend).toHaveBeenCalledWith('@/tmp/panopticon-paste-uploaded.png\nhello world');
    expect(screen.queryByText('paste.png')).not.toBeInTheDocument();
  });

  it('uploads dropped images through the same endpoint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ path: '/tmp/panopticon-paste-dropped.png' }), {
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
        return new Response(JSON.stringify({ path: '/tmp/panopticon-paste-uploaded.png' }), {
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
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'remove-me.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]).buffer),
    });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
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
          body: JSON.stringify({ path: '/tmp/panopticon-paste-uploaded.png' }),
        }),
      );
    });
    expect(screen.queryByText('remove-me.png')).not.toBeInTheDocument();
  });

  it('deletes uploaded images when the conversation prop changes without remounting', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response(JSON.stringify({ path: '/tmp/panopticon-paste-switched.png' }), {
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
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const view = render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'switch-me.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('switch-me.png')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    view.rerender(<ComposerFooter conversation={secondConversation} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/delete-image',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/tmp/panopticon-paste-switched.png' }),
        }),
      );
    });
    expect(screen.queryByText('switch-me.png')).not.toBeInTheDocument();
  });

  it('deletes uploaded images when the composer unmounts before send', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/upload-image')) {
        return new Response(JSON.stringify({ path: '/tmp/panopticon-paste-abandoned.png' }), {
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
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const view = render(<ComposerFooter conversation={conversation} />);

    const file = new File(['png-bytes'], 'abandon.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(Uint8Array.from([5, 6, 7, 8]).buffer),
    });

    fireEvent.paste(screen.getByTestId('composer-editor'), {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
      },
    });

    expect(await screen.findByText('abandon.png')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Uploaded')).toBeInTheDocument();
    });

    view.unmount();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/delete-image',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/tmp/panopticon-paste-abandoned.png' }),
        }),
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
        items: [{ type: 'image/png', getAsFile: () => file }],
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
    resolveUpload?.(new Response(JSON.stringify({ path: '/tmp/panopticon-paste-uploaded.png' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/conversations/test-conv/delete-image',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/tmp/panopticon-paste-uploaded.png' }),
        }),
      );
    });
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
        items: [{ type: 'image/png', getAsFile: () => file }],
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
