import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import { TerminalDrawer } from './TerminalDrawer';
import { useTerminalStateStore } from './terminalStateStore';
import { PENDING_TERMINAL_EVENT, writePendingTerminal } from '../home/pendingTerminal';

vi.mock('../XTerminal', () => ({
  XTerminal: () => <div data-testid="xterm-stub" />,
}));

function mockCreateTerminalResponses(names: string[]) {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const sessionName = names[call] ?? `term-${call}`;
      call += 1;
      return new Response(JSON.stringify({ sessionName }), { status: 200 });
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  useTerminalStateStore.setState({ terminalStateByThreadId: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TerminalDrawer pending-terminal hand-off', () => {
  it('fresh drawer passes the pending command to its single bootstrap session', async () => {
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    mockCreateTerminalResponses(['term-1']);

    render(<TerminalDrawer threadId="proj-a" cwd="/proj-a" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ cwd: '/proj-a', command: 'npm test' });
  });

  it('drawer with a live terminal opens a second terminal for a pending command', async () => {
    useTerminalStateStore.getState().newTerminal('proj-a', 'term-existing');
    writePendingTerminal({ deckKey: 'proj-a', command: 'npm test' });
    mockCreateTerminalResponses(['term-2']);

    render(<TerminalDrawer threadId="proj-a" cwd="/proj-a" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ cwd: '/proj-a', command: 'npm test' });
  });

  it('a pending-terminal event for this deck starts a new terminal', async () => {
    useTerminalStateStore.getState().newTerminal('proj-a', 'term-existing');
    mockCreateTerminalResponses(['term-2']);

    render(<TerminalDrawer threadId="proj-a" cwd="/proj-a" />);
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      writePendingTerminal({ deckKey: 'proj-a', command: 'echo hi' });
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ cwd: '/proj-a', command: 'echo hi' });
  });

  it('a hand-off for another deck is ignored', async () => {
    useTerminalStateStore.getState().newTerminal('proj-a', 'term-existing');
    mockCreateTerminalResponses(['term-2']);

    render(<TerminalDrawer threadId="proj-a" cwd="/proj-a" />);

    act(() => {
      window.dispatchEvent(new CustomEvent(PENDING_TERMINAL_EVENT, { detail: { deckKey: 'proj-b' } }));
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
  });
});
