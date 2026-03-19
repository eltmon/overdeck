import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentInfoSection } from './AgentInfoSection';
import type { Agent } from '../../types';
import type { WorkspaceInfo } from './types';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'session-abc123',
    runtime: 'claude-code',
    model: 'claude-sonnet-4-6',
    status: 'healthy',
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('AgentInfoSection', () => {
  it('renders agent model and runtime', () => {
    render(
      <AgentInfoSection
        agent={makeAgent()}
        duration="5m"
        syncMainPending={false}
        onSyncMain={vi.fn()}
      />
    );
    expect(screen.getByText('Sonnet 4.6')).toBeInTheDocument();
    expect(screen.getByText('claude-code')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('renders session id', () => {
    render(
      <AgentInfoSection
        agent={makeAgent({ id: 'test-session-xyz' })}
        duration="1h 30m"
        syncMainPending={false}
        onSyncMain={vi.fn()}
      />
    );
    expect(screen.getByText('test-session-xyz')).toBeInTheDocument();
  });

  it('shows git status when agent has git info', () => {
    const agent = makeAgent({
      git: { branch: 'feature/pan-331', uncommittedFiles: 3, latestCommit: 'fix: update styles' },
    });
    render(
      <AgentInfoSection
        agent={agent}
        duration="10m"
        syncMainPending={false}
        onSyncMain={vi.fn()}
      />
    );
    expect(screen.getByTestId('git-status')).toBeInTheDocument();
    expect(screen.getByText('feature/pan-331')).toBeInTheDocument();
    expect(screen.getByText('3 uncommitted files')).toBeInTheDocument();
    expect(screen.getByText('fix: update styles')).toBeInTheDocument();
  });

  it('calls onSyncMain when Sync button clicked', () => {
    const onSyncMain = vi.fn();
    const agent = makeAgent({
      git: { branch: 'feature/pan-331', uncommittedFiles: 0, latestCommit: 'init' },
    });
    render(
      <AgentInfoSection
        agent={agent}
        duration="5m"
        syncMainPending={false}
        onSyncMain={onSyncMain}
      />
    );
    fireEvent.click(screen.getByText('Sync'));
    expect(onSyncMain).toHaveBeenCalledOnce();
  });

  it('disables Sync button when pending', () => {
    const agent = makeAgent({
      git: { branch: 'feature/pan-331', uncommittedFiles: 0, latestCommit: 'init' },
    });
    render(
      <AgentInfoSection
        agent={agent}
        duration="5m"
        syncMainPending={true}
        onSyncMain={vi.fn()}
      />
    );
    expect(screen.getByText('Sync').closest('button')).toBeDisabled();
  });

  it('shows workspace path when agent has workspace', () => {
    const agent = makeAgent({ workspace: '/home/user/workspaces/pan-331' });
    render(
      <AgentInfoSection
        agent={agent}
        duration="5m"
        syncMainPending={false}
        onSyncMain={vi.fn()}
      />
    );
    expect(screen.getByText('/home/user/workspaces/pan-331')).toBeInTheDocument();
  });

  it('shows workspace path from WorkspaceInfo when agent has no workspace', () => {
    const workspace: WorkspaceInfo = {
      exists: true,
      issueId: 'PAN-331',
      path: '/remote/workspaces/pan-331',
      location: 'remote',
    };
    render(
      <AgentInfoSection
        agent={makeAgent()}
        duration="5m"
        workspace={workspace}
        syncMainPending={false}
        onSyncMain={vi.fn()}
      />
    );
    expect(screen.getByText('/remote/workspaces/pan-331')).toBeInTheDocument();
    expect(screen.getByText('remote')).toBeInTheDocument();
  });
});
