/**
 * PAN-4753 WI-12: the project Home shows that project's merge train card,
 * directly after the pipeline lanes (PAN-5294 §5a).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../merge-train/train/MergeTrain', () => ({
  MergeTrain: ({ placement, projectKey, onNavigateIssue }: {
    placement: string; projectKey?: string; onNavigateIssue?: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="merge-train-component"
      data-placement={placement}
      data-project={projectKey}
      onClick={() => onNavigateIssue?.('PAN-7')}
    />
  ),
}));

import { ProjectOverview } from '../ProjectOverview';
import type { ProjectFeature } from '../ProjectTree/ProjectNode';

const feature = { issueId: 'PAN-7', title: 'Seven', projectName: 'overdeck', branch: 'feature/pan-7', status: 'open',
  stateLabel: 'Todo', agentStatus: null, hasPlanning: false, hasPrd: false, hasState: false, isShadow: false, sessions: [] } as ProjectFeature;

function renderOverview(props: { projectKey?: string; onSelectFeature?: (f: ProjectFeature) => void }) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ totalCost: 0 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectOverview
        projectName="overdeck"
        projectKey={props.projectKey}
        features={[feature]}
        issueCosts={{}}
        onSelectFeature={props.onSelectFeature ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

describe('ProjectOverview merge train card (PAN-4753 WI-12)', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the project placement for this project, after the pipeline lanes', () => {
    renderOverview({ projectKey: 'overdeck' });
    const card = screen.getByTestId('merge-train-component');
    expect(card).toHaveAttribute('data-placement', 'project');
    expect(card).toHaveAttribute('data-project', 'overdeck');
    const lanes = screen.getByTestId('pipeline-section').querySelectorAll('[data-phase-group]');
    const lastLane = lanes[lanes.length - 1]!;
    expect(lastLane.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('pipeline-section').contains(card)).toBe(false);
  });

  it('opens the issue through the overview navigation callback', () => {
    const onSelectFeature = vi.fn();
    renderOverview({ projectKey: 'overdeck', onSelectFeature });
    fireEvent.click(screen.getByTestId('merge-train-component'));
    expect(onSelectFeature).toHaveBeenCalledWith(feature);
  });

  it('renders no card without a project key', () => {
    renderOverview({});
    expect(screen.queryByTestId('merge-train-component')).toBeNull();
  });
});
