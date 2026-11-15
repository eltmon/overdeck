import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConversationReferenceLink } from '../ConversationReferenceLink';
import { ConversationLinkOpenerContext, type ConversationLinkOpener } from '../ConversationLinkOpenerContext';
import type { Conversation } from '../../CommandDeck/ConversationList';
import type { ConversationRef } from '../../../lib/conversationReferences';

const conversation = { id: 3904, name: '20261113-6031' } as Conversation;

function makeRef(overrides: Partial<ConversationRef> = {}): ConversationRef {
  return {
    key: '20261113-6031',
    routeKey: '3904',
    name: '20261113-6031',
    title: null,
    isCurrent: false,
    conversation,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderLink(conversationRef: ConversationRef, opener: ConversationLinkOpener | null) {
  render(
    <ConversationLinkOpenerContext.Provider value={opener}>
      <ConversationReferenceLink conversationRef={conversationRef}>20261113-6031</ConversationReferenceLink>
    </ConversationLinkOpenerContext.Provider>,
  );
  return screen.getByRole('link');
}

describe('ConversationReferenceLink (PAN-5339 reference-link.ac1)', () => {
  it('a plain click calls the opener once with the conversation row and prevents default', () => {
    const opener = vi.fn();
    const link = renderLink(makeRef(), opener);

    expect(fireEvent.click(link)).toBe(false);

    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledWith(conversation);
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('ConversationReferenceLink (PAN-5339 reference-link.ac2)', () => {
  it('Ctrl-click and Meta-click do not call the opener', () => {
    const opener = vi.fn();
    const link = renderLink(makeRef(), opener);

    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);

    expect(opener).not.toHaveBeenCalled();
  });
});

describe('ConversationReferenceLink (PAN-5339 reference-link.ac3)', () => {
  it('without an opener context a plain click calls nothing and the anchor keeps its new-tab attributes', () => {
    const link = renderLink(makeRef(), null);

    expect(fireEvent.click(link)).toBe(true);

    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('href', '/conv/3904');
  });
});

describe('ConversationReferenceLink (PAN-5339 reference-link.ac4)', () => {
  it('uses the conversation title as the tooltip', () => {
    const link = renderLink(makeRef({ title: 'Refactor the deck' }), null);
    expect(link).toHaveAttribute('title', 'Refactor the deck');
  });

  it('falls back to the conversation name when the title is null', () => {
    const link = renderLink(makeRef({ title: null, name: '20261113-6031' }), null);
    expect(link).toHaveAttribute('title', '20261113-6031');
  });
});
