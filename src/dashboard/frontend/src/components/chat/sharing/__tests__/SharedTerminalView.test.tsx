/** PAN-4477 WI-8: the viewer's read-only xterm, sized to the host terminal. */
import { act, render, screen } from '@testing-library/react';
import type { TerminalPayload } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import { SharedTerminalView } from '../SharedTerminalView';

const xterm = vi.hoisted(() => ({ instances: [] as Array<Record<string, unknown> & { options: Record<string, unknown> }> }));

// Plain class like XTerminal.test.tsx: xterm's real DOM and media-query work breaks in jsdom.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>;
    open = vi.fn();
    write = vi.fn();
    reset = vi.fn();
    resize = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose() {} }));
    onKey = vi.fn(() => ({ dispose() {} }));
    attachCustomKeyEventHandler = vi.fn();
    calls: string[] = [];
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      for (const name of ['reset', 'resize', 'write'] as const) {
        this[name].mockImplementation((...args: unknown[]) => { this.calls.push(`${name}(${args.join(',')})`); });
      }
      xterm.instances.push(this as never);
    }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

function setup() {
  xterm.instances.length = 0;
  let listener: ((payload: TerminalPayload) => void) | null = null;
  const stop = vi.fn();
  const watch = vi.fn((next: (payload: TerminalPayload) => void) => {
    listener = next;
    return stop;
  });
  const view = render(<SharedTerminalView watch={watch} />);
  const term = xterm.instances[0] as unknown as {
    options: Record<string, unknown>;
    calls: string[];
    onData: ReturnType<typeof vi.fn>;
    onKey: ReturnType<typeof vi.fn>;
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  const send = (payload: TerminalPayload) => act(() => listener?.(payload));
  return { view, watch, stop, term, send };
}

describe('SharedTerminalView', () => {
  it('creates a read-only terminal with no input handler and starts the watch', () => {
    const { watch, term } = setup();
    expect(term.options.disableStdin).toBe(true);
    expect(term.onData).not.toHaveBeenCalled();
    expect(term.onKey).not.toHaveBeenCalled();
    expect(term.attachCustomKeyEventHandler).not.toHaveBeenCalled();
    expect(watch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('shared-terminal')).toBeTruthy();
    expect(screen.getByText("Read-only — you are watching the host's terminal.")).toBeTruthy();
  });

  it('applies snapshot, output and size payloads to the terminal in order', () => {
    const { term, send } = setup();
    send({ kind: 'snapshot', cols: 100, rows: 30, data: 'SCREEN' });
    send({ kind: 'output', data: 'more' });
    send({ kind: 'size', cols: 120, rows: 40 });
    expect(term.calls).toEqual(['reset()', 'resize(100,30)', 'write(SCREEN)', 'write(more)', 'resize(120,40)']);
  });

  it('shows the not-running notice and clears it on the next snapshot', () => {
    const { send } = setup();
    send({ kind: 'unavailable', reason: 'terminal_not_found' });
    expect(screen.getByRole('status').textContent).toBe("The host's terminal is not running.");
    send({ kind: 'snapshot', cols: 80, rows: 24, data: '' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the ended notice', () => {
    const { send } = setup();
    send({ kind: 'unavailable', reason: 'terminal_ended' });
    expect(screen.getByRole('status').textContent).toBe("The host's terminal session ended.");
  });

  it('stops the watch and disposes the terminal on unmount', () => {
    const { view, stop, term } = setup();
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(term.dispose).toHaveBeenCalledTimes(1);
  });
});
