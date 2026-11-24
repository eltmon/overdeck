/**
 * PAN-5662 WI-3: the shared composer trigger menu and its key handler.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { TriggerMenu, useTriggerMenuKeys } from '../TriggerMenu';
import type { SlashCommand } from '../slashCommandTypes';

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: {
    slashMenu: 'slashMenu',
    slashMenuItem: 'slashMenuItem',
    slashMenuItemSelected: 'slashMenuItemSelected',
    slashMenuLabel: 'slashMenuLabel',
    slashMenuDescription: 'slashMenuDescription',
    slashMenuMatch: 'slashMenuMatch',
    slashMenuHint: 'slashMenuHint',
  },
}));

const noop = () => {};

const ITEMS: SlashCommand[] = [
  { id: 'file-src/a/Composer.tsx', label: 'Composer.tsx', description: 'src/a', insert: '@src/a/Composer.tsx ', category: 'Files' },
  { id: 'mention-docx', label: '$docx', description: 'Write docx', insert: '$docx ', category: 'Skills' },
];

describe('TriggerMenu', () => {
  it('names the listbox from ariaLabel', () => {
    render(<TriggerMenu items={ITEMS} filter="" selectedIndex={0} onSelect={noop} onClose={noop} anchorRect={null} ariaLabel="Files" />);
    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();
  });

  it('groups rows by category', () => {
    render(<TriggerMenu items={ITEMS} filter="" selectedIndex={0} onSelect={noop} onClose={noop} anchorRect={null} ariaLabel="Files" />);
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('shows the hint row and no option when items is empty', () => {
    render(
      <TriggerMenu items={[]} filter="" selectedIndex={0} onSelect={noop} onClose={noop} anchorRect={null} ariaLabel="Files" hint="Type to search files" />,
    );
    expect(screen.getByRole('listbox', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('Type to search files')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('renders nothing when items is empty and there is no hint', () => {
    render(<TriggerMenu items={[]} filter="" selectedIndex={0} onSelect={noop} onClose={noop} anchorRect={null} ariaLabel="Files" />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onSelect with the clicked row', () => {
    const onSelect = vi.fn();
    render(<TriggerMenu items={ITEMS} filter="" selectedIndex={0} onSelect={onSelect} onClose={noop} anchorRect={null} ariaLabel="Files" />);
    fireEvent.click(screen.getByText('$docx'));
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });
});

describe('useTriggerMenuKeys', () => {
  function setup(tabSelects: boolean, rowCount = 2) {
    const onSelectIndex = vi.fn();
    const onClose = vi.fn();
    const setSelectedIndex = vi.fn();
    renderHook(() => useTriggerMenuKeys({
      open: true, rowCount, selectedIndex: 0, setSelectedIndex, onSelectIndex, onClose, tabSelects,
    }));
    return { onSelectIndex, onClose, setSelectedIndex };
  }

  it('selects the current row on Tab when tabSelects is true', () => {
    const { onSelectIndex, onClose } = setup(true);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(onSelectIndex).toHaveBeenCalledWith(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Tab when tabSelects is false', () => {
    const { onSelectIndex, onClose } = setup(false);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectIndex).not.toHaveBeenCalled();
  });

  it('selects on Enter only when rows exist', () => {
    const withRows = setup(true);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(withRows.onSelectIndex).toHaveBeenCalledWith(0);
  });

  it('ignores an IME confirmation Enter', () => {
    const { onSelectIndex } = setup(true);
    fireEvent.keyDown(document, { key: 'Enter', isComposing: true });
    expect(onSelectIndex).not.toHaveBeenCalled();
  });

  it('does not select on Enter with no rows', () => {
    const { onSelectIndex } = setup(true, 0);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelectIndex).not.toHaveBeenCalled();
  });

  it('closes on Escape and moves with the arrow keys', () => {
    const { onClose, setSelectedIndex } = setup(false);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(setSelectedIndex).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
