import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { CiteSelectionLayer, CiteSelectionToolbar, type CiteSnapshot } from '../CiteSelectionToolbar.js';
import { getConversationCitations, resetCitationStore } from '../../../../lib/composerCitations.js';

function fakeRect(): DOMRect {
  return { top: 100, left: 100, width: 40, height: 20, bottom: 120, right: 140, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
}

function snapshot(overrides: Partial<CiteSnapshot> = {}): CiteSnapshot {
  return { messageId: 'asst-1', role: 'assistant', quotedText: 'Quoted text', rect: fakeRect(), ...overrides };
}

/** Mirrors the open/closed state `CiteSelectionLayer` owns, so the presentational
 *  component can be exercised without a real DOM selection. */
function Harness({ initialSnapshot }: { initialSnapshot: CiteSnapshot }) {
  const [frozen, setFrozen] = useState<CiteSnapshot | null>(null);
  return (
    <CiteSelectionToolbar
      conversationName="conv-a"
      snapshot={frozen ?? initialSnapshot}
      isOpen={frozen !== null}
      onOpen={() => setFrozen(initialSnapshot)}
      onDone={() => setFrozen(null)}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  resetCitationStore();
});

describe('CiteSelectionToolbar', () => {
  it('renders the Cite button for a given selection snapshot', () => {
    render(<Harness initialSnapshot={snapshot()} />);
    expect(screen.getByRole('button', { name: 'Cite' })).toBeInTheDocument();
  });

  it('Save with a comment adds one citation with that comment', () => {
    render(<Harness initialSnapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.change(screen.getByLabelText('Citation comment'), { target: { value: "I don't agree" } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const citations = getConversationCitations('conv-a');
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ quotedText: 'Quoted text', comment: "I don't agree" });
  });

  it('Save with an empty comment adds a quote-only citation', () => {
    render(<Harness initialSnapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const citations = getConversationCitations('conv-a');
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ quotedText: 'Quoted text', comment: '' });
  });

  it('Cancel adds no citation', () => {
    render(<Harness initialSnapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.change(screen.getByLabelText('Citation comment'), { target: { value: 'discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(getConversationCitations('conv-a')).toEqual([]);
  });

  it('pressing "c" on document.body opens the comment box', () => {
    render(<Harness initialSnapshot={snapshot()} />);
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByLabelText('Citation comment')).toBeInTheDocument();
  });

  it('pressing "c" while an outside textarea is focused does not open the box', () => {
    render(
      <div>
        <textarea data-testid="outside" />
        <Harness initialSnapshot={snapshot()} />
      </div>,
    );
    const outside = screen.getByTestId('outside');
    outside.focus();
    fireEvent.keyDown(outside, { key: 'c' });
    expect(screen.queryByLabelText('Citation comment')).not.toBeInTheDocument();
  });
});

describe('CiteSelectionLayer (review fix: the open box must outlive the live selection)', () => {
  function selectTextIn(element: Element): void {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  function buildTimeline(): { root: HTMLDivElement; citable: HTMLDivElement; outside: HTMLDivElement } {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-cite-message-id="asst-1" data-cite-role="assistant">Quoted text here</div>
      <div>Outside, not citable</div>
    `;
    document.body.appendChild(root);
    return {
      root,
      citable: root.querySelector('[data-cite-message-id]')!,
      outside: root.querySelector('div:last-child')!,
    };
  }

  it('keeps the open box (and the typed comment) alive through a selection change and a timeline scroll, and Save still adds the citation', () => {
    const { root, citable, outside } = buildTimeline();
    const rootRef = { current: root };

    render(<CiteSelectionLayer conversationName="conv-a" rootRef={rootRef} />);

    act(() => selectTextIn(citable));
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));

    const textarea = screen.getByLabelText('Citation comment');
    fireEvent.change(textarea, { target: { value: 'still here' } });

    // Focusing the textarea (or anything else) moves the live selection outside
    // the cite row — this must not tear the open box down.
    act(() => selectTextIn(outside));
    expect(screen.getByLabelText('Citation comment')).toHaveValue('still here');

    // A timeline scroll clears the live snapshot too — same requirement.
    act(() => {
      root.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByLabelText('Citation comment')).toHaveValue('still here');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const citations = getConversationCitations('conv-a');
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({ quotedText: 'Quoted text here', comment: 'still here' });

    root.remove();
  });

  it('closes the box on Cancel without adding a citation', () => {
    const { root, citable } = buildTimeline();
    const rootRef = { current: root };

    render(<CiteSelectionLayer conversationName="conv-a" rootRef={rootRef} />);

    act(() => selectTextIn(citable));
    fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Citation comment')).not.toBeInTheDocument();
    expect(getConversationCitations('conv-a')).toEqual([]);

    root.remove();
  });
});
