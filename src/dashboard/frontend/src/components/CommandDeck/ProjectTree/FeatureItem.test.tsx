import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import { FeatureItem, pickBestSession } from './FeatureItem';
import type { ProjectFeature } from './ProjectNode';

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    ChevronRight: (props: Record<string, unknown>) => <svg data-testid="chevron-right" {...props} />,
    ChevronDown: (props: Record<string, unknown>) => <svg data-testid="chevron-down" {...props} />,
    Loader2: () => <svg data-testid="loader" />,
    AlertTriangle: () => <svg data-testid="alert" />,
    CheckCircle2: () => <svg data-testid="check" />,
    Circle: () => <svg data-testid="circle" />,
    Eye: () => <svg data-testid="eye" />,
    Layers: () => <svg data-testid="layers" />,
    GitMerge: () => <svg data-testid="merge" />,
  };
});

vi.mock('./SessionNode', () => ({
  SessionNode: ({ session, isSelected, onClick }: {
    session: SessionNodeType;
    isSelected?: boolean;
    onClick?: () => void;
  }) => (
    <button
      data-testid={`session-${session.sessionId}`}
      data-selected={isSelected ? 'true' : 'false'}
      onClick={onClick}
    >
      {session.sessionId}
    </button>
  ),
}));

vi.mock('../styles/command-deck.module.css', () => ({
  default: {
    spinning: 'spinning',
    featureItemWrapper: 'featureItemWrapper',
    featureItemWrapperSelected: 'featureItemWrapperSelected',
    featureItemRow: 'featureItemRow',
    featureItemCaret: 'featureItemCaret',
    featureItemCaretPlaceholder: 'featureItemCaretPlaceholder',
    featureItem: 'featureItem',
    featureItemSelected: 'featureItemSelected',
    featureStatus: 'featureStatus',
    featureId_sidebar: 'featureId_sidebar',
    featureLabel: 'featureLabel',
    featureState: 'featureState',
    featureCost: 'featureCost',
    sessionList: 'sessionList',
    sessionNode: 'sessionNode',
    sessionNodeSelected: 'sessionNodeSelected',
  },
}));

function makeFeature(overrides?: Partial<ProjectFeature>): ProjectFeature {
  return {
    issueId: 'PAN-821',
    title: 'Test Feature',
    branch: 'feature/pan-821',
    status: 'has_state',
    stateLabel: 'In Progress',
    agentStatus: null,
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SessionNodeType>): SessionNodeType {
  return {
    type: 'work',
    sessionId: 'agent-pan-821',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 120,
    status: 'running',
    presence: 'active',
    ...overrides,
  };
}

// ─── pickBestSession ──────────────────────────────────────────────────────────

describe('pickBestSession', () => {
  it('returns null for empty sessions', () => {
    expect(pickBestSession([])).toBeNull();
  });

  it('prefers active over idle', () => {
    const sessions = [
      makeSession({ sessionId: 'idle-1', presence: 'idle' }),
      makeSession({ sessionId: 'active-1', presence: 'active' }),
    ];
    expect(pickBestSession(sessions)).toBe('active-1');
  });

  it('prefers idle over ended', () => {
    const sessions = [
      makeSession({ sessionId: 'ended-1', presence: 'ended' }),
      makeSession({ sessionId: 'idle-1', presence: 'idle' }),
    ];
    expect(pickBestSession(sessions)).toBe('idle-1');
  });

  it('among active prefers work > review > test', () => {
    const sessions = [
      makeSession({ sessionId: 'test-1', type: 'test', presence: 'active' }),
      makeSession({ sessionId: 'review-1', type: 'review', presence: 'active' }),
      makeSession({ sessionId: 'work-1', type: 'work', presence: 'active' }),
    ];
    expect(pickBestSession(sessions)).toBe('work-1');
  });

  it('falls back to most recent when presence and type are equal', () => {
    const sessions = [
      makeSession({ sessionId: 'older', startedAt: '2024-01-01T00:00:00Z' }),
      makeSession({ sessionId: 'newer', startedAt: '2024-06-01T00:00:00Z' }),
    ];
    expect(pickBestSession(sessions)).toBe('newer');
  });
});

// ─── FeatureItem rendering ────────────────────────────────────────────────────

describe('FeatureItem', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders feature info without caret when no sessions', () => {
    render(
      <FeatureItem
        feature={makeFeature()}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getAllByText('PAN-821')[0]).toBeInTheDocument();
    expect(screen.queryByTestId('chevron-right')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chevron-down')).not.toBeInTheDocument();
  });

  it('shows caret when sessions are present', () => {
    render(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
  });

  it('toggles expansion when caret is clicked', () => {
    render(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    const caret = screen.getByTestId('chevron-right');
    fireEvent.click(caret);
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    expect(screen.getByTestId('session-agent-pan-821')).toBeInTheDocument();
  });

  it('collapses when caret is clicked again', () => {
    render(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    fireEvent.click(screen.getByTestId('chevron-down'));
    expect(screen.queryByTestId('session-agent-pan-821')).not.toBeInTheDocument();
  });

  it('calls onSelect when row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <FeatureItem
        feature={makeFeature()}
        isSelected={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getAllByText('PAN-821')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('auto-selects best session when row is clicked and sessions exist', () => {
    const onSelect = vi.fn();
    const onSelectSession = vi.fn();
    const sessions = [
      makeSession({ sessionId: 'idle-1', presence: 'idle' }),
      makeSession({ sessionId: 'active-1', presence: 'active' }),
    ];
    render(
      <FeatureItem
        feature={makeFeature({ sessions })}
        isSelected={false}
        onSelect={onSelect}
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getAllByText('PAN-821')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith('PAN-821', 'active-1');
  });

  it('does not call onSelectSession when row is clicked and no sessions exist', () => {
    const onSelect = vi.fn();
    const onSelectSession = vi.fn();
    render(
      <FeatureItem
        feature={makeFeature()}
        isSelected={false}
        onSelect={onSelect}
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getAllByText('PAN-821')[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it('calls onSelectSession when a session node is clicked', () => {
    const onSelectSession = vi.fn();
    const sessions = [
      makeSession({ sessionId: 'sess-a' }),
      makeSession({ sessionId: 'sess-b' }),
    ];
    render(
      <FeatureItem
        feature={makeFeature({ sessions, stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
        onSelectSession={onSelectSession}
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    fireEvent.click(screen.getByTestId('session-sess-b'));
    expect(onSelectSession).toHaveBeenCalledWith('PAN-821', 'sess-b');
  });

  it('persists expansion state to localStorage', () => {
    render(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    expect(localStorage.getItem('mc-feature-expanded:PAN-821')).toBe('true');
    fireEvent.click(screen.getByTestId('chevron-down'));
    expect(localStorage.getItem('mc-feature-expanded:PAN-821')).toBeNull();
  });

  it('restores expansion state from localStorage on mount', () => {
    localStorage.setItem('mc-feature-expanded:PAN-821', 'true');
    render(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
    expect(screen.getByTestId('session-agent-pan-821')).toBeInTheDocument();
  });

  it('does not auto-expand on mount when localStorage has no entry for terminal states', () => {
    render(
      <FeatureItem
        feature={makeFeature({ sessions: [makeSession()], stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
    expect(screen.queryByTestId('session-agent-pan-821')).not.toBeInTheDocument();
  });

  it('highlights selected session', () => {
    const sessions = [
      makeSession({ sessionId: 'sess-a' }),
      makeSession({ sessionId: 'sess-b' }),
    ];
    render(
      <FeatureItem
        feature={makeFeature({ sessions, stateLabel: 'Done' })}
        isSelected={false}
        onSelect={() => {}}
        selectedSessionId="sess-b"
      />,
    );
    fireEvent.click(screen.getByTestId('chevron-right'));
    expect(screen.getByTestId('session-sess-a')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('session-sess-b')).toHaveAttribute('data-selected', 'true');
  });
});
