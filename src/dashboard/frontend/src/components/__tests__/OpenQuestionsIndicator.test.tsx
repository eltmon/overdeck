import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelStatus } from '@overdeck/contracts';
import { OpenQuestionsIndicator } from '../OpenQuestionsIndicator';

const mocks = vi.hoisted(() => ({
  listener: undefined as ((status: FlywheelStatus | null) => void) | undefined,
  unsubscribe: vi.fn(),
  requestRevealOpenQuestions: vi.fn(),
}));

vi.mock('../../lib/wsTransport', () => ({
  subscribeFlywheelStatus: (listener: (status: FlywheelStatus | null) => void) => {
    mocks.listener = listener;
    return mocks.unsubscribe;
  },
}));

vi.mock('../../lib/flywheelReveal', () => ({
  requestRevealOpenQuestions: mocks.requestRevealOpenQuestions,
}));

const status = (openQuestions: string[]): FlywheelStatus => ({
  runId: 'RUN-7',
  startedAt: '2026-05-18T12:00:00.000Z',
  elapsedMs: 125000,
  orchestrator: { harness: 'claude-code', model: 'claude-opus-4-7', effort: 'high', ctxPercent: 42 },
  headline: { bugsFixed: 1, swarmItemsMerged: 2, swarmItemsTotal: 3, prsMerged: 4, awaitingUat: 5 },
  activePipeline: [],
  substrateBugs: [],
  agents: [],
  parked: [],
  suggestions: [],
  system: {
    mainHead: 'cafebabefeed1234',
    ramUsedMb: 1024,
    ramTotalMb: 4096,
    swapUsedMb: 512,
    swapTotalMb: 1024,
    agentsActive: 3,
    agentsCap: 8,
  },
  openQuestions,
  ticks: 3,
  lastTickAt: '2026-05-18T12:03:00.000Z',
});

describe('OpenQuestionsIndicator', () => {
  beforeEach(() => {
    mocks.listener = undefined;
    mocks.unsubscribe.mockReset();
    mocks.requestRevealOpenQuestions.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => status([]) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden without open questions and updates from live snapshots', async () => {
    render(<OpenQuestionsIndicator onActivate={vi.fn()} />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/flywheel/current'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    act(() => mocks.listener?.(status(['First?', 'Second?'])));
    expect(screen.getByRole('button', { name: '2 open Flywheel questions — click to view' })).toHaveTextContent('2');
  });

  it('requests a reveal and activates Flywheel when clicked', () => {
    const onActivate = vi.fn();
    render(<OpenQuestionsIndicator onActivate={onActivate} />);

    act(() => mocks.listener?.(status(['Needs a decision?'])));
    const button = screen.getByRole('button', { name: '1 open Flywheel question — click to view' });
    expect(button).toHaveClass('rounded-sm', 'text-warning-foreground');
    expect(button).not.toHaveClass('rounded-full', 'font-bold', 'font-semibold');

    fireEvent.click(button);
    expect(mocks.requestRevealOpenQuestions).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
