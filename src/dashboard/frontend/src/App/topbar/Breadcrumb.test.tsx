import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePanesStore } from '../../lib/panesStore';
import { resetDeckLayoutStore, useDeckLayoutStore } from '../../lib/deckLayoutStore';
import { presetLayout } from '../../lib/paneLayout';
import { Breadcrumb } from './Breadcrumb';

const PROJECTS = [{ key: 'panopticon-cli', name: 'overdeck', path: '/p/overdeck' }];

function renderCrumb(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(['registered-projects'], PROJECTS);
  queryClient.setQueryData(['workspace-registry'], []);
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('Breadcrumb (PAN-5292 WI-E8)', () => {
  beforeEach(() => {
    usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('/api/registered-projects') ? Response.json(PROJECTS) : Response.json({})
    )));
  });

  afterEach(() => {
    usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} });
    vi.unstubAllGlobals();
  });

  it('reads the registered project name and the active pane label on the Command Deck, never the key', () => {
    const paneId = usePanesStore.getState().addPane('panopticon-cli', { paneType: 'agent', label: 'Fort 3D' });
    expect(usePanesStore.getState().activePaneByWorkspace['panopticon-cli']).toBe(paneId);

    renderCrumb(<Breadcrumb activeTab="command-deck" selectedProjectKey="panopticon-cli" />);

    const crumb = screen.getByTestId('topbar-crumb');
    expect(crumb).toHaveTextContent('overdeck/Fort 3D');
    expect(crumb).not.toHaveTextContent('panopticon-cli');
  });

  it('falls back to Home when the deck has no active pane yet', () => {
    renderCrumb(<Breadcrumb activeTab="command-deck" selectedProjectKey="panopticon-cli" />);
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent('overdeck/Home');
  });

  it('reads "No project / <pane>" on the No-project deck', () => {
    usePanesStore.getState().addPane('__no-project__', { paneType: 'terminal', label: 'Terminal' });
    renderCrumb(<Breadcrumb activeTab="command-deck" selectedProjectKey="__no-project__" />);
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent('No project/Terminal');
  });

  it('reads "All projects" on the Command Deck with no project selected', () => {
    renderCrumb(<Breadcrumb activeTab="command-deck" selectedProjectKey={null} />);
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent(/^All projects$/);
  });

  it('reads "All projects / <pane>" in the All projects deck (PAN-5343 H-D4)', () => {
    resetDeckLayoutStore();
    usePanesStore.getState().addPane('__all-projects__', { paneType: 'agent', label: 'Fix the build', conversationId: 'c1' });
    renderCrumb(<Breadcrumb activeTab="command-deck" selectedProjectKey="__all-projects__" />);
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent(/^All projects\/Fix the build$/);
  });

  it('reads "All projects / N conversations side by side" for a split All deck (PAN-5343 H-D4)', () => {
    resetDeckLayoutStore();
    usePanesStore.getState().addPane('__all-projects__', { paneType: 'agent', label: 'Fix the build', conversationId: 'c1' });
    useDeckLayoutStore.getState().setLayout('__all-projects__', presetLayout(['a', 'b', 'c'], 3));
    renderCrumb(<Breadcrumb activeTab="command-deck" selectedProjectKey="__all-projects__" />);
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent(/^All projects\/3 conversations side by side$/);
    resetDeckLayoutStore();
    localStorage.clear();
  });

  it('shows only the page title on other routes', () => {
    renderCrumb(<Breadcrumb activeTab="flywheel" selectedProjectKey="panopticon-cli" />);
    expect(screen.getByTestId('topbar-crumb')).toHaveTextContent(/^Flywheel$/);
  });
});
