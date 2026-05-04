import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectNode, type ProjectFeature } from './ProjectNode';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';

vi.mock('lucide-react', () => ({
  ChevronRight: (props: Record<string, unknown>) => <svg data-testid="project-chevron" {...props} />,
  MessageSquarePlus: () => <svg data-testid="message-square-plus" />,
  Circle: () => <svg data-testid="circle-icon" />,
  Archive: () => <svg data-testid="archive-icon" />,
  Copy: () => <svg data-testid="copy-icon" />,
  Check: () => <svg data-testid="check-icon" />,
  X: () => <svg data-testid="x-icon" />,
  Pencil: () => <svg data-testid="pencil-icon" />,
  Star: () => <svg data-testid="star-icon" />,
  Loader2: () => <svg data-testid="loader2-icon" />,
  Terminal: () => <svg data-testid="terminal-icon" />,
  FileCode: () => <svg data-testid="filecode-icon" />,
  Search: () => <svg data-testid="search-icon" />,
  Globe: () => <svg data-testid="globe-icon" />,
  Wrench: () => <svg data-testid="wrench-icon" />,
  Zap: () => <svg data-testid="zap-icon" />,
  GitBranchPlus: () => <svg data-testid="gitbranchplus-icon" />,
  AlertCircle: () => <svg data-testid="alertcircle-icon" />,
}));

vi.mock('./FeatureItem', () => ({
  FeatureItem: ({ feature }: { feature: ProjectFeature }) => <div data-testid={`feature-${feature.issueId}`}>{feature.issueId}</div>,
  sessionMatchesFilter: (session: SessionNodeType, filter: 'all' | 'alive' | 'failed') => {
    if (filter === 'all') return true;
    if (filter === 'alive') return session.presence === 'active' || session.presence === 'idle' || session.presence === 'suspended';
    const status = (session.status || '').toLowerCase();
    return status.includes('fail') || status.includes('error') || status.includes('stuck');
  },
}));

vi.mock('../styles/command-deck.module.css', () => ({
  default: {
    projectNode: 'projectNode',
    projectHeader: 'projectHeader',
    chevron: 'chevron',
    chevronOpen: 'chevronOpen',
    projectName: 'projectName',
    featureCount: 'featureCount',
    emptyProject: 'emptyProject',
  },
}));

function makeSession(overrides?: Partial<SessionNodeType>): SessionNodeType {
  return {
    type: 'work',
    sessionId: 'agent-pan-854',
    model: 'claude-sonnet-4-6',
    startedAt: new Date().toISOString(),
    duration: 120,
    status: 'running',
    presence: 'active',
    ...overrides,
  };
}

function makeFeature(issueId: string, sessions?: SessionNodeType[]): ProjectFeature {
  return {
    issueId,
    title: issueId,
    projectName: 'panopticon-cli',
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'running',
    stateLabel: 'In Progress',
    agentStatus: 'active',
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    sessions,
  };
}

describe('ProjectNode', () => {
  it('shows only alive features when alive filter is active', () => {
    render(
      <ProjectNode
        name="panopticon-cli"
        features={[
          makeFeature('PAN-854', [makeSession({ presence: 'active', status: 'running' })]),
          makeFeature('PAN-855', [makeSession({ presence: 'ended', status: 'stopped' })]),
        ]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        filter="alive"
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-PAN-854')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-PAN-855')).not.toBeInTheDocument();
  });

  it('shows only failed features when failed filter is active', () => {
    render(
      <ProjectNode
        name="panopticon-cli"
        features={[
          makeFeature('PAN-854', [makeSession({ presence: 'active', status: 'running' })]),
          makeFeature('PAN-855', [makeSession({ presence: 'ended', status: 'error' })]),
        ]}
        selectedFeature={null}
        onSelectFeature={() => {}}
        filter="failed"
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-PAN-855')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-PAN-854')).not.toBeInTheDocument();
  });
});
