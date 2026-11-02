import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AskUserQuestionDialog,
  type AskUserQuestionSubject,
} from '../AskUserQuestionDialog';

const pendingAskUserQuestion = {
  toolUseId: 'toolu_1',
  askedAt: '2026-07-25T12:00:00.000Z',
  questions: [
    {
      question: 'Which implementation should I use?',
      options: [{ label: 'Option A', description: 'Use the existing path.' }],
    },
  ],
};

function renderDialog(subject: AskUserQuestionSubject) {
  return render(
    <AskUserQuestionDialog
      subject={{ ...subject, pendingAskUserQuestion }}
      isOpen
      onSubmit={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

describe('AskUserQuestionDialog issue reference', () => {
  it('renders the issue identifier and title in the header and Issue cell', () => {
    renderDialog({ id: 'agent-pan-1', issueId: 'PAN-1', issueTitle: 'Fix widget' });

    expect(screen.getAllByText('PAN-1 — Fix widget')).toHaveLength(2);
  });

  it('renders the issue identifier alone when the issue title is missing', () => {
    renderDialog({ id: 'agent-pan-1', issueId: 'PAN-1', issueTitle: null });

    expect(screen.getAllByText('PAN-1')).toHaveLength(2);
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('omits the Issue cell when unbound and falls back to the subject title', () => {
    renderDialog({ id: 'conv-1', title: 'Conversation title' });

    expect(screen.getAllByText('Conversation title')).toHaveLength(2);
    expect(screen.queryByText('Issue')).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
  });
});

describe('AskUserQuestionDialog answer state', () => {
  function subjectWith(pending: AskUserQuestionSubject['pendingAskUserQuestion']): AskUserQuestionSubject {
    return { id: 'conv-1', title: 'Conversation title', pendingAskUserQuestion: pending };
  }

  it('enables Send for a new single question after a multi-question one was answered', () => {
    const twoQuestions = {
      toolUseId: 'toolu_two',
      askedAt: '2026-09-24T12:00:00.000Z',
      questions: [
        { question: 'First?', options: [{ label: 'A1' }, { label: 'A2' }] },
        { question: 'Second?', options: [{ label: 'B1' }, { label: 'B2' }] },
      ],
    };
    const oneQuestion = {
      toolUseId: 'toolu_one',
      askedAt: '2026-09-24T12:05:00.000Z',
      questions: [{ question: 'Publish?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    };
    const props = { isOpen: true, onSubmit: vi.fn(), onDismiss: vi.fn() };
    const { rerender } = render(<AskUserQuestionDialog {...props} subject={subjectWith(twoQuestions)} />);
    fireEvent.click(screen.getByText('A1'));
    fireEvent.click(screen.getByText('B2'));

    rerender(<AskUserQuestionDialog {...props} subject={subjectWith(oneQuestion)} />);
    const send = screen.getByRole('button', { name: /Send Answer/ });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByText('Yes'));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(props.onSubmit).toHaveBeenCalledWith(['Yes']);
  });
});

describe('AskUserQuestionDialog markdown', () => {
  function renderQuestion(question: { question: string; context?: string }) {
    return render(
      <AskUserQuestionDialog
        subject={{
          id: 'agent-pan-1',
          pendingAskUserQuestion: {
            toolUseId: 'operator-decision:q1',
            askedAt: '2026-11-01T12:00:00.000Z',
            questions: [{ ...question, options: [{ label: 'Yes' }, { label: 'No' }] }],
          },
        }}
        isOpen
        onSubmit={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
  }

  it('renders a markdown list in the question as list items', () => {
    renderQuestion({ question: 'Pick a path.\n\n- first fact\n- second fact' });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Pick a path.')).toBeInTheDocument();
  });

  it('renders the context as a separate block after the options', () => {
    renderQuestion({ question: 'Pick a path.', context: '- tried A\n- tried B' });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Pick a path.').closest('div')).not.toHaveTextContent('tried A');
    const notesLabel = screen.getByText("Agent's notes");
    expect(notesLabel.parentElement).toHaveTextContent('tried A');
    const lastOption = screen.getByRole('button', { name: 'No' });
    expect(lastOption.compareDocumentPosition(notesLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no context block when context is absent', () => {
    renderQuestion({ question: 'Pick a path.' });

    expect(screen.queryByText("Agent's notes")).toBeNull();
    expect(screen.queryByText('tried A')).toBeNull();
  });
});

describe('AskUserQuestionDialog accessibility', () => {
  const subject: AskUserQuestionSubject = {
    id: 'agent-pan-1',
    issueId: 'PAN-1',
    issueTitle: 'Fix widget',
    pendingAskUserQuestion: {
      toolUseId: 'operator-decision:q1',
      askedAt: '2026-11-01T12:00:00.000Z',
      questions: [{ question: 'Rotate the leaked token?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    },
  };

  function renderOpen(isOpen = true) {
    return render(<AskUserQuestionDialog subject={subject} isOpen={isOpen} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
  }

  function focusables(dialog: HTMLElement): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ));
  }

  it('has dialog semantics', () => {
    renderOpen();

    const dialog = screen.getByRole('dialog', { name: 'PAN-1 — Fix widget' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Rotate the leaked token?');
  });

  it('focuses the first option on open', () => {
    renderOpen();

    expect(document.activeElement).toBe(screen.getByText('Yes').closest('button'));
  });

  it('Tab from the last focusable wraps to the first', () => {
    renderOpen();
    fireEvent.click(screen.getByText('Yes'));
    const dialog = screen.getByRole('dialog');
    const all = focusables(dialog);
    const last = all[all.length - 1];
    expect(last).toBe(screen.getByRole('button', { name: /Send Answer/ }));
    last.focus();

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(all[0]);

    fireEvent.keyDown(all[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('restores focus to the opener on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open question';
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = renderOpen();
    expect(document.activeElement).not.toBe(opener);

    rerender(<AskUserQuestionDialog subject={subject} isOpen={false} onSubmit={vi.fn()} onDismiss={vi.fn()} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
