/**
 * PAN-2908 · C-CONVO — IssuePeek tests (hover intent → glance card).
 */
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_READ_MODEL_STATE } from '@overdeck/contracts';
import { IssuePeek } from './IssuePeek';
import { useDashboardStore } from '../../lib/store';
import { useConvoDock } from '../../lib/convoDock';
import type { Issue } from '../../types';

const issue = {
  id: 'PAN-1',
  identifier: 'PAN-1',
  title: 'Test the peek',
  status: 'In Progress',
  state: 'in_progress',
  priority: 2,
  labels: [],
  url: '',
} as Issue;

function seed() {
  useDashboardStore.setState({
    ...INITIAL_READ_MODEL_STATE,
    issuesRaw: [issue],
    agentsById: { 'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1', status: 'running', role: 'work' } },
    observationsByIssueId: {
      'PAN-1': [{
        id: 'obs-1',
        timestamp: new Date().toISOString(),
        projectId: 'overdeck',
        workspaceId: 'ws',
        issueId: 'PAN-1',
        runId: 'r1',
        sessionId: 's1',
        agentRole: 'work',
        agentHarness: 'claude-code',
        gitBranch: 'feature/pan-1',
        sourceTranscriptOffset: 0,
        actionStatus: null,
        narrative: 'finished task 4 of 13 — provider behind env flag',
        summary: '',
        files: [],
        tags: [],
        tokens: {},
        model: 'sonnet-5',
      }],
    },
  } as never);
}

describe('IssuePeek (C-CONVO)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useConvoDock.setState({ items: [], expanded: false });
    seed();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the glance card after hover intent with phase dots and the last-said line', () => {
    render(<IssuePeek issueId="PAN-1"><div data-testid="row">row</div></IssuePeek>);
    expect(document.querySelector('[data-component="issue-peek"]')).toBeNull();

    fireEvent.mouseEnter(screen.getByTestId('row'), { clientX: 100, clientY: 100 });
    act(() => { vi.advanceTimersByTime(400); });

    const peek = document.querySelector('[data-component="issue-peek"]');
    expect(peek).not.toBeNull();
    expect(screen.getByText('finished task 4 of 13 — provider behind env flag')).toBeInTheDocument();
    expect(document.querySelector('[data-component="phase-dots"]')).not.toBeNull();
  });

  it('does not open on a drive-by hover', () => {
    render(<IssuePeek issueId="PAN-1"><div data-testid="row">row</div></IssuePeek>);
    fireEvent.mouseEnter(screen.getByTestId('row'));
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.mouseLeave(screen.getByTestId('row'));
    act(() => { vi.advanceTimersByTime(400); });
    expect(document.querySelector('[data-component="issue-peek"]')).toBeNull();
  });

  it('pop into dock adds the issue to the conversation dock', () => {
    render(<IssuePeek issueId="PAN-1" onDock={(id) => useConvoDock.getState().add(id)}><div data-testid="row">row</div></IssuePeek>);
    fireEvent.mouseEnter(screen.getByTestId('row'));
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.click(screen.getByText('pop into dock'));
    expect(useConvoDock.getState().items.map((i) => i.issueId)).toEqual(['PAN-1']);
  });
});
