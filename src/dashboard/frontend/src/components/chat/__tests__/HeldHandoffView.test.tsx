/**
 * PAN-4596 WI-2 — the held handoff view for an ended `--hold` successor:
 * it shows what the conversation waits for and offers Start and Archive,
 * never Resume.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockStartHeldKickoff, mockToastError, mockToastInfo } = vi.hoisted(() => ({
  mockStartHeldKickoff: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
}));

vi.mock('../heldKickoff', async (importOriginal) => ({
  HeldKickoffConflictError: (await importOriginal<typeof import('../heldKickoff')>()).HeldKickoffConflictError,
  startHeldKickoff: (...args: unknown[]) => mockStartHeldKickoff(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../CommandDeck/styles/command-deck.module.css', () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { HeldHandoffView } from '../HeldHandoffView';
import { HeldKickoffConflictError } from '../heldKickoff';

function renderView(overrides: Partial<Parameters<typeof HeldHandoffView>[0]> = {}) {
  const onStarted = vi.fn();
  const onArchive = vi.fn();
  render(
    <HeldHandoffView
      conversationName="conv-a"
      kickoffText="KICKOFF BODY"
      focus="Read the brief"
      cwd="/home/op/Projects/repo"
      handoffDocPath="/home/op/.overdeck/handoffs/conv-a.md"
      onStarted={onStarted}
      onArchive={onArchive}
      {...overrides}
    />,
  );
  return { onStarted, onArchive };
}

describe('HeldHandoffView (PAN-4596)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the title, focus, working directory, handoff doc and kickoff, with Start and Archive and no Resume', () => {
    renderView();
    const view = screen.getByTestId('held-handoff-view');
    expect(view).toHaveTextContent('Held handoff — kickoff not sent');
    expect(view).toHaveTextContent('Focus: Read the brief');
    expect(view).toHaveTextContent('/home/op/Projects/repo');
    expect(view).toHaveTextContent('/home/op/.overdeck/handoffs/conv-a.md');
    expect(screen.getByText('KICKOFF BODY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByText(/Resume/)).toBeNull();
  });

  it('Open handoff doc opens the handoff-doc route in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Open handoff doc' }));
    expect(open).toHaveBeenCalledWith('/api/conversations/conv-a/handoff-doc', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('omits the focus and handoff doc lines when they are absent', () => {
    renderView({ focus: undefined, handoffDocPath: null });
    expect(screen.getByTestId('held-handoff-view')).not.toHaveTextContent('Focus:');
    expect(screen.queryByRole('button', { name: 'Open handoff doc' })).toBeNull();
  });

  it('Start calls startHeldKickoff with only the conversation name, then onStarted', async () => {
    mockStartHeldKickoff.mockResolvedValue(undefined);
    const { onStarted } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(mockStartHeldKickoff).toHaveBeenCalledTimes(1);
    expect(mockStartHeldKickoff.mock.calls[0]).toEqual(['conv-a']);
  });

  it('shows Starting… and disables Start while the request is in flight', async () => {
    let resolveStart: () => void = () => {};
    mockStartHeldKickoff.mockReturnValue(new Promise<void>((resolve) => { resolveStart = resolve; }));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const starting = await screen.findByRole('button', { name: 'Starting…' });
    expect(starting).toBeDisabled();
    resolveStart();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled());
  });

  it('a 409 conflict shows the already-started info toast and still calls onStarted', async () => {
    mockStartHeldKickoff.mockRejectedValue(new HeldKickoffConflictError('No held kickoff'));
    const { onStarted } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mockToastInfo).toHaveBeenCalledWith('This handoff was already started'));
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('any other error shows toast.error and does not call onStarted', async () => {
    mockStartHeldKickoff.mockRejectedValue(new Error('HTTP 500'));
    const { onStarted } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('HTTP 500', { duration: 8000 }));
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
  });

  it('renders the failure line for a failed previous start', () => {
    renderView({ startError: 'spawn timed out' });
    expect(screen.getByText('The last start failed: spawn timed out')).toBeInTheDocument();
  });

  it('Archive calls onArchive', () => {
    const { onArchive } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('renders no Archive button without onArchive', () => {
    renderView({ onArchive: undefined });
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });
});
