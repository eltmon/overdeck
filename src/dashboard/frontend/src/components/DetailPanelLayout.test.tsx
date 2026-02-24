import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailPanelLayout } from './DetailPanelLayout';
import { Agent, Issue } from '../types';

// Mock child components to isolate DetailPanelLayout behaviour
vi.mock('./InspectorPanel', () => ({
  InspectorPanel: ({ issueId, onOpenTerminal, onClose }: {
    issueId: string;
    onOpenTerminal?: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="inspector-panel">
      <span data-testid="inspector-issue-id">{issueId}</span>
      {onOpenTerminal && (
        <button data-testid="open-terminal-btn" onClick={onOpenTerminal}>Open Terminal</button>
      )}
      <button data-testid="close-btn" onClick={onClose}>Close</button>
    </div>
  ),
}));

vi.mock('./TerminalPanel', () => ({
  TerminalPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="terminal-panel">
      <button data-testid="close-terminal-btn" onClick={onClose}>Close Terminal</button>
    </div>
  ),
}));

// react-resizable-panels is not needed in tests since terminal mode requires an agent
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div data-testid="panel-separator" />,
}));

const mockIssue: Issue = {
  id: 'issue-1',
  identifier: 'PAN-999',
  title: 'Test Issue',
  status: 'In Progress',
  priority: 'Medium',
  labels: [],
  url: 'https://github.com/test/repo/issues/1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockAgent: Agent = {
  id: 'agent-1',
  name: 'test-agent',
  status: 'working',
  issueId: 'PAN-999',
  sessionName: 'test-session',
  model: 'claude-sonnet-4-6',
  startedAt: new Date().toISOString(),
  restartCount: 0,
  runtime: 'claude-code',
};

// Suppress localStorage errors in tests
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  },
  writable: true,
});

describe('DetailPanelLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders InspectorPanel by default', () => {
    render(
      <DetailPanelLayout
        issueId="PAN-999"
        issueUrl="https://github.com/test"
        issue={mockIssue}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('inspector-panel')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-issue-id')).toHaveTextContent('PAN-999');
  });

  it('does not render TerminalPanel without agent', () => {
    render(
      <DetailPanelLayout
        issueId="PAN-999"
        issue={mockIssue}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument();
  });

  it('shows open-terminal button when agent is provided', () => {
    render(
      <DetailPanelLayout
        agent={mockAgent}
        issueId="PAN-999"
        issue={mockIssue}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('open-terminal-btn')).toBeInTheDocument();
  });

  it('opens TerminalPanel when open terminal is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DetailPanelLayout
        agent={mockAgent}
        issueId="PAN-999"
        issue={mockIssue}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByTestId('open-terminal-btn'));
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
    expect(screen.getByTestId('panel-group')).toBeInTheDocument();
  });

  it('closes TerminalPanel when close terminal is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DetailPanelLayout
        agent={mockAgent}
        issueId="PAN-999"
        issue={mockIssue}
        onClose={vi.fn()}
      />
    );
    await user.click(screen.getByTestId('open-terminal-btn'));
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
    await user.click(screen.getByTestId('close-terminal-btn'));
    expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument();
  });

  it('calls onClose when inspector close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DetailPanelLayout
        issueId="PAN-999"
        issue={mockIssue}
        onClose={onClose}
      />
    );
    await user.click(screen.getByTestId('close-btn'));
    expect(onClose).toHaveBeenCalled();
  });

  it('reloads panel state when issueId changes', () => {
    const { rerender } = render(
      <DetailPanelLayout issueId="PAN-999" issue={mockIssue} onClose={vi.fn()} />
    );
    rerender(
      <DetailPanelLayout issueId="PAN-100" issue={mockIssue} onClose={vi.fn()} />
    );
    expect(screen.getByTestId('inspector-issue-id')).toHaveTextContent('PAN-100');
  });
});
