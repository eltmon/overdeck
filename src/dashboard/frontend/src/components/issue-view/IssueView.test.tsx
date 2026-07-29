import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ISSUE_VIEW_INVENTORY, type IssueViewDensity } from './inventory';
import { DENSITY_SECTIONS } from './densitySections';
import { IssueView } from './IssueView';
import { DrawerPlanPanel } from '../drawer/DrawerSecondaryPanels';
import { PlanMapCard } from '../Stage/cockpit/PlanMapCard';
import { useDashboardStore } from '../../lib/store';

vi.mock('../ReviewPolicyControl', () => ({
  ReviewPolicyControl: ({ issueId }: { issueId: string }) => <span>policy {issueId}</span>,
}));

vi.mock('../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  useReviewStatusQuery: () => ({ data: undefined }),
}));

vi.mock('./StartAgentCta', () => ({
  StartAgentCta: ({ density }: { density: IssueViewDensity }) => <span data-section="StartAgentCta">start {density}</span>,
}));

vi.mock('../xbrief/XBriefViewer', () => ({
  XBriefViewer: () => <div data-testid="embedded-xbrief-viewer">plan viewer</div>,
}));

vi.mock('../xbrief/PlanMapViewer', () => ({
  PlanMapViewer: ({ issueId }: { issueId: string }) => <div data-testid="plan-map-viewer">map {issueId}</div>,
}));

function queryWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  useDashboardStore.setState({ xbriefViewerIssueId: null });
  vi.unstubAllGlobals();
});

describe('IssueView', () => {
  it('keeps one view instance while rail expands through cockpit and console', () => {
    function Harness() {
      const [density, setDensity] = useState<IssueViewDensity>('rail');
      return <IssueView issueId="PAN-2499" density={density}><button onClick={() => setDensity('cockpit')}>expand</button><button onClick={() => setDensity('console')}>full screen</button><button onClick={() => setDensity('rail')}>collapse</button></IssueView>;
    }
    const { container } = render(<Harness />);
    const root = container.querySelector('[data-component="issue-view"]');
    expect(root).toHaveAttribute('data-density', 'rail');
    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    expect(root).toHaveAttribute('data-density', 'cockpit');
    fireEvent.click(screen.getByRole('button', { name: 'full screen' }));
    expect(root).toHaveAttribute('data-density', 'console');
    fireEvent.click(screen.getByRole('button', { name: 'collapse' }));
    expect(root).toHaveAttribute('data-density', 'rail');
  });
  it.each(['rail', 'cockpit', 'console'] as const)('renders the %s density boundary', (density) => {
    const { container } = render(<IssueView issueId="PAN-2499" density={density}><span>body</span></IssueView>);
    expect(container.querySelector('[data-component="issue-view"]')).toHaveAttribute('data-density', density);
    expect(container.querySelectorAll('span[hidden][data-section]')).toHaveLength(0);
  });

  it('forwards shell DOM attributes and handlers to the real boundary element', () => {
    const onClick = vi.fn();
    const { container } = render(<IssueView issueId="PAN-2499" density="rail" data-component="feature-item" data-issue-id="PAN-2499" onClick={onClick}><span>body</span></IssueView>);
    const root = container.querySelector('[data-component="feature-item"]');
    expect(root).toHaveAttribute('data-issue-id', 'PAN-2499');
    root?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('declares every no-loss inventory section at one or more densities', () => {
    const densities: IssueViewDensity[] = ['rail', 'cockpit', 'console'];
    const rendered = new Set(densities.flatMap((density) => DENSITY_SECTIONS[density]));
    expect(ISSUE_VIEW_INVENTORY.filter((entry) => !rendered.has(entry.section))).toEqual([]);
  });

  it('keeps operator policy out of rail and exposes it at cockpit and console densities', () => {
    const rail = render(<IssueView issueId="PAN-2499" density="rail"><span /></IssueView>);
    expect(rail.container.querySelector('[data-section="ReviewPolicyControl"]')).not.toBeInTheDocument();
    rail.unmount();

    for (const density of ['cockpit', 'console'] as const) {
      const view = render(<IssueView issueId="PAN-2499" density={density}><span /></IssueView>);
      expect(screen.getByText('policy PAN-2499').parentElement).toHaveAttribute(
        'data-section',
        density === 'console' ? 'IssuePolicyStrip / PoliciesControl' : 'ReviewPolicyControl',
      );
      view.unmount();
    }
  });

  it('opens the full-screen xBRIEF from the drawer Plan panel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      xBRIEFInfo: { version: '0.8', created: '2026-07-29T00:00:00Z' },
      plan: { id: 'pan-3231', title: 'Artifact viewers', status: 'running', items: [], edges: [] },
    })));
    render(<DrawerPlanPanel issueId="PAN-3231" />, { wrapper: queryWrapper });

    await screen.findByTestId('embedded-xbrief-viewer');
    fireEvent.click(screen.getByRole('button', { name: 'Expand xBRIEF full screen' }));

    expect(useDashboardStore.getState().xbriefViewerIssueId).toBe('PAN-3231');
    expect(screen.getByTestId('drawer-tab-panel-plan')).toBeVisible();
  });

  it('opens the full-screen xBRIEF from the cockpit PlanMapCard', () => {
    render(<PlanMapCard issueId="PAN-3231" />);

    fireEvent.click(screen.getByRole('button', { name: 'Expand xBRIEF full screen' }));

    expect(useDashboardStore.getState().xbriefViewerIssueId).toBe('PAN-3231');
    expect(screen.getByTestId('plan-map-card')).toHaveAttribute('data-section', 'PlanMapCard');
    expect(screen.getByTestId('plan-map-viewer')).toHaveTextContent('map PAN-3231');
  });
});
