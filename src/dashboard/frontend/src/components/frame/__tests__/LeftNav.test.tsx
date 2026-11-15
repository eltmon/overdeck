/**
 * PAN-5293 WI-8: the left column's nav. Replaces the Sidebar nav cases.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeftNav } from '../LeftNav';
import { MORE_GROUPS } from '../navGroups';
import { isExperimentalTab } from '../../../lib/experimentalFeatures';
import { usePanesStore } from '../../../lib/panesStore';
import type { Tab } from '../../Header';

let flywheelRunning = false;
vi.mock('../../../lib/flywheelApi', () => ({ useFlywheelRunning: () => flywheelRunning }));

let onTabChange: ReturnType<typeof vi.fn>;
let onOpenProjectHome: ReturnType<typeof vi.fn>;

function renderNav({ selectedProject = 'overdeck', experimental = false, activeTab = 'home' as Tab } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['settings', 'experimental-features'], experimental);
  return render(
    <QueryClientProvider client={client}>
      <LeftNav
        activeTab={activeTab}
        selectedProject={selectedProject}
        onTabChange={onTabChange}
        onOpenProjectHome={onOpenProjectHome}
        collapsed={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  flywheelRunning = false;
  onTabChange = vi.fn();
  onOpenProjectHome = vi.fn();
});

afterEach(() => {
  cleanup();
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
});

describe('LeftNav (PAN-5293 F-D11)', () => {
  it('Project home calls onOpenProjectHome, and is hidden with no project', () => {
    const view = renderNav();
    fireEvent.click(screen.getByTestId('left-nav-project-home'));
    expect(onOpenProjectHome).toHaveBeenCalledTimes(1);
    view.unmount();

    renderNav({ selectedProject: null as unknown as string });
    expect(screen.queryByTestId('left-nav-project-home')).not.toBeInTheDocument();
  });

  it('Flywheel shows "running" only while a run is going', () => {
    flywheelRunning = true;
    const view = renderNav();
    expect(screen.getByTestId('sidebar-flywheel-live')).toHaveTextContent('running');
    view.unmount();

    flywheelRunning = false;
    renderNav();
    expect(screen.getByTestId('sidebar-flywheel')).not.toHaveTextContent('running');
    expect(screen.queryByTestId('sidebar-flywheel-live')).not.toBeInTheDocument();
  });

  it('Flywheel and Order books change tab', () => {
    renderNav();
    fireEvent.click(screen.getByTestId('sidebar-flywheel'));
    fireEvent.click(screen.getByTestId('sidebar-orders'));
    expect(onTabChange.mock.calls).toEqual([['flywheel'], ['orders']]);
  });

  it('More lists every group with its items; Context and Skills sit under System; Pipeline changes tab', () => {
    renderNav({ experimental: true });
    fireEvent.click(screen.getByTestId('left-nav-more'));
    for (const group of MORE_GROUPS) {
      const section = screen.getByTestId(`left-nav-group-${group.label}`);
      expect(within(section).getByText(group.label)).toBeInTheDocument();
      for (const item of group.items) {
        expect(within(section).getByTestId(`sidebar-${item.id}`)).toHaveTextContent(item.label);
      }
    }
    const system = screen.getByTestId('left-nav-group-System');
    expect(within(system).getByTestId('sidebar-context')).toBeInTheDocument();
    expect(within(system).getByTestId('sidebar-skills')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sidebar-pipeline'));
    expect(onTabChange).toHaveBeenCalledWith('pipeline');
    expect(screen.queryByTestId('left-nav-more-menu')).not.toBeInTheDocument();
  });

  it('hides experimental views unless the setting is on', () => {
    const experimentalIds = MORE_GROUPS.flatMap((g) => g.items).map((i) => i.id).filter(isExperimentalTab);
    expect(experimentalIds.length).toBeGreaterThan(0);

    const view = renderNav({ experimental: false });
    fireEvent.click(screen.getByTestId('left-nav-more'));
    for (const id of experimentalIds) expect(screen.queryByTestId(`sidebar-${id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-pipeline')).toBeInTheDocument();
    view.unmount();

    renderNav({ experimental: true });
    fireEvent.click(screen.getByTestId('left-nav-more'));
    for (const id of experimentalIds) expect(screen.getByTestId(`sidebar-${id}`)).toBeInTheDocument();
  });
});

describe('LeftNav current-state (PAN-5335 WI-4)', () => {
  const home = { paneId: 'home-1', paneType: 'home' as const, label: 'Home', createdAt: 0, isPermanent: true };
  const agent = { paneId: 'agent-1', paneType: 'agent' as const, label: 'Agent', createdAt: 1 };

  it('neither Project home nor More is current when the active pane is an agent pane', () => {
    usePanesStore.setState({
      panesByWorkspace: { overdeck: [home, agent] },
      activePaneByWorkspace: { overdeck: agent.paneId },
    });
    renderNav({ activeTab: 'command-deck' });
    expect(screen.getByTestId('left-nav-project-home')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('left-nav-more')).not.toHaveAttribute('aria-current');
  });

  it('only Project home is current when the Home pane is active', () => {
    usePanesStore.setState({
      panesByWorkspace: { overdeck: [home, agent] },
      activePaneByWorkspace: { overdeck: home.paneId },
    });
    renderNav({ activeTab: 'command-deck' });
    expect(screen.getByTestId('left-nav-project-home')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('left-nav-more')).not.toHaveAttribute('aria-current');
  });

  it('only Project home is current when no pane is recorded', () => {
    renderNav({ activeTab: 'command-deck' });
    expect(screen.getByTestId('left-nav-project-home')).toHaveAttribute('aria-current', 'page');
  });

  it('only More is current on a plain More tab, and More is not current on settings', () => {
    const view = renderNav({ activeTab: 'metrics', experimental: true });
    expect(screen.getByTestId('left-nav-project-home')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('left-nav-more')).toHaveAttribute('aria-current', 'page');
    view.unmount();

    renderNav({ activeTab: 'settings' });
    expect(screen.getByTestId('left-nav-more')).not.toHaveAttribute('aria-current');
  });

  it('the More menu has no Command Deck item', () => {
    renderNav({ experimental: true });
    fireEvent.click(screen.getByTestId('left-nav-more'));
    expect(screen.queryByTestId('sidebar-command-deck')).not.toBeInTheDocument();
    expect(MORE_GROUPS.flatMap((g) => g.items).some((item) => item.id === 'command-deck')).toBe(false);
  });
});
