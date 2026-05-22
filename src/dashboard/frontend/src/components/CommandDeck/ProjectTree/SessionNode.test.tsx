import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentRuntimeSnapshot, SessionNode as SessionNodeType } from '@panctl/contracts';
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

    expect(screen.getByText('Security (opus-4-7)')).toHaveAttribute(
      'title',
      'Security specialist reviewer in the review pipeline. Model: opus-4-7. Session: reviewer-1. Last heard: 5m ago.',
    );
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

    expect(screen.getByText('working')).toHaveAttribute(
      'title',
      'Actively using tools or just finished a tool run. tmux session is live. Current tool: Bash. Last heard: 5m ago.',
    );
  });

  it('adds contextual stopped tooltip text to the session status pill', () => {
    render(
      <SessionNode
        session={makeSession({
          sessionId: 'stopped-1',
          status: 'stopped',
          presence: 'ended',
        })}
      />,
    );

    expect(screen.getByText('stopped')).toHaveAttribute(
      'title',
      'Session ended cleanly and is no longer live.',
    );
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

    const workRow = screen.getByText('Work (sonnet-4-6)').closest('button');
    const reviewRow = screen.getByText('Review (sonnet-4-6)').closest('button');

    expect(workRow?.children[1]).toHaveClass('sessionDotSlot');
    expect(reviewRow?.children[1]).toHaveClass('sessionDotSlot');
    expect(workRow?.children[1]?.querySelector('[data-testid="status-dot"]')).toBeTruthy();
    expect(reviewRow?.children[1]?.querySelector('[data-testid="status-dot"]')).toBeTruthy();
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

    expect(screen.getAllByText('Restart review (opus-4-7)')).toHaveLength(2);
  });

  it('keeps the review coordinator restart label as Restart all', () => {
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

    expect(screen.getByText('Restart all (sonnet-4-6)')).toBeInTheDocument();
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

    expect(screen.getAllByText('Start (sonnet-4-6)')).toHaveLength(2);
    expect(screen.getAllByText('Restart (sonnet-4-6)')).toHaveLength(2);
  });
});
