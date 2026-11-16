import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';
import styles from '../Modal.module.css';

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
  it('alert renders role alertdialog', () => {
    render(<Modal title="T" alert onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('alertdialog', { name: 'T' })).toBeInTheDocument();
  });

  it('ariaLabel overrides the accessible name', () => {
    render(<Modal title="T" ariaLabel="Old name" onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'Old name' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'T' })).toBeInTheDocument();
  });

  it('closeLabel names the close button', () => {
    const onClose = vi.fn();
    render(<Modal title="T" closeLabel="Close tasks viewer" onClose={onClose}><button>body</button></Modal>);
    fireEvent.click(screen.getByRole('button', { name: 'Close tasks viewer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('headerActions render before Close', () => {
    render(
      <Modal title="T" onClose={() => {}} headerActions={<button type="button">Help</button>}>
        <button>body</button>
      </Modal>,
    );
    const modal = document.querySelector('[data-component="modal"]')!;
    const help = screen.getByRole('button', { name: 'Help' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(modal.contains(help)).toBe(true);
    expect(help.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('headless renders no header and labels by labelledBy', () => {
    render(
      <Modal title="T" headless labelledBy="x" onClose={() => {}}>
        <h1 id="x">Step heading</h1>
        <button>body</button>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Step heading' })).toBeInTheDocument();
  });

  it('describedBy sets aria-describedby', () => {
    render(
      <Modal title="T" describedBy="q0" onClose={() => {}}>
        <p id="q0">Question</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'T' })).toHaveAttribute('aria-describedby', 'q0');
  });

  it('size classes', () => {
    const { rerender } = render(<Modal title="T" size="narrow" onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'T' })).toHaveClass(styles.sizeNarrow!);
    rerender(<Modal title="T" onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'T' })).toHaveClass(styles.sizeDefault!);
    expect(screen.getByRole('dialog', { name: 'T' })).not.toHaveClass(styles.sizeNarrow!);
  });

  it('tone warning adds the warning class', () => {
    const { rerender } = render(<Modal title="T" onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'T' })).not.toHaveClass(styles.warning!);
    rerender(<Modal title="T" tone="warning" onClose={() => {}}><button>body</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'T' })).toHaveClass(styles.warning!);
  });

  it('onKeyDown runs first and preventDefault skips Escape', () => {
    const onClose = vi.fn();
    const preventing = vi.fn((event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') event.preventDefault();
    });
    const { rerender } = render(<Modal title="T" onKeyDown={preventing} onClose={onClose}><button>body</button></Modal>);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'T' }), { key: 'Escape' });
    expect(preventing).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    const passing = vi.fn();
    rerender(<Modal title="T" onKeyDown={passing} onClose={onClose}><button>body</button></Modal>);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'T' }), { key: 'Escape' });
    expect(passing).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape in a nested Modal closes only the inner one', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Modal title="Outer" onClose={outerClose}>
        <button>outer body</button>
        <Modal title="Inner" onClose={innerClose}>
          <button>inner body</button>
        </Modal>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Inner' }), { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('a click inside the Modal does not reach a React ancestor', () => {
    const spy = vi.fn();
    render(
      <div onClick={spy}>
        <Modal title="T" onClose={() => {}}>
          <button>Inside</button>
        </Modal>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps focus a child placed with autoFocus and restores the opener', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Trigger</button>
          {open && (
            <Modal title="T" onClose={() => setOpen(false)}>
              <button>first</button>
              <input aria-label="auto" autoFocus />
            </Modal>
          )}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByLabelText('auto')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(trigger).toHaveFocus();
  });
  it('refocuses the panel when a body swap removes the focused control', async () => {
    function Swapper() {
      const [done, setDone] = useState(false);
      return (
        <Modal title="T" onClose={() => {}}>
          {done ? <p>Result</p> : <button onClick={() => setDone(true)}>Create</button>}
        </Modal>
      );
    }
    render(<Swapper />);
    const create = screen.getByRole('button', { name: 'Create' });
    create.focus();
    fireEvent.click(create);
    await screen.findByText('Result');
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'T' })).toHaveFocus());
  });
  it('refocuses the panel when dropping onSubmit remounts the panel', async () => {
    function FormThenResult() {
      const [done, setDone] = useState(false);
      return (
        <Modal
          title="T"
          onClose={() => {}}
          onSubmit={done ? undefined : (event) => { event.preventDefault(); setDone(true); }}
          footer={done ? undefined : <button type="submit">Create</button>}
        >
          {done ? <p>Result</p> : <input aria-label="name" />}
        </Modal>
      );
    }
    render(<FormThenResult />);
    const create = screen.getByRole('button', { name: 'Create' });
    create.focus();
    fireEvent.click(create);
    await screen.findByText('Result');
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'T' })).toHaveFocus());
  });
});
