import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { CitationChips } from '../CitationChips.js';
import { addCitation, getConversationCitations, resetCitationStore } from '../../../../lib/composerCitations.js';

const SOURCE = { kind: 'message' as const, messageId: 'msg-1', role: 'assistant' as const };

beforeEach(() => {
  localStorage.clear();
  resetCitationStore();
});

describe('CitationChips', () => {
  it('renders nothing for a conversation with no citations', () => {
    render(<CitationChips conversationName="conv-a" />);
    expect(screen.queryByTestId('composer-citation-chips')).not.toBeInTheDocument();
  });

  it('renders one chip per citation in add order', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'First', comment: '' });
    addCitation('conv-a', { source: SOURCE, quotedText: 'Second', comment: '' });

    render(<CitationChips conversationName="conv-a" />);
    const chips = screen.getAllByTestId('composer-citation-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('First');
    expect(chips[1]).toHaveTextContent('Second');
  });

  it('removing a chip drops exactly that citation from the store', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'First', comment: '' });
    addCitation('conv-a', { source: SOURCE, quotedText: 'Second', comment: '' });

    render(<CitationChips conversationName="conv-a" />);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove citation' });
    fireEvent.click(removeButtons[0]!);

    expect(getConversationCitations('conv-a').map((c) => c.quotedText)).toEqual(['Second']);
  });

  it('expand, edit, and Save updates the citation comment', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'Quoted', comment: 'original' });

    render(<CitationChips conversationName="conv-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand citation' }));
    const textarea = screen.getByLabelText('Edit citation comment');
    fireEvent.change(textarea, { target: { value: 'updated comment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(getConversationCitations('conv-a')[0]!.comment).toBe('updated comment');
  });

  it('does not render chips for a different conversation', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'Only in A', comment: '' });

    render(<CitationChips conversationName="conv-b" />);
    expect(screen.queryByTestId('composer-citation-chips')).not.toBeInTheDocument();
  });

  it('renders chips again after a reload simulation', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'Survives reload', comment: '' });
    resetCitationStore();

    render(<CitationChips conversationName="conv-a" />);
    expect(screen.getByTestId('composer-citation-chip')).toHaveTextContent('Survives reload');
  });

  it('collapsed file citation chip shows the basename before the quote', () => {
    addCitation('conv-a', { source: { kind: 'file', path: '/repo/docs/guide.md' }, quotedText: 'Use X', comment: '' });

    render(<CitationChips conversationName="conv-a" />);
    expect(screen.getByTestId('composer-citation-chip')).toHaveTextContent('guide.md');
    expect(screen.queryByText('/repo/docs/guide.md')).not.toBeInTheDocument();
  });

  it('expanded file citation chip shows the full path above the quote', () => {
    addCitation('conv-a', { source: { kind: 'file', path: '/repo/docs/guide.md' }, quotedText: 'Use X', comment: '' });

    render(<CitationChips conversationName="conv-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand citation' }));

    expect(screen.getByText('/repo/docs/guide.md')).toBeInTheDocument();
  });

  it('a message citation chip renders no file prefix or path line, collapsed or expanded', () => {
    addCitation('conv-a', { source: SOURCE, quotedText: 'Use X', comment: '' });

    render(<CitationChips conversationName="conv-a" />);
    expect(screen.getByTestId('composer-citation-chip')).not.toHaveTextContent(' · Use X');

    fireEvent.click(screen.getByRole('button', { name: 'Expand citation' }));
    expect(screen.queryByText(/^\/.*\.md$/)).not.toBeInTheDocument();
  });
});
