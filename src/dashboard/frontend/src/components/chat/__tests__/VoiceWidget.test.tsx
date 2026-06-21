import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { VoiceWidget } from '../VoiceWidget';
import type { Conversation } from '../../CommandDeck/ConversationList';

const { mockStart, mockStop, mockResetTranscript } = vi.hoisted(() => ({
  mockStart: vi.fn(),
  mockStop: vi.fn(),
  mockResetTranscript: vi.fn(),
}));

const hookState = {
  partialText: '',
  committedText: '',
  isListening: false,
  error: null as string | null,
};
let capturedOnCommitted: ((text: string) => void) | undefined;

vi.mock('../../../hooks/useVoiceTranscription', () => ({
  useVoiceTranscription: (options?: { onCommitted?: (text: string) => void }) => {
    capturedOnCommitted = options?.onCommitted;
    return {
      start: mockStart,
      stop: mockStop,
      partialText: hookState.partialText,
      committedText: hookState.committedText,
      isListening: hookState.isListening,
      error: hookState.error,
      analyserNode: null,
      resetTranscript: mockResetTranscript,
    };
  },
}));

const conversation = { name: 'conv-test' } as Conversation;

function renderWidget(overrides: Partial<typeof hookState> = {}, props: Partial<ComponentProps<typeof VoiceWidget>> = {}) {
  Object.assign(hookState, { partialText: '', committedText: '', isListening: false, error: null }, overrides);
  mockStart.mockClear();
  mockStop.mockReset().mockResolvedValue('');
  mockResetTranscript.mockClear();
  const onInsert = vi.fn();
  const onSendDirect = vi.fn();
  render(<VoiceWidget conversation={conversation} onInsert={onInsert} onSendDirect={onSendDirect} {...props} />);
  return { onInsert, onSendDirect };
}

function previewTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/live transcript preview/i);
}

describe('VoiceWidget transcript preview', () => {
  it('shows committed and partial text together — partial must never replace committed sentences', () => {
    renderWidget({ committedText: 'First sentence done.', partialText: 'and now the second' });
    expect(previewTextarea().value).toBe('First sentence done. and now the second');
  });

  it('shows only the partial before anything commits', () => {
    renderWidget({ partialText: 'hello wor' });
    expect(previewTextarea().value).toBe('hello wor');
  });

  it('shows the accumulated committed text between utterances', () => {
    renderWidget({ committedText: 'First sentence done.' });
    expect(previewTextarea().value).toBe('First sentence done.');
  });
});

describe('VoiceWidget edit vs direct mode', () => {
  it('does not send committed sentences in edit mode (default)', () => {
    const { onSendDirect } = renderWidget();
    capturedOnCommitted?.('a finished sentence');
    expect(onSendDirect).not.toHaveBeenCalled();
  });

  it('sends each committed sentence immediately in direct mode', () => {
    const { onSendDirect } = renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Direct' }));
    capturedOnCommitted?.('a finished sentence');
    expect(onSendDirect).toHaveBeenCalledWith('a finished sentence');
  });

  it('stops sending direct after switching back to edit mode', () => {
    const { onSendDirect } = renderWidget();
    fireEvent.click(screen.getByRole('button', { name: 'Direct' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    capturedOnCommitted?.('a finished sentence');
    expect(onSendDirect).not.toHaveBeenCalled();
  });

  it('labels edit-mode completion as inserting transcript, not sending', () => {
    renderWidget({ committedText: 'dictated text' });
    expect(screen.getByRole('button', { name: /insert transcript/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
  });

  it('inserts the finalized transcript into the composer in edit mode', async () => {
    const { onInsert } = renderWidget({ committedText: 'dictated text' });
    mockStop.mockResolvedValue('dictated text');

    fireEvent.click(screen.getByRole('button', { name: /insert transcript/i }));

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith('dictated text');
    });
    expect(mockResetTranscript).toHaveBeenCalled();
  });

  it('auto-starts recording when the shortcut token changes', async () => {
    renderWidget({}, { autoStartToken: 1 });
    await waitFor(() => {
      expect(mockStart).toHaveBeenCalledWith(undefined);
    });
  });
});
