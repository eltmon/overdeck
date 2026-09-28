import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
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
  it('a printable key on body focuses the input', () => {
    render(<Harness />);
    document.body.focus();
    fireEvent.keyDown(document, { key: 'h' });
    expect(document.activeElement).toBe(screen.getByTestId('target'));
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
});
