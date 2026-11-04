/**
 * PAN-4734 WI-12: a linked machine's conversation under an issue (a Fly work
 * agent) opens /conv/@<env>/<name> and shows "linked" instead of a row id; a
 * local conversation still opens /conv/<id>.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { DialogProvider } from '../../DialogProvider';
import { FeatureItem } from './FeatureItem';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers } from './ProjectNode';
import { useDashboardStore } from '../../../lib/store';

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn(), refetchQueries: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('../../shared/ModelPicker/ModelPicker', () => ({
  useAvailableModels: () => ({ groups: [] }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

vi.mock('../../../lib/refresh-dashboard-state', () => ({ refreshDashboardState: vi.fn() }));

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));

const ENV = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';

function makeFeature(conversations: ProjectFeature['resourceDetails']['conversations']): ProjectFeature {
  return {
    issueId: 'PAN-821',
    title: 'Test Feature',
    projectName: 'test-project',
    branch: 'feature/pan-821',
    status: 'has_state',
    stateLabel: 'In Progress',
    agentStatus: null,
    hasPlanning: true,
    hasPrd: true,
    hasState: true,
    isShadow: false,
    isRally: false,
    sessions: [],
    resourceSources: ['conversation'],
    resourceDetails: {
      hasWorkspace: false,
      workspacePaths: [],
      localBranchCount: 0,
      localBranchNames: [],
      remoteBranchCount: 0,
      remoteBranchNames: [],
      tmuxSessionCount: 0,
      tmuxSessionNames: [],
      prs: [],
      hasXbrief: false,
      hasTasks: false,
      hasPrd: false,
      dockerContainerCount: 0,
      dockerContainerNames: [],
      conversations,
    },
  } as ProjectFeature;
}

function renderFeature(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

describe('FeatureItem linked conversation rows (PAN-4734)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDashboardStore.setState({ derivedIssueStateByIssueId: {} });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        workspacePaths: [], localBranchNames: [], remoteBranchNames: [], tmuxSessionNames: [], prs: [], dockerContainerNames: [],
      } satisfies ProjectFeatureResourceIdentifiers),
    })));
  });

  it('links a linked conversation to /conv/@<env>/<name> and labels it linked', () => {
    const linkedName = `@${ENV}/20261102-1234`;
    renderFeature(
      <FeatureItem
        feature={makeFeature([
          { id: 42, name: 'conv-pan-821', title: 'Local conv', status: 'active' },
          { id: -7, name: linkedName, title: 'Work agent', status: 'active', origin: 'linked' },
        ])}
        isSelected={false}
        onSelect={() => {}}
      />,
    );

    const linked = screen.getByTestId(`conversation-${linkedName}`);
    expect(linked).toHaveAttribute('href', `/conv/${linkedName}`);
    expect(linked).toHaveTextContent('Work agent');
    expect(linked).toHaveTextContent('linked');
    expect(linked).not.toHaveTextContent('#-7');

    const local = screen.getByTestId('conversation-42');
    expect(local).toHaveAttribute('href', '/conv/42');
    expect(local).toHaveTextContent('#42');
  });
});
