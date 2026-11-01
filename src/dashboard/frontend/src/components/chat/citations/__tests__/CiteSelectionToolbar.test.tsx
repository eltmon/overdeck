import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { CiteSelectionToolbar, type CiteSnapshot } from '../CiteSelectionToolbar.js';
import { getConversationCitations, resetCitationStore } from '../../../../lib/composerCitations.js';

function fakeRect(): DOMRect {
  return { top: 100, left: 100, width: 40, height: 20, bottom: 120, right: 140, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
}

function snapshot(overrides: Partial<CiteSnapshot> = {}): CiteSnapshot {
  return { messageId: 'asst-1', role: 'assistant', quotedText: 'Quoted text', rect: fakeRect(), ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  resetCitationStore();
});

describe('CiteSelectionToolbar', () => {
  it('renders the Cite button for a given selection snapshot', () => {
    render(<CiteSelectionToolbar conversationName="conv-a" snapshot={snapshot()} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cite' })).toBeInTheDocument();
  });

  it('Save with a comment adds one citation with that comment', () => {
    render(<CiteSelectionToolbar conversationName="conv-a" snapshot={snapshot()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.change(screen.getByLabelText('Citation comment'), { target: { value: "I don't agree" } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const citations = getConversationCitations('conv-a');
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ quotedText: 'Quoted text', comment: "I don't agree" });
  });

  it('Save with an empty comment adds a quote-only citation', () => {
    render(<CiteSelectionToolbar conversationName="conv-a" snapshot={snapshot()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const citations = getConversationCitations('conv-a');
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ quotedText: 'Quoted text', comment: '' });
  });

  it('Cancel adds no citation', () => {
    render(<CiteSelectionToolbar conversationName="conv-a" snapshot={snapshot()} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.change(screen.getByLabelText('Citation comment'), { target: { value: 'discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(getConversationCitations('conv-a')).toEqual([]);
  });

  it('pressing "c" on document.body opens the comment box', () => {
    render(<CiteSelectionToolbar conversationName="conv-a" snapshot={snapshot()} onDone={() => {}} />);
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByLabelText('Citation comment')).toBeInTheDocument();
  });

  it('pressing "c" while an outside textarea is focused does not open the box', () => {
    render(
      <div>
        <textarea data-testid="outside" />
        <CiteSelectionToolbar conversationName="conv-a" snapshot={snapshot()} onDone={() => {}} />
      </div>,
    );
    const outside = screen.getByTestId('outside');
    outside.focus();
    fireEvent.keyDown(outside, { key: 'c' });
    expect(screen.queryByLabelText('Citation comment')).not.toBeInTheDocument();
  });
});
