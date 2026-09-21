import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRoot,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  MenuItemButton,
  MenuSurface,
  PopoverSurface,
} from './ContextMenu';

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

  it('does not steal focus from a successor dialog the menu action opened', () => {
    render(<MenuToDialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open actions' });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Fork' }));
    const dialogField = screen.getByRole('textbox', { name: 'Fork name' });
    // Native autofocus lands on the dialog field in the commit phase; the
    // closing menu's focus restoration must not drag focus back to the trigger.
    expect(dialogField).toHaveFocus();
    expect(screen.queryByRole('menu', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('restores focus when Escape strands it inside the closing menu', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: 'Open actions' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Actions' });
    expect(screen.getByRole('menuitem', { name: 'First action' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('keeps Radix context-menu items visibly disabled via data-disabled styling', async () => {
    render(
      <ContextMenuRoot>
        <ContextMenuTrigger className="trigger">row area</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled>Disabled action</ContextMenuItem>
          <ContextMenuItem>Enabled action</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled>Disabled submenu</ContextMenuSubTrigger>
            <ContextMenuSubContent />
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenuRoot>,
    );

    fireEvent.contextMenu(screen.getByText('row area'));
    const disabledItem = await screen.findByRole('menuitem', { name: 'Disabled action' });
    expect(disabledItem).toHaveAttribute('data-disabled');
    expect(disabledItem.className).toContain('data-[disabled]:pointer-events-none');
    expect(disabledItem.className).toContain('data-[disabled]:opacity-40');
    const disabledSub = screen.getByRole('menuitem', { name: 'Disabled submenu' });
    expect(disabledSub).toHaveAttribute('data-disabled');
    expect(disabledSub.className).toContain('data-[disabled]:opacity-40');
  });

  it('Escape closes only the innermost nested menu', () => {
    render(<NestedMenuHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move' }));

    const inner = screen.getByRole('menu', { name: 'Move targets' });
    expect(screen.getByRole('menuitem', { name: 'Project A' })).toHaveFocus();

    fireEvent.keyDown(inner, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Move targets' })).not.toBeInTheDocument();
    // The parent menu stays open, and focus returns to the item that opened the submenu.
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Move' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Actions' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Actions' })).not.toBeInTheDocument();
  });
});

function MenuToDialogHarness() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} onClick={() => setMenuOpen(true)}>Open actions</button>
      {menuOpen ? (
        <MenuSurface aria-label="Actions" onClose={() => setMenuOpen(false)} returnFocusRef={triggerRef}>
          <MenuItemButton onClick={() => { setDialogOpen(true); setMenuOpen(false); }}>Fork</MenuItemButton>
        </MenuSurface>
      ) : null}
      {dialogOpen ? (
        <div role="dialog" aria-label="Fork dialog">
          {/* Native autofocus, mirroring ForkModal's input */}
          <input aria-label="Fork name" autoFocus />
        </div>
      ) : null}
    </>
  );
}

function NestedMenuHarness() {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>Open actions</button>
      {open ? (
        <MenuSurface aria-label="Actions" onClose={() => setOpen(false)} returnFocusRef={triggerRef}>
          <MenuItemButton onClick={() => setSubOpen(true)}>Move</MenuItemButton>
          {subOpen ? (
            <MenuSurface aria-label="Move targets" onClose={() => setSubOpen(false)}>
              <MenuItemButton>Project A</MenuItemButton>
            </MenuSurface>
          ) : null}
        </MenuSurface>
      ) : null}
    </>
  );
}
