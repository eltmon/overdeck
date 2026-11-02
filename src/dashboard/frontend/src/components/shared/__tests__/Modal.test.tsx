import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('labels the dialog by its title and description', () => {
    const { rerender } = render(<Modal title="T" description="D" onClose={() => {}}><button>body</button></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'T' });
    expect(dialog).toHaveAccessibleDescription('D');

    rerender(<Modal title="T" onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'T' })).not.toHaveAttribute('aria-describedby');
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<Modal title="T" onClose={onClose}><button>body</button></Modal>);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'T' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrim click calls onClose', () => {
    const onClose = vi.fn();
    render(<Modal title="T" onClose={onClose}><button>body</button></Modal>);
    const scrim = document.querySelector('[data-component="modal-scrim"]')!;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click inside the panel does not call onClose', () => {
    const onClose = vi.fn();
    render(<Modal title="T" onClose={onClose}><button>body</button></Modal>);
    const panel = screen.getByRole('dialog', { name: 'T' });
    fireEvent.mouseDown(panel);
    fireEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismissible={false} ignores Escape and scrim click and disables Close', () => {
    const onClose = vi.fn();
    render(<Modal title="T" onClose={onClose} dismissible={false}><button>body</button></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'T' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    const scrim = document.querySelector('[data-component="modal-scrim"]')!;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('a child that stops Escape propagation keeps the dialog open', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        <input aria-label="child" onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }} />
      </Modal>,
    );
    fireEvent.keyDown(screen.getByLabelText('child'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the first body control on open and restores focus on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Trigger</button>
          {open && (
            <Modal title="T" onClose={() => setOpen(false)}>
              <input aria-label="first" />
            </Modal>
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByLabelText('first')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(trigger).toHaveFocus();
  });

  it('Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last', () => {
    // The close button is the first focusable in DOM order (it sits in the
    // header, before the body), so it is both ends' wrap target (D8).
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="only" />
      </Modal>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const only = screen.getByLabelText('only');

    only.focus();
    fireEvent.keyDown(only, { key: 'Tab' });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(only).toHaveFocus();
  });

  it('renders a form panel when onSubmit is set and submits from the footer', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <Modal title="T" onClose={() => {}} onSubmit={onSubmit} footer={<button type="submit">Submit</button>}>
        <button>body</button>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders into document.body', () => {
    const { baseElement } = render(
      <div id="container">
        <Modal title="T" onClose={() => {}}><button>body</button></Modal>
      </div>,
    );
    const container = baseElement.querySelector('#container')!;
    const dialog = screen.getByRole('dialog', { name: 'T' });
    expect(container.contains(dialog)).toBe(false);
    expect(baseElement.contains(dialog)).toBe(true);
  });
});
