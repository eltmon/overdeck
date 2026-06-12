import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceWidget } from '../VoiceWidget';
import type { Conversation } from '../../CommandDeck/ConversationList';

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
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(''),
      partialText: hookState.partialText,
      committedText: hookState.committedText,
      isListening: hookState.isListening,
      error: hookState.error,
      analyserNode: null,
      resetTranscript: vi.fn(),
    };
  },
}));

const conversation = { name: 'conv-test' } as Conversation;

function renderWidget(overrides: Partial<typeof hookState> = {}) {
  Object.assign(hookState, { partialText: '', committedText: '', isListening: false, error: null }, overrides);
  const onInsert = vi.fn();
  const onSendDirect = vi.fn();
  render(<VoiceWidget conversation={conversation} onInsert={onInsert} onSendDirect={onSendDirect} />);
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
});
