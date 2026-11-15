/**
 * PAN-5292 WI-E10 — the slim top bar. Every leaf is mocked to a marker so the
 * test pins only what AppChrome itself composes: order, removals, the search
 * box and what the health dot hosts.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Tab } from '../components/Header';

const marker = (testId: string) => () => <span data-testid={testId} />;

vi.mock('./topbar/AgentsMenu', () => ({ AgentsMenu: marker('mock-agents-menu') }));
vi.mock('./topbar/Breadcrumb', () => ({ Breadcrumb: marker('mock-crumb') }));
vi.mock('../components/flywheel/NeedsYouIndicator', () => ({ NeedsYouIndicator: marker('mock-needs-you') }));
vi.mock('../components/DeaconPauseToggle', () => ({
  DeaconFrozenChip: marker('mock-deacon-chip'),
  DeaconPauseToggle: marker('mock-auto-resume'),
}));
vi.mock('../components/StoppedAgentsBanner', () => ({
  StoppedAgentsBanner: ({ variant }: { variant?: string }) => <span data-testid={`mock-stopped-${variant}`} />,
}));
vi.mock('../components/LowCostModePill', () => ({ LowCostModePill: marker('mock-low-cost') }));
vi.mock('../components/StaleBuildChip', () => ({ StaleBuildChip: marker('mock-stale-build') }));
vi.mock('../components/GitHubQuotaPill', () => ({ GitHubQuotaSection: marker('mock-quota-section') }));
vi.mock('../components/CloisterStatusBar', () => ({ CloisterStatusBar: marker('mock-cloister') }));
vi.mock('../components/SystemHealthPill', () => ({
  SystemHealthPill: ({ children }: { children?: ReactNode }) => <div data-testid="mock-health-dot">{children}</div>,
  HealthSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock('../components/project/new/AddProjectDialog', () => ({ AddProjectDialogHost: () => null }));
// The system-notices row and banners above the bar are unchanged by this child.
for (const [path, name] of [
  ['../components/DegradedModeBanner', 'DegradedModeBanner'],
  ['../components/NewBuildBanner', 'NewBuildBanner'],
  ['../components/CodexAuthBanner', 'CodexAuthBanner'],
  ['../components/ConversationSearchBanner', 'ConversationSearchBanner'],
  ['../components/InotifyPressureBanner', 'InotifyPressureBanner'],
  ['../components/LinearMcpAuthBanner', 'LinearMcpAuthBanner'],
  ['../components/RestartApprovalBanner', 'RestartApprovalBanner'],
  ['../components/GitHubRateLimitBanner', 'GitHubRateLimitBanner'],
  ['../components/SetupChecklistBanner', 'SetupChecklistBanner'],
  ['../components/ClaudeCodeUpgradeBanner', 'ClaudeCodeUpgradeBanner'],
  ['../components/SyncRequiredBanner', 'SyncRequiredBanner'],
] as const) {
  vi.doMock(path, () => ({ [name]: () => null }));
}

const { AppChrome } = await import('./AppChrome');
const { PALETTE_SEARCH_PLACEHOLDER, paletteKeycap } = await import('./appChromeLabels');

function renderChrome(overrides: { activeTab?: Tab; onPaletteOpen?: () => void } = {}) {
  return render(
    <AppChrome
      activeTab={overrides.activeTab ?? 'home'}
      selectedProjectKey="panopticon-cli"
      dashboardLifecycle={{ active: false }}
      missingKeyTrackers={[]}
      trackerBannerDismissed={false}
      showCliproxyBanner={false}
      isRestartBackendPending={false}
      isRestartCliproxyPending={false}
      isSessionFeedSidebarOpen={false}
      onPaletteOpen={overrides.onPaletteOpen ?? vi.fn()}
      onOpenSettings={vi.fn()}
      onDismissTrackerBanner={vi.fn()}
      onRestartBackend={vi.fn()}
      onRestartCliproxy={vi.fn()}
      onToggleSessionFeedSidebar={vi.fn()}
      onProjectCreated={vi.fn()}
    />,
  );
}

function domOrder(...testIds: string[]): number[] {
  const all = Array.from(document.body.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
  return testIds.map((id) => all.indexOf(id));
}

describe('AppChrome top bar (PAN-5292)', () => {
  it('places the agents menu, Needs you, the health dot and the theme toggle in that order', () => {
    renderChrome();
    const order = domOrder('mock-agents-menu', 'mock-needs-you', 'mock-health-dot', 'topbar-theme');
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders the four exception chips between Needs you and the health dot', () => {
    renderChrome();
    const [needsYou, deacon, stopped, lowCost, stale, dot] = domOrder(
      'mock-needs-you', 'mock-deacon-chip', 'mock-stopped-pill', 'mock-low-cost', 'mock-stale-build', 'mock-health-dot',
    );
    expect([needsYou, deacon, stopped, lowCost, stale, dot]).toEqual(
      [needsYou, deacon, stopped, lowCost, stale, dot].slice().sort((a, b) => a! - b!),
    );
    expect(deacon).toBeGreaterThan(needsYou!);
  });

  it('shows none of the retired bar items', () => {
    renderChrome();
    expect(screen.queryByRole('button', { name: /Stop all/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Emergency stop/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'System controls' })).toBeNull();
    for (const testId of ['decisions-indicator', 'github-quota-pill', 'running-agents-pill']) {
      expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    }
  });

  it('shows the Activity-feed toggle off the Command Deck only', () => {
    const { unmount } = renderChrome({ activeTab: 'home' });
    expect(screen.getByRole('button', { name: 'Toggle activity feed' })).toBeInTheDocument();
    unmount();

    renderChrome({ activeTab: 'command-deck' });
    expect(screen.queryByRole('button', { name: 'Toggle activity feed' })).toBeNull();
  });

  it('opens the palette from the search box, which names what it searches and shows the palette keycap', () => {
    const onPaletteOpen = vi.fn();
    renderChrome({ onPaletteOpen });
    const search = screen.getByTestId('topbar-search');
    expect(search).toHaveTextContent(PALETTE_SEARCH_PLACEHOLDER);
    expect(within(search).getByText(paletteKeycap())).toBeInTheDocument();
    fireEvent.click(search);
    expect(onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it('hosts the quota, auto-resume, stopped-agents and system-controls sections in the health dot', () => {
    renderChrome();
    const dot = screen.getByTestId('mock-health-dot');
    expect(within(dot).getByTestId('mock-quota-section')).toBeInTheDocument();
    expect(within(within(dot).getByRole('region', { name: 'Auto-resume' })).getByTestId('mock-auto-resume')).toBeInTheDocument();
    expect(within(dot).getByTestId('mock-stopped-section')).toBeInTheDocument();
    expect(within(within(dot).getByRole('region', { name: 'System controls' })).getByTestId('mock-cloister')).toBeInTheDocument();
  });
});
