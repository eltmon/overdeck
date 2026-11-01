/** PAN-4650 WI-14: the Pull here dialog's choices, its polled four steps, and the header button's pullable gate. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startPull = vi.fn(async (_conversation: string, _when: 'wait' | 'stop') => 'pull-1');
const getPull = vi.fn();

vi.mock('../pullApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pullApi')>()),
  startPull: (conversation: string, when: 'wait' | 'stop') => startPull(conversation, when),
  getPull: (pullId: string) => getPull(pullId),
}));
vi.mock('../../Settings/anywhere/machinesApi', () => ({ reconnectMachine: vi.fn() }));

import type { Conversation } from '../../CommandDeck/ConversationList';
import { PullHereButton } from '../ConversationMachineBanner';
import { PULL_POLL_MS } from '../pullApi';
import { PullHereDialog, usePullHereStore, type PullTarget } from '../PullHereDialog';

const TARGET: PullTarget = { name: '@env-desk/conv-x', title: 'Fix the deploy', machineLabel: 'desk', isWorking: false };

beforeEach(() => {
  vi.useFakeTimers();
  startPull.mockClear();
  getPull.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  usePullHereStore.getState().close();
});

const buttonNames = () => screen.getAllByRole('button').map((button) => button.textContent);

describe('PullHereDialog (PAN-4650 WI-14)', () => {
  it('ac1: offers Wait for this turn and Stop it now while a turn runs, one Pull here otherwise', () => {
    const { unmount } = render(<PullHereDialog target={{ ...TARGET, isWorking: true }} onClose={vi.fn()} />);
    expect(buttonNames()).toEqual(['', 'Cancel', 'Stop it now', 'Wait for this turn']);
    unmount();
    render(<PullHereDialog target={TARGET} onClose={vi.fn()} />);
    expect(buttonNames()).toEqual(['', 'Cancel', 'Pull here']);
  });

  it('ac2: Stop it now asks for whenTurnRunning stop', async () => {
    render(<PullHereDialog target={{ ...TARGET, isWorking: true }} onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('Stop it now')); });
    expect(startPull).toHaveBeenCalledWith('@env-desk/conv-x', 'stop');
  });

  it('ac3: renders the four steps from polled job states and opens the new conversation on done', async () => {
    getPull
      .mockResolvedValueOnce({ step: 'transfer', state: 'running' })
      .mockResolvedValueOnce({ step: 'adopt', state: 'running' })
      .mockResolvedValueOnce({ step: 'finish', state: 'done', conversation: { id: 812, name: 'conv-new' } });
    const pushState = vi.spyOn(window.history, 'pushState');
    const onClose = vi.fn();
    render(<PullHereDialog target={TARGET} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByText('Pull here')); });

    const steps = () => [...screen.getByTestId('pull-steps').querySelectorAll('li')].map((li) => li.dataset.step);
    expect(steps()).toEqual(['release', 'transfer', 'adopt', 'finish']);
    expect(screen.getByTestId('pull-steps').querySelector('[data-live]')?.getAttribute('data-step')).toBe('release');

    await act(async () => { await vi.advanceTimersByTimeAsync(PULL_POLL_MS); });
    expect(screen.getByTestId('pull-steps').querySelector('[data-live]')?.getAttribute('data-step')).toBe('transfer');
    // Each poll is scheduled after the previous answer renders.
    await act(async () => { await vi.advanceTimersByTimeAsync(PULL_POLL_MS); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PULL_POLL_MS); });

    expect(onClose).toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith(null, '', '/conv/812');
  });

  it('says the conversation still runs on the owner when the job fails', async () => {
    getPull.mockResolvedValueOnce({ step: 'adopt', state: 'failed', error: 'No checkout of overdeck', code: 'no-target' });
    render(<PullHereDialog target={TARGET} onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('Pull here')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(PULL_POLL_MS); });
    expect(screen.getByRole('alert').textContent).toBe('No checkout of overdeck. The conversation is still running on desk.');
  });

  it('lets the operator close the dialog when a poll fails while the pull runs', async () => {
    getPull.mockRejectedValueOnce(new Error('HTTP 404'));
    const onClose = vi.fn();
    render(<PullHereDialog target={TARGET} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByText('Pull here')); });
    expect(screen.queryByLabelText('Close')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(PULL_POLL_MS); });
    expect(screen.getByRole('alert').textContent).toBe('Lost track of the pull: HTTP 404. It may still finish; the conversation list shows where it runs.');
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PullHereButton (PAN-4650 WI-14)', () => {
  const remote = {
    id: -3, name: '@env-desk/conv-x', tmuxSession: 'conv-x', status: 'active', cwd: '/w', issueId: null, createdAt: '2026-11-01T10:00:00.000Z',
    endedAt: null, lastAttachedAt: null, sessionAlive: true, origin: 'linked', environmentId: 'env-desk', machineLabel: 'desk', machineState: 'online',
  } as Conversation;

  function renderButton(conv: Conversation) {
    return render(<QueryClientProvider client={new QueryClient()}><PullHereButton conversation={conv} /></QueryClientProvider>);
  }

  it('ac4: renders no Pull here for a row the owner cannot hand over, and opens the dialog otherwise', () => {
    const { container, unmount } = renderButton({ ...remote, pullable: false });
    expect(container.textContent).toBe('');
    unmount();
    renderButton({ ...remote, pullable: true, isWorking: true });
    fireEvent.click(screen.getByText('Pull here'));
    expect(usePullHereStore.getState().target).toMatchObject({ name: '@env-desk/conv-x', machineLabel: 'desk', isWorking: true, offline: false });
  });

  it('hides Pull here for local and offline rows', () => {
    const { container } = renderButton({ ...remote, machineState: 'offline', pullable: true });
    expect(container.textContent).toBe('');
  });
});
