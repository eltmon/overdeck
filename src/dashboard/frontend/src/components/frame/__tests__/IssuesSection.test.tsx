/**
 * PAN-5293 WI-13: the left column's Issues section (ProjectNode frame variant).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionNode } from '@overdeck/contracts';
import { IssuesSection } from '../IssuesSection';
import { usePlannedBacklogVisibility } from '../../../hooks/usePlannedBacklogVisibility';
import { useCommandDeckSelection } from '../../../lib/commandDeckSelection';
import type { ProjectData } from '../../CommandDeck/projectsData';

const handleSelectFeature = vi.fn();
vi.mock('../deck/useIssueSessionActions', () => ({
  useIssueSessionActions: () => new Proxy({}, { get: (_t, key) => (key === 'handleSelectFeature' ? handleSelectFeature : vi.fn()) }),
}));
vi.mock('../../CommandDeck/ProjectMembershipBoundary', () => ({
  ProjectMembershipBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../CommandDeck/ProjectCiChip', () => ({ ProjectCiChip: () => <span data-testid="ci-chip" /> }));
vi.mock('../../CommandDeck/ProjectDeployChip', () => ({ ProjectDeployChip: () => <span data-testid="deploy-chip" /> }));
vi.mock('../../CommandDeck/ProjectTree/ProjectIdentityChip', () => ({ ProjectIdentityChip: () => <span data-testid="identity-chip" /> }));
vi.mock('../../CommandDeck/ProjectTree/FeatureItem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../CommandDeck/ProjectTree/FeatureItem')>();
  return {
    ...actual,
    FeatureItem: ({ feature, onSelect }: { feature: { issueId: string }; onSelect: () => void }) => (
      <button data-testid={`issue-${feature.issueId}`} onClick={onSelect}>{feature.issueId}</button>
    ),
  };
});

const session = (status: string): SessionNode => ({
  type: 'work', sessionId: `s-${status}`, model: 'm', startedAt: '2026-11-15T00:00:00Z', duration: 1, status, presence: 'active',
} as SessionNode);
const feature = (issueId: string, extra: Partial<ProjectData['features'][number]> = {}) =>
  ({ issueId, title: issueId, ...extra }) as ProjectData['features'][number];

const project: ProjectData = {
  key: 'alpha',
  name: 'alpha',
  path: '/p/alpha',
  features: [
    feature('ALP-1', { sessions: [session('running')] }),
    feature('ALP-2', { sessions: [session('failed')] }),
    feature('ALP-3', { specOnlyPlanned: true }),
  ],
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['command-deck-projects'], [project]);
  client.setQueryData(['session-trees', 'alpha'], []);
  client.setQueryData(['registered-projects'], [{ key: 'alpha', name: 'alpha', path: '/p/alpha' }]);
  client.setQueryData(['conversations'], []);
  client.setQueryData(['costs-by-issue'], { issues: [] });
  return render(
    <QueryClientProvider client={client}>
      <IssuesSection selectedProject="alpha" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  handleSelectFeature.mockClear();
  usePlannedBacklogVisibility.setState({ showPlannedBacklog: true });
  useCommandDeckSelection.setState({ selectedFeature: null, selectedConversation: null });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('IssuesSection (PAN-5293 F-D17)', () => {
  it('shows the Issues header with the count and the project chips, and no new-conversation icon', () => {
    renderSection();
    const header = screen.getByTestId('issues-section-toggle').parentElement!;
    expect(within(header).getByText('Issues')).toBeInTheDocument();
    expect(screen.getByTestId('issues-section-count')).toHaveTextContent('3');
    expect(within(header).getByTestId('ci-chip')).toBeInTheDocument();
    expect(within(header).getByTestId('deploy-chip')).toBeInTheDocument();
    expect(within(header).getByTestId('identity-chip')).toBeInTheDocument();
    expect(screen.queryByLabelText(/New conversation in/)).not.toBeInTheDocument();
  });

  it('filters to failed sessions and hides spec-only planned issues', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('issues-filter'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Failed' }));
    expect(screen.getByTestId('issues-filter')).toHaveTextContent('Filter: Failed');
    expect(screen.getByTestId('issue-ALP-2')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-ALP-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('issues-section-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('issues-filter'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All' }));
    expect(screen.getByTestId('issues-section-count')).toHaveTextContent('3');
    fireEvent.click(screen.getByTestId('issues-filter'));
    fireEvent.click(screen.getByTestId('planned-backlog-toggle'));
    expect(screen.queryByTestId('issue-ALP-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('issues-section-count')).toHaveTextContent('2');
  });

  it('offers Rename project and Copy project name on right-click', () => {
    renderSection();
    fireEvent.contextMenu(screen.getByTestId('issues-section-toggle').parentElement!);
    expect(screen.getByText('Rename project')).toBeInTheDocument();
    expect(screen.getByText('Copy project name')).toBeInTheDocument();
  });

  it('selecting an issue calls handleSelectFeature with its id', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('issue-ALP-1'));
    expect(handleSelectFeature).toHaveBeenCalledWith('ALP-1');
  });

  it('collapses the section and remembers it', () => {
    const first = renderSection();
    fireEvent.click(screen.getByTestId('issues-section-toggle'));
    expect(screen.queryByTestId('issue-ALP-1')).not.toBeInTheDocument();
    first.unmount();
    renderSection();
    expect(screen.getByTestId('issues-section-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the eyebrow, count and filter whole and puts the chips in a shrinkable container (PAN-5370)', () => {
    renderSection();
    const toggle = screen.getByTestId('issues-section-toggle');
    expect(toggle).toHaveClass('shrink-0');
    expect(toggle).not.toHaveClass('min-w-0');

    const chips = screen.getByTestId('issues-header-chips');
    expect(chips).toContainElement(screen.getByTestId('ci-chip'));
    expect(chips).toContainElement(screen.getByTestId('deploy-chip'));
    expect(chips).toContainElement(screen.getByTestId('identity-chip'));
    expect(chips).not.toContainElement(screen.getByTestId('issues-section-toggle'));
    expect(chips).not.toContainElement(screen.getByTestId('issues-filter'));

    const filter = screen.getByTestId('issues-filter');
    expect(filter).toHaveClass('whitespace-nowrap');
    expect(filter.parentElement!.parentElement).toHaveClass('shrink-0');
  });
});
