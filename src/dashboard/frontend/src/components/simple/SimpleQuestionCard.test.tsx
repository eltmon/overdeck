/**
 * PAN-3090 WI-3 — rich question card tests.
 * Proves the card quotes the pending question with its options, send uses the
 * typed text or the selected label (never empty), and payloads the card can't
 * answer render nothing so the page keeps the generic path.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSnapshot } from '@overdeck/contracts';
import { isRichQuestion, SimpleQuestionCard } from './SimpleQuestionCard';

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    status: 'running',
    role: 'work',
    pendingInputCount: 1,
    pendingAskUserQuestion: {
      toolUseId: 'tu-1',
      askedAt: new Date().toISOString(),
      questions: [{
        question: 'How should I handle the old app versions?',
        options: [
          { label: 'Keep a compatibility view', description: 'Old apps keep working.' },
          { label: 'Require the app update', description: 'Cleaner cut.' },
        ],
      }],
    },
    ...overrides,
  } as AgentSnapshot;
}

describe('SimpleQuestionCard (PAN-3090)', () => {
  afterEach(cleanup);

  it('quotes the pending question and lists its options', () => {
    render(<SimpleQuestionCard agent={makeAgent()} onSend={vi.fn()} sending={false} />);
    expect(screen.getByText('How should I handle the old app versions?')).toBeInTheDocument();
    expect(screen.getByText('Keep a compatibility view')).toBeInTheDocument();
    expect(screen.getByText('Old apps keep working.')).toBeInTheDocument();
    expect(screen.getByText('Require the app update')).toBeInTheDocument();
  });

  it('send uses the typed text, else the selected label; disabled with neither', () => {
    const onSend = vi.fn((_text: string, onSuccess: () => void) => onSuccess());
    render(<SimpleQuestionCard agent={makeAgent()} onSend={onSend} sending={false} />);
    const sendButton = screen.getByRole('button', { name: 'Send answer' });
    expect(sendButton).toBeDisabled();

    fireEvent.click(screen.getByText('Keep a compatibility view'));
    expect(sendButton).toBeEnabled();
    fireEvent.click(sendButton);
    expect(onSend).toHaveBeenLastCalledWith('Keep a compatibility view', expect.any(Function));
    // The success callback flips the card to the confirmation state.
    expect(screen.getByText('Answer sent')).toBeInTheDocument();
  });

  it('typed text wins over a selection', () => {
    const onSend = vi.fn();
    render(<SimpleQuestionCard agent={makeAgent()} onSend={onSend} sending={false} />);
    fireEvent.click(screen.getByText('Require the app update'));
    fireEvent.change(screen.getByPlaceholderText('Or type your own answer…'), { target: { value: 'Do the shim, drop it in March' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onSend).toHaveBeenCalledWith('Do the shim, drop it in March', expect.any(Function));
  });

  it('multi-question payloads fall back (renders nothing)', () => {
    const agent = makeAgent({
      pendingAskUserQuestion: {
        toolUseId: 'tu-1',
        askedAt: new Date().toISOString(),
        questions: [
          { question: 'First?', options: [] },
          { question: 'Second?', options: [] },
        ],
      },
    });
    const { container } = render(<SimpleQuestionCard agent={agent} onSend={vi.fn()} sending={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(isRichQuestion(agent)).toBe(false);
  });

  it('multiSelect questions fall back (renders nothing)', () => {
    const agent = makeAgent({
      pendingAskUserQuestion: {
        toolUseId: 'tu-1',
        askedAt: new Date().toISOString(),
        questions: [{ question: 'Pick several?', multiSelect: true, options: [{ label: 'A' }] }],
      },
    });
    const { container } = render(<SimpleQuestionCard agent={agent} onSend={vi.fn()} sending={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
