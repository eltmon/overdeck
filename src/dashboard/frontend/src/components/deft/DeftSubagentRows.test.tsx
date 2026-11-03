/**
 * PAN-4849 WI-9: Deft subagent heartbeats as rows in the agents lane.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./queries', () => ({ useDeftIssueState: () => ({ data: state.value }) }));

import { DeftSubagentRows } from './DeftSubagentRows';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T18:00:00Z'));
  state.value = golden;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DeftSubagentRows', () => {
  it('renders one row per heartbeat with phase, PR and age', () => {
    render(<DeftSubagentRows issueId="PAN-1" />);
    expect(screen.getByText('Deft subagents')).toBeInTheDocument();
    const watch = screen.getByTestId('deft-subagent-pr-watch-12-4242');
    expect(watch.textContent).toContain('polling');
    expect(watch.textContent).toContain('PR #12');
    expect(watch.textContent).toContain('2m ago');
    expect(screen.getByTestId('deft-subagent-impl-1').textContent).toContain('implementing');
    expect(screen.queryByText('quiet')).not.toBeInTheDocument();
  });

  it('marks a non-terminal heartbeat older than 10 minutes as quiet', () => {
    state.value = {
      ...golden,
      heartbeats: [{ ...golden.heartbeats[0], lastHeartbeatAt: '2026-11-02T17:45:00Z' }, { ...golden.heartbeats[1], phase: 'terminal', terminalState: 'CLEAN', lastHeartbeatAt: '2026-11-02T17:00:00Z' }],
    };
    render(<DeftSubagentRows issueId="PAN-1" />);
    expect(screen.getByTestId('deft-subagent-impl-1').textContent).toContain('quiet');
    const done = screen.getByTestId('deft-subagent-pr-watch-12-4242');
    expect(done.textContent).toContain('CLEAN');
    expect(done.textContent).not.toContain('quiet');
  });

  it('renders nothing without heartbeats', () => {
    state.value = { ...golden, heartbeats: [] };
    const { container } = render(<DeftSubagentRows issueId="PAN-1" />);
    expect(container.innerHTML).toBe('');
  });
});
