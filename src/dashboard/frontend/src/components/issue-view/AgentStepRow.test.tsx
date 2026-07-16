import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AgentRuntimeSnapshot, SessionNode as SessionNodeType } from '@overdeck/contracts';
import { AgentStepRow } from './AgentStepRow';

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    ChevronRight: (props: Record<string, unknown>) => <svg data-testid="chevron-right" {...props} />,
    ChevronDown: (props: Record<string, unknown>) => <svg data-testid="chevron-down" {...props} />,
    CircleCheck: (props: Record<string, unknown>) => <svg data-testid="circle-check" {...props} />,
    CircleX: (props: Record<string, unknown>) => <svg data-testid="circle-x" {...props} />,
  };
});

let runtimeById: Record<string, Partial<AgentRuntimeSnapshot>> = {};

vi.mock('../../lib/store', () => ({
  useDashboardStore: (selector: (state: { agentRuntimeById: typeof runtimeById }) => unknown) => (
    selector({ agentRuntimeById: runtimeById })
  ),
}));

vi.mock('../../lib/useResolvedModels', () => ({
  useResolvedModels: () => ({
    work: 'claude-sonnet-4-6',
    planning: 'claude-haiku-4-5-20251001',
    review: 'claude-sonnet-4-6',
    reviewer: 'claude-opus-4-7',
    test: 'claude-sonnet-4-6',
    ship: 'claude-sonnet-4-6',
    merge: 'claude-sonnet-4-6',
    strike: 'claude-opus-4-8',
    legacy: null,
  }),
  resolveWorkTypeKey: (session: SessionNodeType) => session.type,
}));

vi.mock('../../lib/useLiveFlash', () => ({
  useLiveFlash: () => '',
}));

vi.mock('../../lib/useSharedTick', () => ({
  useSharedTick: () => new Date('2026-05-06T12:00:00.000Z'),
}));

vi.mock('../../lib/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

vi.mock('../shared/ModelPicker/ModelPicker', () => ({
  HARNESS_OPTIONS: [
    { id: 'claude-code', label: 'Claude Code', description: 'Default Claude Code CLI harness' },
    { id: 'ohmypi', label: 'oh-my-pi', description: 'Alternative harness for non-Anthropic models (omp binary)' },
  ],
  canUsePickerHarness: () => ({ allowed: true }),
  useAvailableModels: () => ({ groups: [] }),
}));

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useIssueCostsQuery: () => ({ data: { sessions: [] } }),
  useReviewStatusQuery: () => ({ data: null }),
  useWorkspaceQuery: () => ({ data: null }),
}));

vi.mock('../shared/ContextMenu', () => ({
  ContextMenuRoot: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div data-testid="context-menu">{children}</div>,
  ContextMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>{children}</button>
  ),
  ContextMenuDestructiveItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>{children}</button>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../CommandDeck/StatusDot', () => ({
  StatusDot: ({ status, title }: { status: string; title?: string }) => (
    <span data-testid="status-dot" data-status={status} title={title} />
  ),
}));

vi.mock('../CommandDeck/styles/command-deck.module.css', () => ({
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
    sessionSubtitle: 'sessionSubtitle',
  },
}));

vi.mock('../Stage/cockpit/agentsLane.module.css', () => ({
  default: {
    row: 'row',
    sel: 'sel',
    caret: 'caret',
    caretBtn: 'caretBtn',
    tile: 'tile',
    work: 'work',
    review: 'review',
    ver: 'ver',
    ok: 'ok',
    bad: 'bad',
    body: 'body',
    l1: 'l1',
    name: 'name',
    status: 'status',
    info: 'info',
    muted: 'muted',
    model: 'model',
    sub: 'sub',
    spin: 'spin',
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

describe('AgentStepRow', () => {
  beforeEach(() => {
    runtimeById = {};
  });

  it('renders a cockpit row with label, model, and duration', () => {
    render(
      <AgentStepRow
        session={makeSession()}
        issueId="PAN-821"
        density="cockpit"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  it('renders a rail row with slot label for swarm slots', () => {
    render(
      <AgentStepRow
        session={makeSession({ sessionId: 'agent-pan-1-slot-2', tmuxSession: 'agent-pan-1-slot-2' })}
        issueId="PAN-1"
        density="rail"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText('Slot 2')).toBeInTheDocument();
  });

  it('shows a spinner for live activity in cockpit', () => {
    render(
      <AgentStepRow
        session={makeSession({ presence: 'active', status: 'working' })}
        issueId="PAN-821"
        density="cockpit"
        onAction={() => {}}
      />,
    );

    expect(document.querySelector('.spin')).toBeTruthy();
  });

  it('does not show a spinner for ended sessions in cockpit', () => {
    render(
      <AgentStepRow
        session={makeSession({ presence: 'ended', status: 'stopped' })}
        issueId="PAN-821"
        density="cockpit"
        onAction={() => {}}
      />,
    );

    expect(document.querySelector('.spin')).toBeFalsy();
  });

  it('renders an approved verdict tick', () => {
    render(
      <AgentStepRow
        session={makeSession({
          type: 'reviewer',
          role: 'correctness',
          roundMetadata: { latestReviewResult: 'APPROVED' },
        })}
        issueId="PAN-821"
        density="cockpit"
        onAction={() => {}}
      />,
    );

    expect(screen.getByTestId('circle-check')).toBeInTheDocument();
  });

  it('renders a changes-requested verdict cross', () => {
    render(
      <AgentStepRow
        session={makeSession({
          type: 'reviewer',
          role: 'security',
          roundMetadata: { latestReviewResult: 'CHANGES_REQUESTED' },
        })}
        issueId="PAN-821"
        density="cockpit"
        onAction={() => {}}
      />,
    );

    expect(screen.getByTestId('circle-x')).toBeInTheDocument();
  });

  it('renders lifecycle context-menu actions for an active rail session', () => {
    render(
      <AgentStepRow
        session={makeSession({ presence: 'active', status: 'running', hasJsonl: true })}
        issueId="PAN-821"
        density="rail"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
    expect(screen.getByText('Restart')).toBeInTheDocument();
    expect(screen.getByText('Deep Wipe')).toBeInTheDocument();
    expect(screen.getByText('Open State Dir')).toBeInTheDocument();
    expect(screen.getByText('View JSONL')).toBeInTheDocument();
    expect(screen.getByText('View Terminal')).toBeInTheDocument();
  });

  it('renders paused-specific context-menu actions for a paused rail session', () => {
    render(
      <AgentStepRow
        session={makeSession({ presence: 'ended', status: 'stopped', paused: true, hasJsonl: false })}
        issueId="PAN-821"
        density="rail"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText('Unpause')).toBeInTheDocument();
    expect(screen.getByText('Resume session')).toBeInTheDocument();
  });

  it('calls onAction with the correct kind when a menu item is selected', () => {
    const onAction = vi.fn();
    render(
      <AgentStepRow
        session={makeSession({ presence: 'active', status: 'running', hasJsonl: true })}
        issueId="PAN-821"
        density="rail"
        onAction={onAction}
      />,
    );

    screen.getByText('Stop').click();
    expect(onAction).toHaveBeenCalledWith('stop');

    screen.getByText('View Terminal').click();
    expect(onAction).toHaveBeenLastCalledWith('view-terminal');
  });

  it('hides the context menu when showMenu is false', () => {
    render(
      <AgentStepRow
        session={makeSession({ presence: 'active', status: 'running', hasJsonl: true })}
        issueId="PAN-821"
        density="cockpit"
        showMenu={false}
        onAction={() => {}}
      />,
    );

    expect(screen.queryByTestId('context-menu')).toBeNull();
  });
});
