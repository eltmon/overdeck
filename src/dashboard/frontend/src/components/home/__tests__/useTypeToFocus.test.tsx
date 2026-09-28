import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { useTypeToFocus } from '../useTypeToFocus';

function Harness() {
  const ref = useRef<HTMLInputElement>(null);
  useTypeToFocus(ref);
  return (
    <div>
      <input ref={ref} data-testid="target" />
      <textarea data-testid="other-input" />
    </div>
  );
}

describe('useTypeToFocus', () => {
  it('a printable key on body focuses the input and the character lands in it', () => {
    render(<Harness />);
    document.body.focus();
    fireEvent.keyDown(document, { key: 'h' });
    expect(document.activeElement).toBe(screen.getByTestId('target'));
    expect(screen.getByTestId('target')).toHaveValue('h');
  });

  it('Ctrl+K does not', () => {
    render(<Harness />);
    document.body.focus();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(document.activeElement).not.toBe(screen.getByTestId('target'));
  });

  it('a key while a textarea has focus does not', () => {
    render(<Harness />);
    screen.getByTestId('other-input').focus();
    fireEvent.keyDown(document, { key: 'h' });
    expect(document.activeElement).toBe(screen.getByTestId('other-input'));
  });

  it('a key while a dialog is open does not', () => {
    const { container } = render(
      <div>
        <Harness />
        <div role="dialog">modal</div>
      </div>,
    );
    document.body.focus();
    fireEvent.keyDown(document, { key: 'h' });
    expect(document.activeElement).not.toBe(container.querySelector('[data-testid="target"]'));
  });

  describe('a bubble-phase global shortcut that would otherwise claim the key first', () => {
    let bubbleListener: (e: KeyboardEvent) => void;

    afterEach(() => {
      document.removeEventListener('keydown', bubbleListener);
    });

    function installCompetingBubbleListener() {
      // Mirrors App.tsx's global 'g' lens-chord / '/' search handler: a
      // bubble-phase document listener that preventDefault()s on any
      // non-input target. Registered BEFORE the hook mounts (and the event is
      // dispatched on a descendant of document, so real capture/bubble
      // propagation applies) to prove capture-phase precedence does not
      // depend on listener registration order.
      bubbleListener = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (!inInput) e.preventDefault();
      };
      document.addEventListener('keydown', bubbleListener);
    }

    it('a leading "g" still lands in the composer', () => {
      installCompetingBubbleListener();
      render(<Harness />);
      document.body.focus();
      fireEvent.keyDown(document.body, { key: 'g' });
      expect(document.activeElement).toBe(screen.getByTestId('target'));
      expect(screen.getByTestId('target')).toHaveValue('g');
    });

    it('a leading "/" still lands in the composer', () => {
      installCompetingBubbleListener();
      render(<Harness />);
      document.body.focus();
      fireEvent.keyDown(document.body, { key: '/' });
      expect(screen.getByTestId('target')).toHaveValue('/');
    });
  });
});
