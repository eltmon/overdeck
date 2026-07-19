import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../types';
import {
  AgentPillPopoverRow,
  describeAgentStop,
  relativeTime,
} from './AgentPillPopoverRow';

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-pan-2377',
    issueId: 'PAN-2377',
    role: 'review',
    runtime: 'claude-code',
    model: 'claude-sonnet-5',
    status: 'stopped',
    startedAt: '2026-07-18T09:00:00.000Z',
    lastActivity: '2026-07-18T11:55:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('AgentPillPopoverRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('describes each stopped-agent state in priority order', () => {
    expect(describeAgentStop(agent({ pausedReason: 'awaiting close-out', paused: true })))
      .toBe('paused: awaiting close-out');
    expect(describeAgentStop(agent({ paused: true }))).toBe('paused');
    expect(describeAgentStop(agent({ troubled: true, consecutiveFailures: 2 })))
      .toBe('troubled (2 failures)');
    expect(describeAgentStop(agent({ troubled: true, consecutiveFailures: 1 })))
      .toBe('troubled (1 failure)');
    expect(describeAgentStop(agent({ stoppedByUser: true }))).toBe('stopped by operator');
    expect(describeAgentStop(agent())).toBe('stopped cleanly');
  });

  it('navigates through the URL door before invoking onNavigate', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    const onNavigate = vi.fn();

    render(
      <AgentPillPopoverRow
        agent={agent()}
        title="Order book backlog integration"
        contextLine="stopped cleanly · 5m ago"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(pushState).toHaveBeenCalledWith({}, '', '/issues/PAN-2377');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(PopStateEvent));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.invocationCallOrder[0]).toBeLessThan(onNavigate.mock.invocationCallOrder[0]);
  });

  it('navigates issue-less system agents to the agents surface', () => {
    render(
      <AgentPillPopoverRow
        agent={agent({ id: 'sequencer-runner', issueId: 'sequencer-runner', role: 'sequencer' })}
        contextLine="glm-5.2 · 28m ago"
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(window.location.pathname).toBe('/agents');
  });

  it('renders a mono issue ID, truncated titled row, role, and context', () => {
    const title = 'Order book: backlog integration for ready-queue lanes';
    render(
      <AgentPillPopoverRow
        agent={agent()}
        title={title}
        contextLine="paused: awaiting close-out · 2d ago"
      />,
    );

    expect(screen.getByText('PAN-2377')).toHaveClass('font-mono');
    expect(screen.getByTitle(title)).toHaveClass('truncate');
    expect(screen.getByText('review')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('paused: awaiting close-out · 2d ago')).toHaveClass('truncate');
  });

  it('falls back to the bare issue ID when no title is supplied', () => {
    render(
      <AgentPillPopoverRow
        agent={agent()}
        contextLine="stopped cleanly · 5m ago"
      />,
    );

    expect(screen.getByText('PAN-2377')).toBeInTheDocument();
    expect(screen.queryByTitle(/./)).not.toBeInTheDocument();
  });

  it('formats minute, hour, and day deltas from the frozen clock', () => {
    const now = Date.now();

    expect(relativeTime('2026-07-18T11:55:00.000Z', now)).toBe('5m ago');
    expect(relativeTime('2026-07-18T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-07-16T12:00:00.000Z', now)).toBe('2d ago');
  });
});
