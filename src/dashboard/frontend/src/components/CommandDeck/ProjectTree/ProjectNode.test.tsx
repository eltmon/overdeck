import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectNode, type ProjectFeature } from './ProjectNode';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';

vi.mock('lucide-react', () => ({
  ChevronRight: (props: Record<string, unknown>) => <svg data-testid="project-chevron" {...props} />,
}));

vi.mock('./FeatureItem', () => ({
  FeatureItem: ({ feature }: { feature: ProjectFeature }) => <div data-testid={`feature-${feature.issueId}`}>{feature.issueId}</div>,
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
