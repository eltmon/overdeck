import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalSessionWrapper } from './TerminalSessionWrapper';

vi.mock('../XTerminal', () => ({
  XTerminal: function MockXTerminal({
    sessionName,
    onDisconnect,
  }: {
    sessionName: string;
    onDisconnect?: () => void;
  }) {
    return (
      <div data-testid="xterm" data-session={sessionName}>
        <button data-testid="trigger-disconnect" onClick={onDisconnect}>
          disconnect
        </button>
      </div>
    );
  },
}));

vi.mock('lucide-react', () => ({
  WifiOff: () => <span data-testid="wifi-off-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
}));

describe('TerminalSessionWrapper', () => {
  it('initial state renders XTerminal with the correct session name', () => {
    render(<TerminalSessionWrapper sessionName="my-session" />);
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
    expect(screen.getByTestId('xterm')).toHaveAttribute('data-session', 'my-session');
  });

  it('transitions to ended state on disconnect', () => {
    render(<TerminalSessionWrapper sessionName="my-session" />);
    fireEvent.click(screen.getByTestId('trigger-disconnect'));
    expect(screen.queryByTestId('xterm')).not.toBeInTheDocument();
    expect(screen.getByText('Session ended')).toBeInTheDocument();
  });

  it('ended state shows the session name', () => {
    render(<TerminalSessionWrapper sessionName="panopticon-work" />);
    fireEvent.click(screen.getByTestId('trigger-disconnect'));
    expect(screen.getByText(/panopticon-work/)).toBeInTheDocument();
  });

  it('ended state shows retry button', () => {
    render(<TerminalSessionWrapper sessionName="my-session" />);
    fireEvent.click(screen.getByTestId('trigger-disconnect'));
    expect(screen.getByText('Retry connection')).toBeInTheDocument();
  });

  it('clicking Retry transitions back to connecting state', () => {
    render(<TerminalSessionWrapper sessionName="my-session" />);
    fireEvent.click(screen.getByTestId('trigger-disconnect'));
    expect(screen.getByText('Session ended')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry connection'));
    expect(screen.getByTestId('xterm')).toBeInTheDocument();
    expect(screen.queryByText('Session ended')).not.toBeInTheDocument();
  });

  it('fires onSessionEnded callback on disconnect', () => {
    const onSessionEnded = vi.fn();
    render(<TerminalSessionWrapper sessionName="my-session" onSessionEnded={onSessionEnded} />);
    fireEvent.click(screen.getByTestId('trigger-disconnect'));
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it('does not fire onSessionEnded when not provided', () => {
    // Should not throw when onSessionEnded is undefined
    expect(() => {
      render(<TerminalSessionWrapper sessionName="my-session" />);
      fireEvent.click(screen.getByTestId('trigger-disconnect'));
    }).not.toThrow();
  });
});
