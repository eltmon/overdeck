import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App, {
  buildConversationUrl,
  getConversationRouteState,
  getConversationViewModeFromSearch,
  getConvIdFromPath,
  parseConversationViewModes,
  serializeConversationViewModes,
} from './App';

const {
  mockDashboardState,
  mockRefreshDashboardState,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockDashboardState: {
    agents: [],
    issues: [{ identifier: 'PAN-123', url: 'https://example.com/issues/PAN-123' }],
    dashboardLifecycle: { active: false },
    channelPermissionRequestsById: {},
  },
  mockRefreshDashboardState: vi.fn().mockResolvedValue(undefined),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastSuccess: vi.fn(),
}))

vi.mock('./components/KanbanBoard', () => ({
  KanbanBoard: ({ onSelectIssue }: { onSelectIssue?: (issueId: string | null) => void }) => (
    <button onClick={() => onSelectIssue?.('PAN-123')}>Open issue</button>
  ),
}));
vi.mock('./components/AgentList', () => ({ AgentList: () => null }));
vi.mock('./components/AgentOutputPanel', () => ({ AgentOutputPanel: () => null }));
vi.mock('./components/HealthDashboard', () => ({ HealthDashboard: () => null }));
vi.mock('./components/SkillsList', () => ({ SkillsList: () => null }));
vi.mock('./components/ActivityPanel', () => ({ ActivityPanel: () => null }));
vi.mock('./components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));
vi.mock('./components/ChannelPermissionDialog', () => ({
  ChannelPermissionDialog: ({ request, isOpen, onAllow, onDeny }: {
    request: { requestId: string; toolName: string } | null;
    isOpen: boolean;
    onAllow: () => void;
    onDeny: () => void;
  }) => isOpen && request ? (
    <div>
      <div data-testid="channel-permission-request">{request.requestId}:{request.toolName}</div>
      <button onClick={onAllow}>Allow channel permission</button>
      <button onClick={onDeny}>Deny channel permission</button>
    </div>
  ) : null,
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
vi.mock('./components/DetailPanelLayout', () => ({
  DetailPanelLayout: ({ inline }: { inline?: boolean }) => <div data-testid="detail-panel-layout" data-inline={inline ? 'true' : 'false'} />,
}));
vi.mock('./components/StandaloneTerminal', () => ({ StandaloneTerminal: () => null }));
vi.mock('./hooks/useCodexAutoRetry', () => ({ useCodexAutoRetry: () => null }));
vi.mock('./components/SystemHealthPill', () => ({ SystemHealthPill: () => null }));
vi.mock('lucide-react', () => ({ AlertTriangle: () => null, RefreshCw: () => null, X: () => null, ArrowRight: () => null, Loader2: () => null, ChevronDown: () => null, Cpu: () => null, MemoryStick: () => null, Skull: () => null }));
vi.mock('./components/upgrade-announcement/UpgradeAnnouncement', () => ({ UpgradeAnnouncement: () => null }));
vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    error: mockToastError,
    info: mockToastInfo,
    success: mockToastSuccess,
  },
}));
vi.mock('./lib/store', () => ({
  useDashboardStore: vi.fn((selector?: unknown) => {
    if (typeof selector === 'function') {
      return selector(mockDashboardState);
    }
    return [];
  }),
  selectAgentList: (state: { agents: unknown[] }) => state.agents,
  selectChannelPermissionRequests: (state: { channelPermissionRequestsById?: Record<string, unknown> }) =>
    Object.values(state.channelPermissionRequestsById ?? {}),
  selectIssues: (state: { issues: unknown[] }) => state.issues,
  selectDashboardLifecycle: (state: { dashboardLifecycle: { active: boolean } }) => state.dashboardLifecycle,
}));
vi.mock('./lib/refresh-dashboard-state', () => ({
  refreshDashboardState: mockRefreshDashboardState,
}));
vi.mock('./components/CommandDeck', () => ({
  CommandDeck: ({ conversationViewMode, onConversationViewModeChange }: {
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

beforeEach(() => {
  mockDashboardState.agents = []
  mockDashboardState.issues = [{ identifier: 'PAN-123', url: 'https://example.com/issues/PAN-123' }]
  mockDashboardState.dashboardLifecycle = { active: false }
  mockDashboardState.channelPermissionRequestsById = {}
  mockRefreshDashboardState.mockClear()
  mockToastError.mockClear()
  mockToastInfo.mockClear()
  mockToastSuccess.mockClear()
})

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

describe('App kanban issue details', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
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

  it('opens issue details inline in a modal from kanban selection', () => {
    renderApp();

    fireEvent.click(screen.getByText('Open issue'));

    expect(screen.getByTestId('detail-panel-layout')).toHaveAttribute('data-inline', 'true');
  });
});

describe('App channel permission requests', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    mockDashboardState.agents = [{ id: 'agent-987', issueId: 'PAN-987' }]
    mockDashboardState.channelPermissionRequestsById = {
      'perm-123': {
        requestId: 'perm-123',
        agentId: 'agent-987',
        issueId: 'PAN-987',
        toolName: 'Bash',
        description: 'Run npm test',
        inputPreview: '{"command":"npm test"}',
        createdAt: '2026-05-07T18:30:00.000Z',
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/version') {
        return new Response(JSON.stringify({ version: '0.5.0' }), { status: 200 })
      }
      if (url === '/api/tracker-status') {
        return new Response(JSON.stringify({ primary: 'github', configured: [] }), { status: 200 })
      }
      if (url === '/api/confirmations') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url === '/api/agents/agent-987/permissions/perm-123/respond') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }))
  })

  it('submits allow decisions for pending channel permission requests', async () => {
    renderApp()

    expect(screen.getByTestId('channel-permission-request')).toHaveTextContent('perm-123:Bash')
    fireEvent.click(screen.getByText('Allow channel permission'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/agents/agent-987/permissions/perm-123/respond',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ behavior: 'allow' }),
        }),
      )
    })
    expect(screen.queryByTestId('channel-permission-request')).toBeNull()
    expect(mockRefreshDashboardState).toHaveBeenCalledTimes(1)
    expect(mockToastSuccess).toHaveBeenCalledWith('Allowed agent-987 to continue')
  })

  it('submits deny decisions for pending channel permission requests', async () => {
    renderApp()

    fireEvent.click(screen.getByText('Deny channel permission'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/agents/agent-987/permissions/perm-123/respond',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ behavior: 'deny' }),
        }),
      )
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('Denied permission request for agent-987')
  })
})
