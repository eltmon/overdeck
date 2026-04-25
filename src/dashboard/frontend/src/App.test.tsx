import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App, {
  buildConversationUrl,
  getConversationRouteState,
  getConversationViewModeFromSearch,
  getConvIdFromPath,
  parseConversationViewModes,
  serializeConversationViewModes,
} from './App';

vi.mock('./components/KanbanBoard', () => ({ KanbanBoard: () => null }));
vi.mock('./components/AgentList', () => ({ AgentList: () => null }));
vi.mock('./components/AgentOutputPanel', () => ({ AgentOutputPanel: () => null }));
vi.mock('./components/HealthDashboard', () => ({ HealthDashboard: () => null }));
vi.mock('./components/SkillsList', () => ({ SkillsList: () => null }));
vi.mock('./components/ActivityPanel', () => ({ ActivityPanel: () => null }));
vi.mock('./components/AwaitingMergePage', () => ({ AwaitingMergePage: () => null }));
vi.mock('./components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));
vi.mock('./components/EventRouter', () => ({ EventRouter: () => null }));
vi.mock('./components/MetricsSummaryRow', () => ({ MetricsSummaryRow: () => null }));
vi.mock('./components/MetricsPage', () => ({ MetricsPage: () => null }));
vi.mock('./components/CostsPage', () => ({ CostsPage: () => null }));
vi.mock('./components/Settings/SettingsPage', () => ({ SettingsPage: () => null }));
vi.mock('./components/search/SearchModal', () => ({ SearchModal: () => null }));
vi.mock('./components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./components/ResourcesPanel', () => ({ ResourcesPanel: () => null }));
vi.mock('./components/GodView', () => ({ GodViewPage: () => null }));
vi.mock('./components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('./components/BootstrapGate', () => ({ BootstrapGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./components/skeletons/KanbanSkeleton', () => ({ KanbanSkeleton: () => null }));
vi.mock('./components/skeletons/AgentListSkeleton', () => ({ AgentListSkeleton: () => null }));
vi.mock('./components/skeletons/GodViewSkeleton', () => ({ GodViewSkeleton: () => null }));
vi.mock('./components/DetailPanelLayout', () => ({ DetailPanelLayout: () => null }));
vi.mock('./components/StandaloneTerminal', () => ({ StandaloneTerminal: () => null }));
vi.mock('lucide-react', () => ({ AlertTriangle: () => null, RefreshCw: () => null, X: () => null, ArrowRight: () => null }));
vi.mock('./components/upgrade-announcement/UpgradeAnnouncement', () => ({ UpgradeAnnouncement: () => null }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: { info: vi.fn() } }));
vi.mock('./lib/store', () => ({
  useDashboardStore: vi.fn(() => []),
  selectAgentList: vi.fn(),
  selectIssues: vi.fn(),
  selectDashboardLifecycle: vi.fn(),
}));
vi.mock('./components/MissionControl', () => ({
  MissionControl: ({ conversationViewMode, onConversationViewModeChange }: {
    conversationViewMode?: 'conversation' | 'terminal';
    onConversationViewModeChange?: (mode: 'conversation' | 'terminal') => void;
  }) => (
    <div>
      <div data-testid="view-mode">{conversationViewMode}</div>
      <button onClick={() => onConversationViewModeChange?.('terminal')}>Terminal</button>
      <button onClick={() => onConversationViewModeChange?.('conversation')}>Conversation</button>
    </div>
  ),
}));

function renderApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('conversation route helpers', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('parses terminal view from the URL search string', () => {
    expect(getConversationViewModeFromSearch('?view=terminal')).toBe('terminal');
    expect(getConversationViewModeFromSearch('?view=garbage')).toBe('conversation');
    expect(getConversationViewModeFromSearch('')).toBe('conversation');
  });

  it('extracts conversation id from conversation paths only', () => {
    expect(getConvIdFromPath('/conv/123')).toBe('123');
    expect(getConvIdFromPath('/command-deck')).toBeNull();
  });

  it('serializes and parses per-conversation terminal view memory', () => {
    expect(serializeConversationViewModes({ '161': 'terminal', '200': 'conversation', '99': 'terminal' }))
      .toBe('99:terminal,161:terminal');
    expect(parseConversationViewModes('?views=99:terminal,161:terminal')).toEqual({
      '99': 'terminal',
      '161': 'terminal',
    });
  });

  it('builds per-conversation URLs with remembered view state', () => {
    expect(buildConversationUrl('123', 'terminal')).toBe('/conv/123?view=terminal&views=123%3Aterminal');
    expect(buildConversationUrl('123', 'conversation', { '123': 'terminal', '161': 'terminal' }))
      .toBe('/conv/123?views=161%3Aterminal');
    expect(buildConversationUrl(null, 'terminal')).toBe('/command-deck');
  });

  it('reads combined conversation route state from the current URL', () => {
    window.history.replaceState(null, '', '/conv/55?view=terminal&views=55:terminal,161:terminal');
    expect(getConversationRouteState()).toEqual({
      tab: 'command-deck',
      convId: '55',
      viewMode: 'terminal',
      viewModes: {
        '55': 'terminal',
        '161': 'terminal',
      },
    });
  });
});

describe('App conversation view routing', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/conv/77');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/version') {
        return new Response(JSON.stringify({ version: '0.5.0' }), { status: 200 });
      }
      if (url === '/api/tracker-status') {
        return new Response(JSON.stringify({ primary: 'github', configured: [] }), { status: 200 });
      }
      if (url === '/api/confirmations') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));
  });

  it('defaults missing view state to conversation mode', () => {
    renderApp();
    expect(screen.getByTestId('view-mode')).toHaveTextContent('conversation');
  });

  it('restores terminal view from the URL on initial render', () => {
    window.history.replaceState(null, '', '/conv/77?view=terminal');
    renderApp();
    expect(screen.getByTestId('view-mode')).toHaveTextContent('terminal');
  });

  it('does not strip terminal view from a direct deep link on initial render', () => {
    window.history.replaceState(null, '', '/conv/77?view=terminal');
    renderApp();
    expect(window.location.pathname).toBe('/conv/77');
    expect(window.location.search).toBe('?view=terminal');
    expect(screen.getByTestId('view-mode')).toHaveTextContent('terminal');
  });

  it('updates the current conversation URL when the view mode changes', () => {
    renderApp();
    fireEvent.click(screen.getByText('Terminal'));
    expect(window.location.pathname).toBe('/conv/77');
    expect(window.location.search).toBe('?view=terminal&views=77%3Aterminal');

    fireEvent.click(screen.getByText('Conversation'));
    expect(window.location.pathname).toBe('/conv/77');
    expect(window.location.search).toBe('');
  });

  it('restores a remembered terminal view when returning to a conversation', () => {
    window.history.replaceState(null, '', '/conv/161?views=77:terminal,161:terminal');
    renderApp();

    expect(screen.getByTestId('view-mode')).toHaveTextContent('terminal');
    expect(window.location.search).toBe('?views=77:terminal,161:terminal');
  });
});
