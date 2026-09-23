/**
 * PAN-3974 — the conversation TERMINAL view: native companion for OpenCode,
 * unchanged owner pane for every other harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConversationTerminalView } from '../ConversationTerminalView';

const api = vi.hoisted(() => ({
  openCompanionTerminal: vi.fn(),
  closeCompanionTerminal: vi.fn(),
}));
vi.mock('../companionTerminalApi', () => api);

const terminals = vi.hoisted(() => ({ onDisconnect: new Map<string, () => void>() }));
vi.mock('../../XTerminal', () => ({
  XTerminal: ({ sessionName, onDisconnect }: { sessionName: string; onDisconnect?: () => void }) => {
    if (onDisconnect) terminals.onDisconnect.set(sessionName, onDisconnect);
    return <div data-testid="xterminal" data-session={sessionName} />;
  },
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const OPENCODE = { name: '20260923-0001', tmuxSession: 'conv-20260923-0001', harness: 'opencode' };
const GENERATION = 'abcdefabcdefabcdefabcdef';
const ATTACHED = {
  status: 'attached',
  kind: 'opencode-attach',
  sessionName: 'companion-conv-20260923-0001',
  generation: GENERATION,
  reused: false,
};

function terminalSession(): string | null {
  return screen.queryByTestId('xterminal')?.getAttribute('data-session') ?? null;
}

describe('ConversationTerminalView', () => {
  beforeEach(() => {
    api.openCompanionTerminal.mockReset();
    api.closeCompanionTerminal.mockReset();
    terminals.onDisconnect.clear();
  });
  afterEach(() => cleanup());

  it.each(['claude-code', 'codex', 'acp', 'kimi-code', 'ohmypi', 'muse', null])(
    'keeps the owner pane for harness %s and never opens a companion',
    (harness) => {
      render(<ConversationTerminalView conversation={{ ...OPENCODE, harness }} />);
      expect(terminalSession()).toBe('conv-20260923-0001');
      expect(screen.queryByRole('tablist', { name: 'Terminal pane' })).not.toBeInTheDocument();
      expect(api.openCompanionTerminal).not.toHaveBeenCalled();
    },
  );

  it('attaches the native CLI companion for OpenCode', async () => {
    api.openCompanionTerminal.mockResolvedValue(ATTACHED);

    render(<ConversationTerminalView conversation={OPENCODE} />);

    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));
    expect(api.openCompanionTerminal).toHaveBeenCalledWith('20260923-0001');
    expect(screen.getByRole('tab', { name: 'Native CLI' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the owner pane under Runtime log and reuses the companion on return', async () => {
    api.openCompanionTerminal.mockResolvedValue(ATTACHED);
    render(<ConversationTerminalView conversation={OPENCODE} />);
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));

    fireEvent.click(screen.getByRole('tab', { name: 'Runtime log' }));
    expect(terminalSession()).toBe('conv-20260923-0001');

    api.openCompanionTerminal.mockResolvedValue({ ...ATTACHED, reused: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Native CLI' }));
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));
    expect(api.openCompanionTerminal).toHaveBeenCalledTimes(2);
    expect(api.closeCompanionTerminal).not.toHaveBeenCalled();
  });

  it('explains restart-required without retrying and offers the runtime log', async () => {
    api.openCompanionTerminal.mockResolvedValue({
      status: 'unavailable',
      kind: 'opencode-attach',
      reason: 'restart-required',
      message: 'This OpenCode conversation started before Overdeck recorded its server port. Stop and resume the conversation.',
    });
    render(<ConversationTerminalView conversation={OPENCODE} />);

    expect(await screen.findByText('Restart required for the native CLI')).toBeInTheDocument();
    expect(screen.getByText(/Stop and resume the conversation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(terminalSession()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show runtime log' }));
    expect(terminalSession()).toBe('conv-20260923-0001');
    expect(api.openCompanionTerminal).toHaveBeenCalledTimes(1);
  });

  it('Close stops the companion with its generation and leaves a reopen action', async () => {
    api.openCompanionTerminal.mockResolvedValue(ATTACHED);
    api.closeCompanionTerminal.mockResolvedValue({ status: 'closed', kind: 'opencode-attach' });
    render(<ConversationTerminalView conversation={OPENCODE} />);
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));

    fireEvent.click(screen.getByRole('button', { name: /Close native CLI/ }));

    expect(await screen.findByText('Native CLI closed')).toBeInTheDocument();
    expect(api.closeCompanionTerminal).toHaveBeenCalledWith('20260923-0001', GENERATION);
    expect(terminalSession()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open native CLI' }));
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));
  });

  it('surfaces a stale-generation close without claiming it closed', async () => {
    api.openCompanionTerminal.mockResolvedValue(ATTACHED);
    api.closeCompanionTerminal.mockResolvedValue({ status: 'stale-generation', message: 'This terminal belongs to an earlier run.' });
    render(<ConversationTerminalView conversation={OPENCODE} />);
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));

    fireEvent.click(screen.getByRole('button', { name: /Close native CLI/ }));

    expect(await screen.findByText('This terminal belongs to an earlier run.')).toBeInTheDocument();
    expect(screen.queryByText('Native CLI closed')).not.toBeInTheDocument();
  });

  it('never closes the companion on unmount (browser disconnect keeps it)', async () => {
    api.openCompanionTerminal.mockResolvedValue(ATTACHED);
    const { unmount } = render(<ConversationTerminalView conversation={OPENCODE} />);
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));

    unmount();

    expect(api.closeCompanionTerminal).not.toHaveBeenCalled();
  });

  it('explains a native CLI that exited and offers to reopen', async () => {
    api.openCompanionTerminal.mockResolvedValue(ATTACHED);
    render(<ConversationTerminalView conversation={OPENCODE} />);
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));

    act(() => terminals.onDisconnect.get('companion-conv-20260923-0001')?.());

    expect(await screen.findByText('Native CLI exited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open native CLI' })).toBeInTheDocument();
  });

  it('ignores a slow earlier open once a newer one answered', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    api.openCompanionTerminal
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ status: 'unavailable', kind: 'opencode-attach', reason: 'owner-starting', message: 'Starting.' });
    render(<ConversationTerminalView conversation={OPENCODE} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Runtime log' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Native CLI' }));
    expect(await screen.findByText('Starting.')).toBeInTheDocument();

    await act(async () => resolveFirst(ATTACHED));
    expect(terminalSession()).toBeNull();
    expect(screen.getByText('Starting.')).toBeInTheDocument();
  });

  it('shows an open failure with a retry', async () => {
    api.openCompanionTerminal.mockRejectedValueOnce(new Error('Terminal open failed (500)')).mockResolvedValueOnce(ATTACHED);
    render(<ConversationTerminalView conversation={OPENCODE} />);

    expect(await screen.findByText('Terminal open failed (500)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(terminalSession()).toBe('companion-conv-20260923-0001'));
  });
});
