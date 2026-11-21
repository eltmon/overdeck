/**
 * PAN-5292 WI-E10 — the slim top bar. Every leaf is mocked to a marker so the
 * test pins only what AppChrome itself composes: order, removals, the search
 * box and what the health dot hosts.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownSnapshot } from '@overdeck/contracts';

import type { Tab } from '../components/Header';

const marker = (testId: string) => () => <span data-testid={testId} />;

vi.mock('./topbar/AgentsMenu', () => ({ AgentsMenu: marker('mock-agents-menu') }));
vi.mock('../hooks/useOverdeckBusy', () => ({ useOverdeckBusy: () => false }));
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
// PAN-5342: the banner and the System-controls entry are markers; HiddenWhenShutDown stays real.
vi.mock('../components/ShutdownBanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/ShutdownBanner')>()),
  ShutdownBanner: marker('mock-shutdown-banner'),
}));
vi.mock('../components/ShutdownDialog', () => ({ ShutdownSystemControl: marker('mock-shutdown-control') }));
vi.mock('../components/DegradedModeBanner', () => ({ DegradedModeBanner: marker('mock-degraded') }));
// The system-notices row and banners above the bar are unchanged by this child.
for (const [path, name] of [
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
const { useDashboardStore } = await import('../lib/store');
const { PALETTE_SEARCH_PLACEHOLDER, paletteKeycap } = await import('./appChromeLabels');

function renderChrome(overrides: { activeTab?: Tab; onPaletteOpen?: () => void; onGoHome?: () => void } = {}) {
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
      onPaletteOpen={overrides.onPaletteOpen ?? vi.fn()}
      onOpenSettings={vi.fn()}
      onDismissTrackerBanner={vi.fn()}
      onRestartBackend={vi.fn()}
      onRestartCliproxy={vi.fn()}
      onProjectCreated={vi.fn()}
      onGoHome={overrides.onGoHome ?? vi.fn()}
    />,
  );
}

function domOrder(...testIds: string[]): number[] {
  const all = Array.from(document.body.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
  return testIds.map((id) => all.indexOf(id));
}

describe('AppChrome top bar (PAN-5292)', () => {
  afterEach(() => {
    useDashboardStore.setState({ shutdown: null } as Parameters<typeof useDashboardStore.setState>[0]);
  });

  it('leads with the Overdeck brand, which opens Home (PAN-5293 F-D14)', () => {
    const onGoHome = vi.fn();
    renderChrome({ onGoHome });
    const brand = screen.getByTestId('topbar-brand');
    expect(brand).toHaveTextContent('Overdeck');
    expect(domOrder('topbar-brand', 'mock-crumb', 'topbar-search').every((v, i, a) => i === 0 || v > a[i - 1]!)).toBe(true);
    fireEvent.click(brand);
    expect(onGoHome).toHaveBeenCalledTimes(1);
  });

  it('opens the left-column drawer from the app bar (PAN-5293 F-D18)', () => {
    const opened = vi.fn();
    window.addEventListener('overdeck:open-left-column', opened);
    renderChrome();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener('overdeck:open-left-column', opened);
  });

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

  it('has no Activity-feed toggle on any page (PAN-5293 F-D22)', () => {
    const { unmount } = renderChrome({ activeTab: 'flywheel' });
    expect(screen.queryByRole('button', { name: 'Toggle activity feed' })).toBeNull();
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

  it('renders the shutdown banner above the system-notices row (PAN-5342)', () => {
    renderChrome();
    const banner = screen.getByTestId('mock-shutdown-banner');
    const row = document.querySelector('[data-component="system-notices-row"]')!;
    expect(banner.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the degraded-mode banner once the shutdown is complete (PAN-5342 D-12)', () => {
    const setShutdown = (phase: ShutdownSnapshot['phase'] | null) => act(() => {
      useDashboardStore.setState({
        shutdown: phase === null ? null : {
          phase, startedAt: '', deadlineAt: '', overdue: false, reboot: false, force: 'never',
          pending: [], writers: [], stoppedCount: 0, warnings: [],
        },
      } as Parameters<typeof useDashboardStore.setState>[0]);
    });
    setShutdown(null);
    renderChrome();
    expect(screen.getByTestId('mock-degraded')).toBeInTheDocument();

    setShutdown('draining');
    expect(screen.getByTestId('mock-degraded')).toBeInTheDocument();

    setShutdown('complete');
    expect(screen.queryByTestId('mock-degraded')).toBeNull();
  });

  it('compacts the brand and search box below sm (PAN-5585)', () => {
    renderChrome();
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    const brand = screen.getByTestId('topbar-brand');
    expect(within(brand).getByText('Overdeck')).toHaveClass('max-sm:hidden');
    const search = screen.getByTestId('topbar-search');
    expect(within(search).getByText(PALETTE_SEARCH_PLACEHOLDER)).toHaveClass('max-sm:hidden');
    expect(within(search).getByText(paletteKeycap())).toHaveClass('max-sm:hidden');
  });

  it('hosts the quota, auto-resume, stopped-agents and system-controls sections in the health dot', () => {
    renderChrome();
    const dot = screen.getByTestId('mock-health-dot');
    expect(within(dot).getByTestId('mock-quota-section')).toBeInTheDocument();
    expect(within(within(dot).getByRole('region', { name: 'Auto-resume' })).getByTestId('mock-auto-resume')).toBeInTheDocument();
    expect(within(dot).getByTestId('mock-stopped-section')).toBeInTheDocument();
    const controls = within(dot).getByRole('region', { name: 'System controls' });
    expect(within(controls).getByTestId('mock-cloister')).toBeInTheDocument();
    expect(within(controls).getByTestId('mock-shutdown-control')).toBeInTheDocument();
  });
});
