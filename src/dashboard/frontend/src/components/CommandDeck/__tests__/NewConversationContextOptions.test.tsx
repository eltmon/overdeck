/** PAN-4185: the Command Deck's new-conversation context opt-outs. */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  NEW_CONVERSATION_CONTEXT_STORAGE_KEY,
  NewConversationContextOptions,
  loadStoredNewConversationContext,
  newConversationContextPayload,
  saveStoredNewConversationContext,
  type NewConversationContext,
} from '../NewConversationContextOptions';
import type { Harness } from '../../shared/ModelPicker';

function Harnessed({ harness = 'claude-code' as Harness }) {
  const [value, setValue] = useState<NewConversationContext>(loadStoredNewConversationContext);
  return (
    <NewConversationContextOptions
      value={value}
      harness={harness}
      onChange={setValue}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NewConversationContextOptions', () => {
  it('starts unchecked and remembers each choice per browser', () => {
    const { unmount } = render(<Harnessed />);
    const noContext = screen.getByRole('checkbox', { name: 'No context' });
    const skipClaudeMd = screen.getByRole('checkbox', { name: 'Skip CLAUDE.md' });
    expect(noContext).not.toBeChecked();
    expect(skipClaudeMd).not.toBeChecked();

    fireEvent.click(noContext);
    fireEvent.click(skipClaudeMd);
    expect(JSON.parse(localStorage.getItem(NEW_CONVERSATION_CONTEXT_STORAGE_KEY)!)).toEqual({ bareContext: true, skipClaudeMd: true });
    unmount();

    render(<Harnessed />);
    expect(screen.getByRole('checkbox', { name: 'No context' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Skip CLAUDE.md' })).toBeChecked();
  });

  it('offers Skip CLAUDE.md only for Claude Code', () => {
    render(<Harnessed harness="codex" />);
    expect(screen.getByRole('checkbox', { name: 'No context' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Skip CLAUDE.md' })).toBeNull();
  });

  it('falls back to defaults when storage is unreadable or corrupt', () => {
    localStorage.setItem(NEW_CONVERSATION_CONTEXT_STORAGE_KEY, '{not json');
    expect(loadStoredNewConversationContext()).toEqual({ bareContext: false, skipClaudeMd: false });

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadStoredNewConversationContext()).toEqual({ bareContext: false, skipClaudeMd: false });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveStoredNewConversationContext({ bareContext: true, skipClaudeMd: false })).not.toThrow();
  });

  it('builds the create-request fields, dropping Skip CLAUDE.md off Claude Code', () => {
    expect(newConversationContextPayload({ bareContext: false, skipClaudeMd: false }, 'claude-code')).toEqual({});
    expect(newConversationContextPayload({ bareContext: true, skipClaudeMd: true }, 'claude-code')).toEqual({ bareContext: true, skipClaudeMd: true });
    expect(newConversationContextPayload({ bareContext: true, skipClaudeMd: true }, 'codex')).toEqual({ bareContext: true });
  });
});
