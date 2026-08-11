import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViewToggle } from './ViewToggle';

vi.mock('../CommandDeck/styles/command-deck.module.css', () => ({
  default: {
    viewToggle: 'viewToggle',
    viewToggleBtn: 'viewToggleBtn',
    viewToggleBtnActive: 'viewToggleBtnActive',
  },
}));

const options = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'terminal', label: 'Terminal' },
] as const;

describe('ViewToggle', () => {
  it('renders each option as a tab inside the labelled tablist', () => {
    render(
      <ViewToggle
        ariaLabel="Agent session view"
        value="conversation"
        onChange={vi.fn()}
        options={[...options]}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Agent session view' })).toHaveClass('viewToggle');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveClass('viewToggleBtn');
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveClass('viewToggleBtn');
  });

  it('marks the active option and emits the clicked option id', () => {
    const onChange = vi.fn();
    render(
      <ViewToggle
        ariaLabel="Agent session view"
        value="conversation"
        onChange={onChange}
        options={[...options]}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveClass('viewToggleBtnActive');
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));

    expect(onChange).toHaveBeenCalledWith('terminal');
  });

  it('disables an option with its reason in the title and accessible label', () => {
    render(
      <ViewToggle
        ariaLabel="Agent session view"
        value="conversation"
        onChange={vi.fn()}
        options={[
          options[0],
          {
            ...options[1],
            disabled: true,
            disabledReason: 'Session ended — no live terminal to attach',
          },
        ]}
      />,
    );

    const terminal = screen.getByRole('tab', {
      name: 'Terminal — Session ended — no live terminal to attach',
    });
    expect(terminal).toBeDisabled();
    expect(terminal).toHaveAttribute('title', 'Session ended — no live terminal to attach');
    expect(terminal).toHaveAttribute(
      'aria-label',
      'Terminal — Session ended — no live terminal to attach',
    );
  });
});
