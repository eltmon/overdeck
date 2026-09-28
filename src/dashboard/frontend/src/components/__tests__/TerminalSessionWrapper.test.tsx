import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalSessionWrapper } from '../TerminalSessionWrapper';

vi.mock('../XTerminal', () => ({
  XTerminal: ({ onDisconnect }: { onDisconnect?: () => void }) => (
    <div>
      <div data-testid="x-terminal" />
      <button type="button" onClick={() => onDisconnect?.()}>trigger-disconnect</button>
    </div>
  ),
}));

const ACCENT_ORANGE = '#fb923c';

describe('TerminalSessionWrapper', () => {
  it('renders the fallback label without the orange border after onDisconnect (PAN-4290)', () => {
    const { container } = render(<TerminalSessionWrapper sessionName="agent-pan-1" />);
    fireEvent.click(screen.getByText('trigger-disconnect'));

    expect(screen.getByText('Session ended')).toBeInTheDocument();
    const ring = container.querySelector('.rounded-full');
    expect(ring).not.toHaveStyle({ border: `1.5px solid ${ACCENT_ORANGE}` });
  });

  it('renders an attention outcome with the orange border', () => {
    const { container } = render(
      <TerminalSessionWrapper
        sessionName="agent-pan-1"
        outcome={{ kind: 'ended-unexpectedly', label: 'Ended unexpectedly', detail: 'The session recorded an error before it ended.', tone: 'attention' }}
      />,
    );
    fireEvent.click(screen.getByText('trigger-disconnect'));

    expect(screen.getByText('Ended unexpectedly')).toBeInTheDocument();
    const ring = container.querySelector('.rounded-full');
    expect(ring).toHaveStyle({ border: `1.5px solid ${ACCENT_ORANGE}` });
  });

  it('renders a quiet outcome without the orange border', () => {
    const { container } = render(
      <TerminalSessionWrapper
        sessionName="agent-pan-1"
        outcome={{ kind: 'merged', label: 'Merged', detail: "The work agent's PR merged.", tone: 'quiet' }}
      />,
    );
    fireEvent.click(screen.getByText('trigger-disconnect'));

    expect(screen.getByText('Merged')).toBeInTheDocument();
    const ring = container.querySelector('.rounded-full');
    expect(ring).not.toHaveStyle({ border: `1.5px solid ${ACCENT_ORANGE}` });
  });
});
