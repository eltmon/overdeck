import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FlywheelStatusDetails, adaptFlywheelAgent } from '../FlywheelStatusDetails';
import type { FlywheelStatus } from '@panctl/contracts';
import type { Agent } from '../../../types';

vi.mock('../../ResourceCard', () => ({
  AgentCard: ({ agent, onNavigate }: { agent: Agent; onNavigate: (agentId: string) => void }) => (
    <button type="button" data-testid="agent-card" onClick={() => onNavigate(agent.id)}>
      {agent.issueId} {agent.status} {agent.model}
    </button>
  ),
}));

const status: FlywheelStatus = {
  runId: 'RUN-7',
  startedAt: '2026-05-18T12:00:00.000Z',
  elapsedMs: 1000,
  orchestrator: {
    harness: 'claude-code',
    model: 'claude-opus-4-7',
    effort: 'high',
    ctxPercent: 42,
  },
  headline: {
    bugsFixed: 1,
    swarmItemsMerged: 2,
    swarmItemsTotal: 3,
    prsMerged: 4,
    awaitingUat: 5,
  },
  activePipeline: [
    {
      issueId: 'PAN-7',
      title: 'Ship dashboard shell',
      verb: 'working',
      status: 'running',
      progressPercent: 67,
      agentId: 'agent-1',
      pr: 17,
    },
  ],
  substrateBugs: [
    {
      issueId: 'PAN-1',
      title: 'Fix stuck review gate',
      status: 'fixed',
      commitSha: 'abcdef1234567890',
      url: 'https://example.test/commit/abcdef1',
    },
    {
      issueId: 'PAN-2',
      title: 'File dashboard crash',
      status: 'filed',
    },
    {
      issueId: 'PAN-3',
      title: 'Use alternate status feed',
      status: 'workaround',
      commitSha: '1234567890abcdef',
    },
  ],
  agents: [
    {
      id: 'agent-1',
      label: 'Review convoy',
      status: 'waiting',
      issueId: 'PAN-7',
      role: 'review',
      model: 'claude-sonnet-4-6',
      ctxPercent: 61,
      currentAction: 'Waiting on security specialist',
    },
  ],
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
  openQuestions: ['Should PAN-9 be split before review?', 'Is UAT allowed to run overnight?'],
  ticks: 3,
  lastTickAt: '2026-05-18T12:03:00.000Z',
};

describe('FlywheelStatusDetails', () => {
  it('renders headline metrics and active pipeline rows', () => {
    render(<FlywheelStatusDetails status={status} />);

    const metrics = screen.getByLabelText('Flywheel headline metrics');
    expect(within(metrics).getByText('Bugs Fixed')).toBeInTheDocument();
    expect(within(metrics).getByText('1')).toBeInTheDocument();
    expect(within(metrics).getByText('SWARM Items')).toBeInTheDocument();
    expect(within(metrics).getByText('2/3')).toBeInTheDocument();
    expect(within(metrics).getByText('PRs Merged')).toBeInTheDocument();
    expect(within(metrics).getByText('4')).toBeInTheDocument();
    expect(within(metrics).getByText('Awaiting UAT')).toBeInTheDocument();
    expect(within(metrics).getByText('5')).toBeInTheDocument();

    expect(screen.getByText('PAN-7')).toBeInTheDocument();
    expect(screen.getByText('Ship dashboard shell')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('renders suggestions before headline metrics sorted by priority', () => {
    render(<FlywheelStatusDetails status={{
      ...status,
      suggestions: [
        { priority: 'low', action: 'wait', issueId: 'PAN-40', rationale: 'Low-priority follow-up' },
        { priority: 'urgent', action: 'investigate', issueId: 'PAN-10', rationale: 'Substrate gate is blocked' },
        { priority: 'medium', action: 'review', issueId: 'PAN-30', rationale: 'Review is ready' },
        { priority: 'urgent', action: 'resume', issueId: 'PAN-11', rationale: 'Second urgent keeps input order' },
        { priority: 'high', action: 'start', rationale: 'System-wide starter suggestion' },
      ],
    }} />);

    const suggestions = screen.getByText('Suggestions').closest('section');
    expect(suggestions).not.toBeNull();
    expect(screen.getByText('Suggestions').compareDocumentPosition(screen.getByLabelText('Flywheel headline metrics'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const rows = within(suggestions!).getAllByTestId('flywheel-suggestion');
    expect(rows).toHaveLength(5);
    expect(rows.map((row, index) => within(row).getByText(['urgent', 'urgent', 'high', 'medium', 'low'][index]).textContent)).toEqual(['urgent', 'urgent', 'high', 'medium', 'low']);
    expect(rows.map((row, index) => within(row).getByText(['investigate', 'resume', 'start', 'review', 'wait'][index]).textContent)).toEqual(['investigate', 'resume', 'start', 'review', 'wait']);
    expect(within(rows[0]).getByRole('button', { name: 'PAN-10' })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'PAN-11' })).toBeInTheDocument();
    expect(within(suggestions!).getByText('Substrate gate is blocked')).toBeInTheDocument();
    expect(within(suggestions!).getByText('System-wide starter suggestion')).toBeInTheDocument();
  });

  it('renders the suggestions empty state', () => {
    render(<FlywheelStatusDetails status={{ ...status, suggestions: [] }} />);

    expect(screen.getByText('No suggestions yet — orchestrator will emit on next tick.')).toBeInTheDocument();
  });

  it('navigates issue suggestions but leaves system suggestions without click-through', () => {
    const onNavigateAgent = vi.fn();
    render(<FlywheelStatusDetails status={{
      ...status,
      suggestions: [
        { priority: 'high', action: 'start', issueId: 'PAN-55', rationale: 'Start this eligible issue' },
        { priority: 'medium', action: 'investigate', rationale: 'Investigate host-level state' },
      ],
    }} onNavigateAgent={onNavigateAgent} />);

    fireEvent.click(screen.getByRole('button', { name: 'PAN-55' }));
    expect(onNavigateAgent).toHaveBeenCalledWith('PAN-55');

    const systemSuggestion = screen.getByText('Investigate host-level state').closest('[data-testid="flywheel-suggestion"]');
    expect(systemSuggestion).not.toBeNull();
    expect(within(systemSuggestion as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders substrate bugs with status badges and commit links', () => {
    render(<FlywheelStatusDetails status={status} />);

    expect(screen.getByText('PAN-1')).toBeInTheDocument();
    expect(screen.getByText('Fix stuck review gate')).toBeInTheDocument();
    expect(screen.getByText('fixed')).toBeInTheDocument();
    expect(screen.getByText('filed')).toBeInTheDocument();
    expect(screen.getByText('workaround')).toBeInTheDocument();

    const commitLink = screen.getByRole('link', { name: 'abcdef1' });
    expect(commitLink).toHaveAttribute('href', 'https://example.test/commit/abcdef1');
    expect(screen.getByText('1234567')).toBeInTheDocument();
  });

  it('renders unsafe bug URLs as plain commit text', () => {
    render(<FlywheelStatusDetails status={{
      ...status,
      substrateBugs: [{
        issueId: 'PAN-4',
        title: 'Unsafe link',
        status: 'fixed',
        commitSha: 'badbadbadbad',
        url: 'javascript:alert(1)',
      } as any],
    }} />);

    expect(screen.getByText('badbadb')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'badbadb' })).not.toBeInTheDocument();
  });

  it('delegates running agents to AgentCard and preserves navigation', () => {
    const onNavigateAgent = vi.fn();
    render(<FlywheelStatusDetails status={status} onNavigateAgent={onNavigateAgent} />);

    expect(screen.getByText('Review convoy')).toBeInTheDocument();
    expect(screen.getByText('61% ctx')).toBeInTheDocument();
    expect(screen.getByText('Waiting on security specialist')).toBeInTheDocument();

    const card = screen.getByTestId('agent-card');
    expect(card).toHaveTextContent('PAN-7 warning claude-sonnet-4-6');
    fireEvent.click(card);
    expect(onNavigateAgent).toHaveBeenCalledWith('agent-1');
  });

  it('renders system metrics and open questions', () => {
    render(<FlywheelStatusDetails status={status} />);

    const system = screen.getByText('System').closest('section');
    expect(system).not.toBeNull();
    expect(within(system!).getByText('1.0 GiB used / 3.0 GiB available')).toBeInTheDocument();
    expect(within(system!).getByText('512 MiB used / 512 MiB available')).toBeInTheDocument();
    expect(within(system!).getByText('3 / 8 active')).toBeInTheDocument();
    expect(within(system!).getByText('cafebab')).toBeInTheDocument();

    expect(screen.getByText('Should PAN-9 be split before review?')).toBeInTheDocument();
    expect(screen.getByText('Is UAT allowed to run overnight?')).toBeInTheDocument();
  });

  it('collapses empty collections gracefully', () => {
    render(<FlywheelStatusDetails status={{ ...status, substrateBugs: [], agents: [], openQuestions: [] }} />);

    expect(screen.getByText('No substrate bugs filed or fixed yet.')).toBeInTheDocument();
    expect(screen.getByText('No running Flywheel agents.')).toBeInTheDocument();
    expect(screen.getByText('No open questions for the next tick.')).toBeInTheDocument();
  });
});

describe('adaptFlywheelAgent', () => {
  it('normalizes Flywheel agent statuses for AgentCard', () => {
    expect(adaptFlywheelAgent({ id: 'a', label: 'A', status: 'waiting' }, status.lastTickAt)).toMatchObject({
      status: 'warning',
      issueId: 'A',
      runtime: 'claude-code',
      model: 'unknown',
    });
    expect(adaptFlywheelAgent({ id: 'b', label: 'B', status: 'error' }, status.lastTickAt)).toMatchObject({
      status: 'failed',
      consecutiveFailures: 1,
    });
  });
});
