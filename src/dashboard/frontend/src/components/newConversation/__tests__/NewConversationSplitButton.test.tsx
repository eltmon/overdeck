/** PAN-4486 WI-11: the sidebar `+` split button. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NewConversationSplitButton } from '../NewConversationSplitButton';
import { useNewConversationDialogStore } from '../newConversationDialogStore';

beforeEach(() => {
  useNewConversationDialogStore.setState({ open: false, projectKey: undefined });
});

describe('NewConversationSplitButton', () => {
  it('quick creates on the main click without opening the menu or the dialog', () => {
    const onQuickCreate = vi.fn();
    render(<NewConversationSplitButton onQuickCreate={onQuickCreate} projectKey="overdeck" />);
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(onQuickCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useNewConversationDialogStore.getState().open).toBe(false);
  });

  it('opens the options dialog for the deck project from the caret menu', () => {
    render(<NewConversationSplitButton onQuickCreate={vi.fn()} projectKey="overdeck" />);
    const caret = screen.getByRole('button', { name: 'New conversation options' });
    expect(caret.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(caret);
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'New conversation with options…' }));
    expect(useNewConversationDialogStore.getState()).toMatchObject({ open: true, projectKey: 'overdeck' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu on Escape and on an outside mousedown', () => {
    render(<NewConversationSplitButton onQuickCreate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
