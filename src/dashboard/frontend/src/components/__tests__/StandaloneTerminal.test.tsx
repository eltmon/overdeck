import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StandaloneTerminal } from '../StandaloneTerminal';

vi.mock('../XTerminal', () => ({
  XTerminal: function MockXTerminal({ sessionName }: { sessionName: string }) {
    return <div data-testid="xterm">terminal-{sessionName}</div>;
  },
}));

vi.mock('lucide-react', () => ({
  Pin: () => <span data-testid="pin-icon" />,
  PinOff: () => <span data-testid="pin-off-icon" />,
}));

describe('StandaloneTerminal', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'title', {
      value: '',
      writable: true,
      configurable: true,
    });
    window.history.replaceState(null, '', '/');
    delete window.panopticonBridge;
  });

  it('renders the terminal for the requested session', () => {
    render(<StandaloneTerminal sessionName="agent-PAN-486" />);
    expect(screen.getByTestId('xterm')).toHaveTextContent('terminal-agent-PAN-486');
  });

  it('uses the session name when no explicit title is provided', () => {
    render(<StandaloneTerminal sessionName="my-session" />);
    expect(screen.getByText('my-session')).toBeInTheDocument();
  });

  it('prefers the URL title over document.title', () => {
    document.title = 'Stale title';
    window.history.replaceState(null, '', '/terminal/agent?title=PAN-486%20Popup');
    render(<StandaloneTerminal sessionName="agent" />);
    expect(screen.getByText('PAN-486 Popup')).toBeInTheDocument();
  });

  it('toggles always-on-top through the desktop bridge', async () => {
    const user = userEvent.setup();
    const setAlwaysOnTop = vi.fn();
    window.panopticonBridge = {
      isDesktopApp: () => true,
      setAlwaysOnTop,
    } as unknown as OverdeckBridge;

    render(<StandaloneTerminal sessionName="agent" />);

    await user.click(screen.getByRole('button', { name: /enable always on top/i }));
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('pin-off-icon')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /disable always on top/i }));
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it('falls back to focusing the browser window outside Electron', async () => {
    const user = userEvent.setup();
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});

    render(<StandaloneTerminal sessionName="agent" />);
    await user.click(screen.getByRole('button', { name: /enable always on top/i }));

    expect(focusSpy).toHaveBeenCalled();
  });
});
