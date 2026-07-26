import { render, screen } from '@testing-library/react';
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
