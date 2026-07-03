import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentRuntimeSnapshot, SessionNode as SessionNodeType } from '@overdeck/contracts';
import { SessionNode } from './SessionNode';

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    ChevronRight: (props: Record<string, unknown>) => <svg data-testid="chevron-right" {...props} />,
    ChevronDown: (props: Record<string, unknown>) => <svg data-testid="chevron-down" {...props} />,
    CircleCheck: (props: Record<string, unknown>) => <svg data-testid="circle-check" {...props} />,
    CircleX: (props: Record<string, unknown>) => <svg data-testid="circle-x" {...props} />,
    Code2: (props: Record<string, unknown>) => <svg data-testid="code2" {...props} />,
    Compass: (props: Record<string, unknown>) => <svg data-testid="compass" {...props} />,
    Eye: (props: Record<string, unknown>) => <svg data-testid="eye" {...props} />,
    FlaskConical: (props: Record<string, unknown>) => <svg data-testid="flask" {...props} />,
    GitMerge: (props: Record<string, unknown>) => <svg data-testid="merge" {...props} />,
    ShieldCheck: (props: Record<string, unknown>) => <svg data-testid="shield" {...props} />,
    Lock: (props: Record<string, unknown>) => <svg data-testid="lock" {...props} />,
    Gauge: (props: Record<string, unknown>) => <svg data-testid="gauge" {...props} />,
    ClipboardList: (props: Record<string, unknown>) => <svg data-testid="clipboard" {...props} />,
    Layers: (props: Record<string, unknown>) => <svg data-testid="layers" {...props} />,
    Archive: (props: Record<string, unknown>) => <svg data-testid="archive" {...props} />,
    Zap: (props: Record<string, unknown>) => <svg data-testid="zap" {...props} />,
  };
});

let runtimeById: Record<string, Partial<AgentRuntimeSnapshot>> = {};
let resolvedModels: Record<string, string | null> = {};
const fixedNow = new Date('2026-05-06T12:00:00.000Z');

vi.mock('../../../lib/store', () => ({
  useDashboardStore: (selector: (state: { agentRuntimeById: typeof runtimeById }) => unknown) => (
    selector({ agentRuntimeById: runtimeById })
  ),
}));

vi.mock('../../../lib/useResolvedModels', () => ({
  useResolvedModels: () => resolvedModels,
  resolveWorkTypeKey: (session: SessionNodeType) => session.type,
}));

vi.mock('../../../lib/useLiveFlash', () => ({
  useLiveFlash: () => '',
}));

vi.mock('../../../lib/useSharedTick', () => ({
  useSharedTick: () => fixedNow,
}));

vi.mock('../../../lib/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

vi.mock('../../shared/ModelPicker/ModelPicker', () => ({
  HARNESS_OPTIONS: [
    { id: 'claude-code', label: 'Claude Code', description: 'Default Claude Code CLI harness' },
    { id: 'ohmypi', label: 'oh-my-pi', description: 'Alternative harness for non-Anthropic models (omp binary)' },
  ],
  canUsePickerHarness: () => ({ allowed: true }),
  useAvailableModels: () => ({ groups: [] }),
}));

vi.mock('../../shared/ContextMenu', () => ({
  ContextMenuRoot: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  ContextMenuDestructiveItem: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  ContextMenuSeparator: () => <hr />,
  ContextMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../StatusDot', () => ({
  StatusDot: ({ status, title }: { status: string; title?: string }) => (
    <span data-testid="status-dot" data-status={status} title={title} />
  ),
}));

vi.mock('../styles/command-deck.module.css', () => ({
  default: {
    sessionNode: 'sessionNode',
    sessionNodeSelected: 'sessionNodeSelected',
    sessionToggleSlot: 'sessionToggleSlot',
    sessionToggleButton: 'sessionToggleButton',
    sessionDotSlot: 'sessionDotSlot',
    sessionIconSlot: 'sessionIconSlot',
    sessionTypeIcon: 'sessionTypeIcon',
    sessionLabel: 'sessionLabel',
    sessionStatus: 'sessionStatus',
    sessionStatus_running: 'sessionStatus_running',
    sessionStatus_error: 'sessionStatus_error',
    sessionStatus_starting: 'sessionStatus_starting',
    sessionStatus_stopped: 'sessionStatus_stopped',
    sessionStatus_idle: 'sessionStatus_idle',
    sessionStatus_working: 'sessionStatus_working',
    sessionStatus_thinking: 'sessionStatus_thinking',
    sessionStatus_waiting: 'sessionStatus_waiting',
    sessionStatus_stopping: 'sessionStatus_stopping',
    sessionStatus_paused: 'sessionStatus_paused',
    sessionIconRunning: 'sessionIconRunning',
    sessionIconReview: 'sessionIconReview',
    sessionIconPaused: 'sessionIconPaused',
    sessionIconError: 'sessionIconError',
    sessionModel: 'sessionModel',
    sessionPausedReason: 'sessionPausedReason',
    unpauseBtn: 'unpauseBtn',
    sessionDuration: 'sessionDuration',
  },
}));

function makeSession(overrides?: Partial<SessionNodeType>): SessionNodeType {
  return {
    type: 'work',
    sessionId: 'agent-pan-821',
    model: 'claude-sonnet-4-6',
    startedAt: '2026-05-06T11:00:00.000Z',
    duration: 120,
    status: 'running',
    presence: 'active',
    ...overrides,
  };
}

describe('SessionNode paused gate (PAN-1779)', () => {
  it('renders paused status, reason line, and unpause control for a paused session', () => {
    const onUnpauseSession = vi.fn();
    render(
      <SessionNode
        session={makeSession({
          sessionId: 'agent-pan-1642',
          status: 'stopped',
          presence: 'ended',
          paused: true,
          pausedReason: 'Operator drain 2026-06-10',
          pausedAt: '2026-05-06T09:00:00.000Z',
        })}
        issueId="PAN-1642"
        onUnpauseSession={onUnpauseSession}
      />,
    );

    // No 'paused' pill — the amber icon tile + reason line + Unpause carry it.
    expect(screen.queryByText('paused')).toBeNull();
    expect(screen.getByText('Work').closest('button')?.querySelector('.sessionIconPaused')).toBeTruthy();
    expect(screen.getByTestId('session-paused-reason').textContent).toContain('Operator drain 2026-06-10');
    screen.getByTestId('session-unpause').click();
    expect(onUnpauseSession).toHaveBeenCalledWith('agent-pan-1642');
  });

  it('does not render unpause control for unpaused sessions', () => {
    render(
      <SessionNode
        session={makeSession({ sessionId: 'agent-pan-1', status: 'stopped', presence: 'ended' })}
        issueId="PAN-1"
        onUnpauseSession={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('session-unpause')).toBeNull();
    expect(screen.queryByTestId('session-paused-reason')).toBeNull();
  });

  // PAN-1985 follow-up: a stopped work session gets a 'Resume session' menu
  // item so the operator can re-engage the agent without going through the
  // restart picker (which is destructive — wipes the dir). The session menu
  // opens via Radix, so the test renders the SessionNode directly and
  // inspects the right-click menu structure via the ContextMenuRoot trigger.
  it('exposes a Resume session right-click item for stopped work sessions (PAN-1985)', () => {
    const onResumeSession = vi.fn();
    render(
      <SessionNode
        session={makeSession({ sessionId: 'agent-pan-1', status: 'stopped', presence: 'ended', role: 'work' })}
        issueId="PAN-1"
        onResumeSession={onResumeSession}
      />,
    );
    // The 'Resume session' label is rendered into the ContextMenuContent.
    // Radix renders the menu content even before open; we just confirm the
    // menu item is present in the DOM with the expected label.
    expect(screen.getByText('Resume session')).toBeInTheDocument();
    // The live 'Resume' (for suspended agents) must NOT be present for a
    // stopped session — they're distinct labels for distinct states.
    expect(screen.queryByText('Resume')).toBeNull();
  });

  // PAN-1985 follow-up: a completed review session whose tmux was killed by
  // specialists/done (PAN-846) leaves status='running' but presence='ended'
  // (the state is stale, the tmux is gone). The 'Resume session' item must
  // still appear so the operator can re-engage the review with a follow-up
  // message. The condition is `!isLive` (presence !== active/idle/suspended),
  // not `status === 'stopped'`, to cover this case.
  it('exposes a Resume session right-click item for completed reviews (status=running, presence=ended)', () => {
    const onResumeSession = vi.fn();
    render(
      <SessionNode
        session={makeSession({
          sessionId: 'agent-pan-1-review',
          type: 'review',
          role: 'review',
          status: 'running',
          presence: 'ended',
        })}
        issueId="PAN-1"
        onResumeSession={onResumeSession}
      />,
    );
    expect(screen.getByText('Resume session')).toBeInTheDocument();
  });
});

describe('SessionNode', () => {
  beforeEach(() => {
    runtimeById = {};
    resolvedModels = {
      work: 'claude-sonnet-4-6',
      planning: 'claude-haiku-4-5-20251001',
      review: 'claude-sonnet-4-6',
      reviewer: 'claude-opus-4-7',
      test: 'claude-sonnet-4-6',
      ship: 'claude-sonnet-4-6',
      merge: 'claude-sonnet-4-6',
      strike: 'claude-opus-4-8',
      legacy: null,
    };
  });

  it('adds contextual reviewer tooltip text to the session label', () => {
    runtimeById['reviewer-1'] = {
      lastActivity: '2026-05-06T11:55:00.000Z',
    };

    render(
      <SessionNode
        session={makeSession({
          sessionId: 'reviewer-1',
          type: 'reviewer',
          role: 'security',
          model: 'specialist',
        })}
      />,
    );

    // Redesign: bare role label; model renders as its own span.
    expect(screen.getByText('Security')).toHaveAttribute(
      'title',
      'Security specialist reviewer in the review pipeline. Model: opus-4-7. Session: reviewer-1. Last heard: 5m ago.',
    );
    expect(screen.getByText('opus-4-7')).toBeInTheDocument();
  });

  it('adds contextual working tooltip text to the session status pill', () => {
    runtimeById['work-1'] = {
      activity: 'working',
      currentTool: 'Bash',
      lastActivity: '2026-05-06T11:55:00.000Z',
    };

    render(
      <SessionNode
        session={makeSession({
          sessionId: 'work-1',
          type: 'work',
          presence: 'active',
          status: 'running',
        })}
      />,
    );

    // Redesign: no 'working' pill — the blue icon tile carries live state.
    expect(screen.queryByText('working')).toBeNull();
    expect(screen.getByText('Work').closest('button')?.querySelector('.sessionIconRunning')).toBeTruthy();
  });

  it('renders registered swarm slots as distinct openable terminal rows', () => {
    render(
      <div>
        <SessionNode
          issueId="PAN-2203"
          onViewTerminal={vi.fn()}
          session={makeSession({
            sessionId: 'agent-pan-2203-slot-1',
            tmuxSession: 'agent-pan-2203-slot-1',
            type: 'work',
          })}
        />
        <SessionNode
          issueId="PAN-2203"
          onViewTerminal={vi.fn()}
          session={makeSession({
            sessionId: 'agent-pan-2203-slot-2',
            tmuxSession: 'agent-pan-2203-slot-2',
            type: 'work',
          })}
        />
      </div>,
    );

    expect(screen.getByText('Slot 1')).toHaveAttribute(
      'title',
      'Registered swarm slot 1 for this issue. Model: sonnet-4-6. Session: agent-pan-2203-slot-1.',
    );
    expect(screen.getByText('Slot 2')).toHaveAttribute(
      'title',
      'Registered swarm slot 2 for this issue. Model: sonnet-4-6. Session: agent-pan-2203-slot-2.',
    );
    expect(screen.getAllByText('View Terminal')).toHaveLength(2);
  });

  it('renders no status pill for quietly-stopped sessions (PAN-1779)', () => {
    render(
      <SessionNode
        session={makeSession({
          sessionId: 'stopped-1',
          status: 'stopped',
          presence: 'ended',
        })}
      />,
    );

    // Redesign: idle/stopped rows stay quiet — only live, paused, or error
    // states render a status pill.
    expect(screen.queryByText('stopped')).toBeNull();
  });

  it('keeps Work and expandable Review status dots in the same grid slot', () => {
    render(
      <div>
        <SessionNode session={makeSession({ sessionId: 'work-1', type: 'work' })} />
        <SessionNode
          session={makeSession({ sessionId: 'review-1', type: 'review' })}
          expandable
          expanded
        />
      </div>,
    );

    const workRow = screen.getByText('Work').closest('button');
    const reviewRow = screen.getByText('Review').closest('button');

    expect(workRow?.children[1]).toHaveClass('sessionDotSlot');
    expect(reviewRow?.children[1]).toHaveClass('sessionDotSlot');
    // Redesign: no status dots — state lives on the icon tile; the slot
    // remains for reviewer verdict glyphs and grid alignment.
    expect(workRow?.children[1]?.querySelector('[data-testid="status-dot"]')).toBeNull();
    expect(reviewRow?.children[1]?.querySelector('[data-testid="status-dot"]')).toBeNull();
  });

  it('adds contextual error tooltip text to the session status pill', () => {
    runtimeById['review-err'] = {
      lastActivity: '2026-05-06T11:55:00.000Z',
    };

    render(
      <SessionNode
        session={makeSession({
          sessionId: 'review-err',
          type: 'review',
          status: 'error',
          presence: 'ended',
        })}
      />,
    );

    expect(screen.getByText('error')).toHaveAttribute(
      'title',
      'Session hit an error and has ended. Last heard: 5m ago.',
    );
  });

  it('labels reviewer restarts as review restarts for live and ended reviewer nodes', () => {
    render(
      <div>
        <SessionNode
          issueId="PAN-1381"
          onRestartSession={vi.fn()}
          session={makeSession({
            sessionId: 'reviewer-live',
            type: 'reviewer',
            role: 'correctness',
            presence: 'active',
          })}
        />
        <SessionNode
          issueId="PAN-1381"
          onRestartSession={vi.fn()}
          session={makeSession({
            sessionId: 'reviewer-ended',
            type: 'reviewer',
            role: 'security',
            presence: 'ended',
            status: 'stopped',
          })}
        />
      </div>,
    );

    expect(screen.getAllByText('Restart review')).toHaveLength(2);
  });

  it('labels the review coordinator restart as Restart review (quick review has no convoy to "restart all")', () => {
    render(
      <SessionNode
        issueId="PAN-1381"
        onRestartSession={vi.fn()}
        session={makeSession({
          sessionId: 'review-1',
          type: 'review',
          presence: 'active',
        })}
      />,
    );

    expect(screen.getByText('Restart review')).toBeInTheDocument();
  });

  it('uses Start for ended test and ship nodes and Restart for live test and ship nodes', () => {
    render(
      <div>
        <SessionNode
          issueId="PAN-1381"
          onRestartSession={vi.fn()}
          session={makeSession({
            sessionId: 'test-ended',
            type: 'test',
            presence: 'ended',
            status: 'stopped',
          })}
        />
        <SessionNode
          issueId="PAN-1381"
          onRestartSession={vi.fn()}
          session={makeSession({
            sessionId: 'ship-ended',
            type: 'ship',
            presence: 'ended',
            status: 'stopped',
          })}
        />
        <SessionNode
          issueId="PAN-1381"
          onRestartSession={vi.fn()}
          session={makeSession({
            sessionId: 'test-live',
            type: 'test',
            presence: 'active',
          })}
        />
        <SessionNode
          issueId="PAN-1381"
          onRestartSession={vi.fn()}
          session={makeSession({
            sessionId: 'ship-live',
            type: 'ship',
            presence: 'active',
          })}
        />
      </div>,
    );

    expect(screen.getAllByText('Start')).toHaveLength(2);
    expect(screen.getAllByText('Restart')).toHaveLength(2);
  });

  it('renders a strike node with label, purpose tooltip, model, and restart affordance', () => {
    runtimeById['strike-pan-1835'] = {
      lastActivity: '2026-05-06T11:55:00.000Z',
    };

    render(
      <SessionNode
        issueId="PAN-1835"
        onRestartSession={vi.fn()}
        session={makeSession({
          sessionId: 'strike-pan-1835',
          type: 'strike',
          role: 'strike',
          model: 'claude-opus-4-8',
          status: 'running',
          presence: 'active',
        })}
      />,
    );

    expect(screen.getByText('Strike')).toHaveAttribute(
      'title',
      'Drop-in implement-and-merge agent for this issue. Model: opus-4-8. Session: strike-pan-1835. Last heard: 5m ago.',
    );
    expect(screen.getByText('opus-4-8')).toBeInTheDocument();
    // PAN-1985: the trigger label no longer appends the model suffix (it
    // was misleading). The model is now shown inside the submenu as a
    // 'Currently: ...' status label.
    expect(screen.getByText('Restart')).toBeInTheDocument();
  });
});
