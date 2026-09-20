import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MenuItemButton, MenuSurface, PopoverSurface } from './ContextMenu';

function MenuHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>Open actions</button>
      {open ? (
        <MenuSurface aria-label="Actions" onClose={() => setOpen(false)} returnFocusRef={triggerRef}>
          <MenuItemButton>First action</MenuItemButton>
          <MenuItemButton disabled>Unavailable action</MenuItemButton>
          <MenuItemButton destructive>Archive</MenuItemButton>
        </MenuSurface>
      ) : null}
    </>
  );
}

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>Restart sessions</button>
      {open ? (
        <PopoverSurface aria-label="Restart options" onClose={() => setOpen(false)} returnFocusRef={triggerRef}>
          <label><input type="checkbox" /> Conversations</label>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </PopoverSurface>
      ) : null}
    </>
  );
}

describe('shared popup primitives', () => {
  it('uses the canonical menu frame and supports arrow navigation, Escape, and focus return', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: 'Open actions' });
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(menu).toHaveClass('bg-popover', 'shadow-floating', 'border-border');
    expect(screen.getByRole('menuitem', { name: 'First action' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Actions' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('gives popovers the same frame and restores focus after keyboard dismissal', () => {
    render(<PopoverHarness />);
    const trigger = screen.getByRole('button', { name: 'Restart sessions' });
    fireEvent.click(trigger);

    const popover = screen.getByRole('dialog', { name: 'Restart options' });
    expect(popover).toHaveClass('bg-popover', 'shadow-floating', 'border-border');
    expect(screen.getByRole('checkbox', { name: 'Conversations' })).toHaveFocus();

    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Restart options' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
