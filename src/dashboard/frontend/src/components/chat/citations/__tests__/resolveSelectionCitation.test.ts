import { describe, it, expect } from 'vitest';
import { resolveSelectionCitation } from '../resolveSelectionCitation.js';

function buildFixture() {
  const container = document.createElement('div');
  container.innerHTML = `
    <div data-cite-message-id="assistant-1" data-cite-role="assistant">Hello world</div>
    <div data-cite-message-id="user-1" data-cite-role="user">User reply text</div>
    <div>Outside, not citable</div>
  `;
  document.body.appendChild(container);
  return {
    assistantText: container.querySelector('[data-cite-message-id="assistant-1"]')!.firstChild as Text,
    userText: container.querySelector('[data-cite-message-id="user-1"]')!.firstChild as Text,
    outsideText: container.querySelector('div:last-child')!.firstChild as Text,
  };
}

function fakeSelection(opts: {
  isCollapsed: boolean;
  anchorNode: Node | null;
  focusNode: Node | null;
  text: string;
}) {
  return {
    isCollapsed: opts.isCollapsed,
    anchorNode: opts.anchorNode,
    focusNode: opts.focusNode,
    toString: () => opts.text,
  };
}

describe('resolveSelectionCitation', () => {
  it('returns null for a null selection', () => {
    expect(resolveSelectionCitation(null)).toBeNull();
  });

  it('returns null for a collapsed selection', () => {
    const { assistantText } = buildFixture();
    const selection = fakeSelection({ isCollapsed: true, anchorNode: assistantText, focusNode: assistantText, text: '' });
    expect(resolveSelectionCitation(selection)).toBeNull();
  });

  it('returns null for a whitespace-only selection', () => {
    const { assistantText } = buildFixture();
    const selection = fakeSelection({ isCollapsed: false, anchorNode: assistantText, focusNode: assistantText, text: '   \n ' });
    expect(resolveSelectionCitation(selection)).toBeNull();
  });

  it('resolves an assistant selection with both ends in the same cite element', () => {
    const { assistantText } = buildFixture();
    const selection = fakeSelection({ isCollapsed: false, anchorNode: assistantText, focusNode: assistantText, text: 'Hello world' });
    expect(resolveSelectionCitation(selection)).toEqual({
      messageId: 'assistant-1',
      role: 'assistant',
      quotedText: 'Hello world',
    });
  });

  it('resolves a user selection with role "user"', () => {
    const { userText } = buildFixture();
    const selection = fakeSelection({ isCollapsed: false, anchorNode: userText, focusNode: userText, text: 'User reply text' });
    expect(resolveSelectionCitation(selection)).toEqual({
      messageId: 'user-1',
      role: 'user',
      quotedText: 'User reply text',
    });
  });

  it('returns null when the two ends land in different cite elements', () => {
    const { assistantText, userText } = buildFixture();
    const selection = fakeSelection({ isCollapsed: false, anchorNode: assistantText, focusNode: userText, text: 'world User' });
    expect(resolveSelectionCitation(selection)).toBeNull();
  });

  it('returns null when one end is outside any cite element', () => {
    const { assistantText, outsideText } = buildFixture();
    const selection = fakeSelection({ isCollapsed: false, anchorNode: assistantText, focusNode: outsideText, text: 'world Outside' });
    expect(resolveSelectionCitation(selection)).toBeNull();
  });
});
