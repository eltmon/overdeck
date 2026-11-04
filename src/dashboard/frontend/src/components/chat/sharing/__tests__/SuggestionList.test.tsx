/** PAN-4476 WI-11: the suggestion list's view and controller modes. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SuggestionList, type SuggestionItem } from '../SuggestionList';

const alice: SuggestionItem = { githubId: 7, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/7', text: 'Fix the flaky test' };
const bob: SuggestionItem = { githubId: 8, login: 'bob', avatarUrl: null, text: 'Run the linter' };

describe('SuggestionList (PAN-4476 WI-11)', () => {
  it('renders nothing for an empty list', () => {
    const { container } = render(<SuggestionList items={[]} mode="controller" onSend={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows read-only rows in view mode', () => {
    render(<SuggestionList items={[alice, bob]} mode="view" />);
    expect(screen.getByRole('heading', { name: 'Suggestions (2)' })).toBeTruthy();
    const row = screen.getByRole('listitem', { name: 'Suggestion from @alice' });
    expect(row.textContent).toContain('@alice');
    expect(row.textContent).toContain('Fix the flaky test');
    expect(screen.getByRole('listitem', { name: 'Suggestion from @bob' })).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('Use opens an editor; Send passes the edited text once; Cancel closes', async () => {
    const onSend = vi.fn(async () => undefined);
    render(<SuggestionList items={[alice]} mode="controller" onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion from @alice' }));
    const editor = screen.getByRole('textbox', { name: 'Edit suggestion from @alice' }) as HTMLTextAreaElement;
    expect(editor.value).toBe('Fix the flaky test');
    fireEvent.change(editor, { target: { value: 'Fix the flaky test, then rerun it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send suggestion from @alice' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(alice, 'Fix the flaky test, then rerun it');

    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion from @alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables Send for a command prefix', () => {
    render(<SuggestionList items={[alice]} mode="controller" onSend={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion from @alice' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/clear' } });
    expect((screen.getByRole('button', { name: 'Send suggestion from @alice' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the editor open with the error when the send is rejected', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('The queue is full.');
    });
    render(<SuggestionList items={[alice]} mode="controller" onSend={onSend} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestion from @alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send suggestion from @alice' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The queue is full.');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});
