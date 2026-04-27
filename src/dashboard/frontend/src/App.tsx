import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { KanbanBoard } from './components/KanbanBoard';
import { AgentList } from './components/AgentList';
import { AgentOutputPanel } from './components/AgentOutputPanel';
import { HealthDashboard } from './components/HealthDashboard';
import { SkillsList } from './components/SkillsList';
import { ActivityPanel } from './components/ActivityPanel';
import { AwaitingMergePage } from './components/AwaitingMergePage';
import { ConfirmationDialog, ConfirmationRequest } from './components/ConfirmationDialog';
import { EventRouter } from './components/EventRouter';
import { MetricsSummaryRow } from './components/MetricsSummaryRow';
import { MetricsPage } from './components/MetricsPage';
import { CostsPage } from './components/CostsPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { SearchModal } from './components/search/SearchModal';
import { CommandPalette } from './components/CommandPalette';
import { CommandDeck } from './components/CommandDeck';
import { ResourcesPanel } from './components/ResourcesPanel';
import { GodViewPage } from './components/GodView';
import { Tab } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { BootstrapGate } from './components/BootstrapGate';
import { KanbanSkeleton } from './components/skeletons/KanbanSkeleton';
import { AgentListSkeleton } from './components/skeletons/AgentListSkeleton';
import { GodViewSkeleton } from './components/skeletons/GodViewSkeleton';
import { DetailPanelLayout } from './components/DetailPanelLayout';
import { UpgradeAnnouncement } from './components/upgrade-announcement/UpgradeAnnouncement';
import { StandaloneTerminal } from './components/StandaloneTerminal';
import { DeaconPauseBanner } from './components/DeaconPauseToggle';
import { StoppedAgentsBanner } from './components/StoppedAgentsBanner';
import { SystemHealthPill } from './components/SystemHealthPill';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Agent, Issue } from './types';
import { useDashboardStore, selectAgentList, selectIssues, selectDashboardLifecycle } from './lib/store';
import type { ViewMode as ConversationViewMode } from './components/chat/ConversationPanel';

interface TrackerStatusItem {
  type: string;
  name: string;
  hasKey: boolean;
  envVar: string;
  isPrimary: boolean;
}

interface TrackerStatus {
  primary: string;
  secondary?: string;
  configured: TrackerStatusItem[];
}

const TAB_PATHS: Record<Tab, string> = {
  kanban: '/',
  'command-deck': '/command-deck',
  agents: '/agents',
  resources: '/resources',
  'awaiting-merge': '/awaiting-merge',
  activity: '/activity',
  metrics: '/metrics',
  costs: '/costs',
  skills: '/skills',
  health: '/health',
  settings: '/settings',
  'god-view': '/god-view',
};

const PATH_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab])
) as Record<string, Tab>;

function getTabFromPath(): Tab {
  const path = window.location.pathname;
  if (path.startsWith('/conv/')) return 'command-deck';
  return PATH_TO_TAB[path] || 'kanban';
}

export function getConversationViewModeFromSearch(search = window.location.search): ConversationViewMode {
  const view = new URLSearchParams(search).get('view');
  return view === 'terminal' ? 'terminal' : 'conversation';
}

export type ConversationViewModeMap = Record<string, ConversationViewMode>;

export function parseConversationViewModes(search = window.location.search): ConversationViewModeMap {
  const raw = new URLSearchParams(search).get('views');
  if (!raw) return {};

  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .reduce<ConversationViewModeMap>((acc, entry) => {
      const [id, mode] = entry.split(':');
      if (!id) return acc;
      acc[id] = mode === 'terminal' ? 'terminal' : 'conversation';
      return acc;
    }, {});
}

export function serializeConversationViewModes(viewModes: ConversationViewModeMap): string {
  return Object.entries(viewModes)
    .filter(([, mode]) => mode === 'terminal')
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, mode]) => `${id}:${mode}`)
    .join(',');
}

/** Extract conversation ID from /conv/:id path, or null if not matching. */
export function getConvIdFromPath(path = window.location.pathname): string | null {
  const match = path.match(/^\/conv\/(\d+)$/);
  return match ? match[1] : null;
}

export function getConversationRouteState() {
  const convId = getConvIdFromPath();
  const viewModes = parseConversationViewModes();
  const explicitViewMode = getConversationViewModeFromSearch();
  const viewMode = convId
    ? explicitViewMode === 'terminal'
      ? 'terminal'
      : viewModes[convId] ?? 'conversation'
    : 'conversation';

  if (convId && explicitViewMode === 'terminal') {
    viewModes[convId] = 'terminal';
  }

  return {
    tab: getTabFromPath(),
    convId,
    viewMode,
    viewModes,
  };
}

export function buildConversationUrl(
  id: string | null,
  viewMode: ConversationViewMode = 'conversation',
  viewModes: ConversationViewModeMap = {},
): string {
  if (!id) return '/command-deck';
  const nextViewModes = { ...viewModes };
  if (viewMode === 'terminal') {
    nextViewModes[id] = 'terminal';
  } else {
    delete nextViewModes[id];
  }

  const params = new URLSearchParams();
  if (viewMode === 'terminal') {
    params.set('view', 'terminal');
  }
  const serialized = serializeConversationViewModes(nextViewModes);
  if (serialized) {
    params.set('views', serialized);
  }
  const query = params.toString();
  return query ? `/conv/${id}?${query}` : `/conv/${id}`;
}

async function fetchBackendHealth(): Promise<{ version: string }> {
  const res = await fetch('/api/version');
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

async function fetchTrackerStatus(): Promise<TrackerStatus> {
  const res = await fetch('/api/tracker-status');
  if (!res.ok) throw new Error('Failed to fetch tracker status');
  return res.json();
}

async function fetchConfirmations(): Promise<ConfirmationRequest[]> {
  const res = await fetch('/api/confirmations');
  if (!res.ok) throw new Error('Failed to fetch confirmations');
  return res.json();
}

async function respondToConfirmation(id: string, confirmed: boolean): Promise<void> {
  const res = await fetch(`/api/confirmations/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed }),
  });
  if (!res.ok) throw new Error('Failed to respond to confirmation');
}

interface CliproxyStatus {
  running: boolean;
  pid: number | null;
  checkedAt: string;
}

async function fetchCliproxyStatus(): Promise<CliproxyStatus> {
  const res = await fetch('/api/cliproxy/status');
  if (!res.ok) throw new Error('Failed to fetch CLIProxy status');
  return res.json();
}

async function restartCliproxy(): Promise<void> {
  const res = await fetch('/api/cliproxy/restart', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to restart CLIProxy');
}

export default function App() {
  const terminalPath = window.location.pathname;
  const terminalSession = new URLSearchParams(window.location.search).get('terminal');
  if (terminalPath.startsWith('/terminal/') || terminalSession) {
    const sessionName = terminalPath.startsWith('/terminal/')
      ? terminalPath.replace('/terminal/', '')
      : terminalSession!;
    return (
      <div className="h-screen overflow-hidden bg-[#0d1117]">
        <EventRouter />
        <StandaloneTerminal sessionName={sessionName} />
      </div>
    );
  }

  const [activeTab, setActiveTabState] = useState<Tab>(() => getConversationRouteState().tab);
  const [selectedAgent, setSelectedAgentState] = useState<string | null>(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#agent=')) return decodeURIComponent(hash.slice(7));
    return null;
  });
  const setSelectedAgent = useCallback((id: string | null) => {
    setSelectedAgentState(id);
    if (id) {
      window.history.replaceState(null, '', `${window.location.pathname}#agent=${encodeURIComponent(id)}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  // Sync deep-link on hash change (browser back/forward or direct navigation)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#agent=')) {
        setSelectedAgentState(decodeURIComponent(hash.slice(7)));
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Conversation deep-link state (/conv/:id?view=terminal&views=161:terminal)
  const initialConversationRoute = getConversationRouteState();
  const [selectedConvId, setSelectedConvIdState] = useState<string | null>(() => initialConversationRoute.convId);
  const [conversationViewMode, setConversationViewModeState] = useState<ConversationViewMode>(
    () => initialConversationRoute.viewMode,
  );
  const [conversationViewModes, setConversationViewModes] = useState<ConversationViewModeMap>(
    () => initialConversationRoute.viewModes,
  );
  const setConversationRoute = useCallback((id: string | null, viewMode: ConversationViewMode = 'conversation') => {
    setSelectedConvIdState(id);
    setConversationViewModeState(id ? viewMode : 'conversation');
    setConversationViewModes((current) => {
      const next = { ...current };
      if (id && viewMode === 'terminal') {
        next[id] = 'terminal';
      } else if (id) {
        delete next[id];
      }
      window.history.replaceState(null, '', buildConversationUrl(id, viewMode, current));
      return next;
    });
  }, []);
  const setSelectedConvId = useCallback((id: string | null) => {
    const nextViewMode = id ? (conversationViewModes[id] ?? 'conversation') : 'conversation';
    setConversationRoute(id, nextViewMode);
  }, [conversationViewModes, setConversationRoute]);
  const setConversationViewMode = useCallback((viewMode: ConversationViewMode) => {
    setConversationRoute(selectedConvId, viewMode);
  }, [selectedConvId, setConversationRoute]);

  const queryClient = useQueryClient();

  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [planDialogIssueId, setPlanDialogIssueId] = useState<string | null>(null);
  const [currentConfirmation, setCurrentConfirmation] = useState<ConfirmationRequest | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [trackerBannerDismissed, setTrackerBannerDismissed] = useState(false);

  // Dashboard lifecycle state from event store (restart events)
  const dashboardLifecycle = useDashboardStore(selectDashboardLifecycle);

  // Backend health check — poll every 5s so we catch outages quickly
  const { isError: backendDown, failureCount: backendFailureCount } = useQuery({
    queryKey: ['backend-health'],
    queryFn: fetchBackendHealth,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    retry: 1, // one retry before marking as error
    retryDelay: 1000,
    staleTime: 0,
  });
  // Only show banner after 2 consecutive failures to avoid flicker on transient errors
  const showBackendBanner = backendDown && backendFailureCount >= 2;
  // Restart banner: shown when dashboard is in a planned restart (lifecycle active)
  const showRestartBanner = dashboardLifecycle.active;

  // Check tracker status for missing API keys
  const { data: trackerStatus } = useQuery({
    queryKey: ['tracker-status'],
    queryFn: fetchTrackerStatus,
    refetchInterval: 60000,
    retry: false,
  });

  const missingKeyTrackers = trackerStatus?.configured.filter(t => !t.hasKey) || [];

  // CLIProxy health check — poll every 10s
  const { data: cliproxyStatus } = useQuery({
    queryKey: ['cliproxy-status'],
    queryFn: fetchCliproxyStatus,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: 1,
    retryDelay: 1000,
    staleTime: 0,
  });

  const showCliproxyBanner = cliproxyStatus && !cliproxyStatus.running;

  const restartCliproxyMutation = useMutation({
    mutationFn: restartCliproxy,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cliproxy-status'] });
      toast.success('CLIProxy restarted successfully');
    },
    onError: (err: Error) => {
      toast.error('Failed to restart CLIProxy: ' + err.message);
    },
  });

  // URL-synced tab navigation
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    const path = TAB_PATHS[tab];
    if (window.location.pathname !== path) {
      window.history.pushState({ tab }, '', path);
    }
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const routeState = getConversationRouteState();
      setActiveTabState(routeState.tab);
      setSelectedConvIdState(routeState.convId);
      setConversationViewModeState(routeState.viewMode);
      setConversationViewModes(routeState.viewModes);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Agents from Zustand store (event-sourced — no polling)
  // Cast to Agent[] since AgentSnapshot is a compatible subset for the fields used here
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

  // Issues from Zustand store (event-sourced via snapshot — no polling)
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];

  // Poll for pending confirmations
  const { data: confirmations = [] } = useQuery({
    queryKey: ['confirmations'],
    queryFn: fetchConfirmations,
    refetchInterval: 10000,
  });

  // Show the most recent confirmation request
  useEffect(() => {
    if (confirmations.length > 0 && !currentConfirmation) {
      setCurrentConfirmation(confirmations[0]);
    }
  }, [confirmations, currentConfirmation]);

  // Track which planning agents have already fired an INPUT toast to avoid spam
  const notifiedPlanningInputRef = useRef<Set<string>>(new Set());

  // Toast notification when a planning agent needs user input
  useEffect(() => {
    const planningAgentsNeedingInput = agents.filter(
      (a) => a.agentPhase === 'planning' && a.hasPendingQuestion && a.status !== 'stopped'
    );

    for (const agent of planningAgentsNeedingInput) {
      const key = `${agent.id}-input`;
      if (!notifiedPlanningInputRef.current.has(key)) {
        notifiedPlanningInputRef.current.add(key);
        toast.info(`Planning agent needs input for ${agent.issueId || agent.id}`, {
          description: 'The planning agent has a question for you. Open the Plan dialog to respond.',
          duration: 10000,
        });
      }
    }

    for (const key of notifiedPlanningInputRef.current) {
      const agentId = key.replace('-input', '');
      const agent = agents.find((a) => a.id === agentId);
      if (!agent || !agent.hasPendingQuestion || agent.status === 'stopped') {
        notifiedPlanningInputRef.current.delete(key);
      }
    }
  }, [agents]);

  // Find the work agent for selected issue (agent-<id>, not planning-<id>)
  const selectedIssueAgent = selectedIssue
    ? agents.find((a) => a.issueId?.toLowerCase() === selectedIssue.toLowerCase() && a.id.startsWith('agent-'))
      ?? agents.find((a) => a.issueId?.toLowerCase() === selectedIssue.toLowerCase())
      ?? null
    : null;

  // Find issue URL for selected issue
  const selectedIssueData = selectedIssue
    ? issues.find((i) => i.identifier.toLowerCase() === selectedIssue.toLowerCase())
    : null;


  const handleConfirm = useCallback(async () => {
    if (!currentConfirmation) return;
    try {
      await respondToConfirmation(currentConfirmation.id, true);
      setCurrentConfirmation(null);
    } catch (error) {
      console.error('Failed to confirm:', error);
    }
  }, [currentConfirmation]);

  const handleDeny = useCallback(async () => {
    if (!currentConfirmation) return;
    try {
      await respondToConfirmation(currentConfirmation.id, false);
      setCurrentConfirmation(null);
    } catch (error) {
      console.error('Failed to deny:', error);
    }
  }, [currentConfirmation]);

  const handleCloseConfirmation = useCallback(() => {
    setCurrentConfirmation(null);
  }, []);

  // Global keyboard shortcuts: / for search, Cmd+K for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.includes('Mac');
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === '/' && !inInput) {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if (e.key === 'k' && isCmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for menu actions from desktop app (open-settings, etc.)
  useEffect(() => {
    const bridge = window.panopticonBridge;
    if (!bridge) return;
    const unsub = bridge.onMenuAction((action: string) => {
      if (action === 'open-settings') {
        setActiveTab('settings');
      } else if (action.startsWith('open-workspace:')) {
        const issueId = action.slice('open-workspace:'.length);
        setActiveTab('kanban');
        if (issueId) setSelectedIssue(issueId);
      } else if (action.startsWith('auto-start-nag:')) {
        // Format: auto-start-nag:<count>:<max>
        setIsPaletteOpen(false);
        // Let the nag toast be handled below
        const parts = action.split(':');
        const count = parseInt(parts[1] ?? '0', 10);
        const max = parseInt(parts[2] ?? '5', 10);
        showAutoStartNag(count, max);
      }
    });
    return unsub;
  }, []);

  // Auto-start nag toast for desktop app (launched 2-5 times without enabling)
  function showAutoStartNag(count: number, max: number): void {
    const messages = [
      "Auto-start means never missing an agent asking for help.",
      "Your agents could be waiting for you right now.",
      "Panopticon works best when it's always watching.",
      "One click enables auto-start. You can disable it anytime.",
    ];
    const msg = messages[(count - 2) % messages.length] ?? messages[0];
    toast(`Reminder ${count} of ${max} — ${msg}`, {
      duration: 8_000,
      action: {
        label: 'Enable',
        onClick: () => {
          void window.panopticonBridge?.updateDesktopSetting('autoStart.enabled', true);
        },
      },
    });
  }

  const handleSelectIssueFromSearch = useCallback((issueId: string) => {
    setSelectedIssue(issueId);
    setActiveTab('kanban');
  }, []);

  return (
    <div className="h-screen flex flex-row overflow-hidden bg-background">
      {/* Event-sourced state: connects WsTransport → DashboardStore (PAN-428 B4) */}
      <EventRouter />

      {/* Collapsible sidebar navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSearchOpen={() => setIsSearchOpen(true)}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Upgrade Announcement — shown once after upgrading to 0.7.0 */}
        <UpgradeAnnouncement />

        {/* Deacon Frozen Banner — shown whenever the global patrol pause flag is set */}
        <DeaconPauseBanner />

        {/* Stopped Agents Banner — shown when agents are stopped (e.g., after reboot) */}
        <StoppedAgentsBanner />

        {/* Dashboard Restart Banner — shown during a planned restart (post-merge deploy, pan restart) */}
        {showRestartBanner && (
          <div className="bg-primary/15 border-b-2 border-primary/40 px-4 py-3 flex items-center gap-3 shrink-0">
            <RefreshCw className="w-5 h-5 text-primary shrink-0 animate-spin" />
            <p className="text-primary text-sm font-semibold flex-1">
              Dashboard is restarting
              {dashboardLifecycle.issueId && (
                <> — <span className="font-mono">{dashboardLifecycle.issueId}</span></>
              )}
              {dashboardLifecycle.reason && (
                <span className="font-normal ml-1 text-primary/70">({dashboardLifecycle.reason})</span>
              )}
            </p>
            <span className="text-primary/60 text-xs shrink-0 animate-pulse">● Restarting…</span>
          </div>
        )}

        {/* Backend Offline Banner — shown when /api/version fails repeatedly AND not in a planned restart */}
        {showBackendBanner && !showRestartBanner && (
          <div className="bg-destructive/15 border-b-2 border-destructive/50 px-4 py-3 flex items-center gap-3 shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-destructive text-sm font-semibold flex-1">
              Backend is unreachable — dashboard data is stale. Check that <code className="font-mono bg-destructive/20 px-1 rounded">pan up</code> is running.
            </p>
            <span className="text-destructive/60 text-xs shrink-0 animate-pulse">● Retrying…</span>
          </div>
        )}

        {/* Missing Tracker API Key Banner */}
        {missingKeyTrackers.length > 0 && !trackerBannerDismissed && (
          <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 flex items-center gap-3 shrink-0">
            <AlertTriangle className="w-4 h-4 text-warning-foreground shrink-0" />
            <p className="text-warning-foreground text-sm flex-1">
              <span className="font-semibold">Missing API key{missingKeyTrackers.length > 1 ? 's' : ''}:</span>{' '}
              {missingKeyTrackers.map(t => (
                <span key={t.type}>
                  {t.name} (<code className="font-mono text-xs bg-warning/20 px-1 rounded">{t.envVar}</code>)
                </span>
              )).reduce((prev, curr, i) => i === 0 ? [curr] : [...prev, ', ', curr], [] as React.ReactNode[])}.{' '}
              <button
                onClick={() => setActiveTab('settings')}
                className="underline hover:opacity-80 font-semibold"
              >
                Configure in Settings
              </button>
            </p>
            <button
              onClick={() => setTrackerBannerDismissed(true)}
              className="text-warning-foreground/60 hover:text-warning-foreground shrink-0"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* CLIProxy Down Banner — shown when the GPT subscription sidecar is not running */}
        {showCliproxyBanner && (
          <div className="bg-warning/10 border-b-2 border-warning/40 px-4 py-3 flex items-center gap-3 shrink-0">
            <AlertTriangle className="w-5 h-5 text-warning-foreground shrink-0" />
            <p className="text-warning-foreground text-sm font-semibold flex-1">
              CLIProxy is down — GPT subscription agents will fail.
            </p>
            <button
              onClick={() => restartCliproxyMutation.mutate()}
              disabled={restartCliproxyMutation.isPending}
              className="px-3 py-1.5 bg-warning/20 hover:bg-warning/30 text-warning-foreground text-sm font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {restartCliproxyMutation.isPending ? 'Restarting…' : 'Restart CLIProxy'}
            </button>
          </div>
        )}

        <div className="relative z-[200] border-b border-border bg-background/95 px-4 py-2 backdrop-blur shrink-0">
          <div className="flex items-center justify-end">
            <div className="w-full max-w-xs">
              <SystemHealthPill />
            </div>
          </div>
        </div>

        <main className="flex-1 flex overflow-hidden">
          {activeTab === 'command-deck' && (
            <div className="w-full h-full">
              <CommandDeck
                issues={issues}
                convId={selectedConvId}
                conversationViewMode={conversationViewMode}
                onConvIdChange={setSelectedConvId}
                onConversationViewModeChange={setConversationViewMode}
              />
            </div>
          )}
        {activeTab === 'kanban' && (
          <BootstrapGate fallback={
            <div className="flex-1 overflow-auto p-6 w-full">
              <KanbanSkeleton />
            </div>
          }>
            <>
              <div className={`flex-1 overflow-auto p-6 ${selectedIssue ? '' : 'w-full'}`}>
                <MetricsSummaryRow />
                <KanbanBoard
                  selectedIssue={selectedIssue}
                  onSelectIssue={setSelectedIssue}
                  onPlanDialogChange={setPlanDialogIssueId}
                />
              </div>
              {selectedIssue && selectedIssueData && (
                <DetailPanelLayout
                  agent={selectedIssueAgent ?? undefined}
                  issueId={selectedIssue}
                  issueUrl={selectedIssueData.url}
                  issue={selectedIssueData}
                  onClose={() => setSelectedIssue(null)}
                  suppressTerminal={planDialogIssueId === selectedIssue}
                />
              )}
            </>
          </BootstrapGate>
        )}
        {activeTab === 'agents' && (
          <BootstrapGate fallback={<AgentListSkeleton />}>
            <div className="flex w-full h-full overflow-hidden">
              <div className={`${selectedAgent ? 'w-1/2 lg:w-5/12' : 'w-full'} overflow-y-auto p-6`}>
                <AgentList
                  selectedAgent={selectedAgent}
                  onSelectAgent={setSelectedAgent}
                />
              </div>
              {selectedAgent && (
                <div className="flex-1 min-w-0 h-full flex flex-col border-l border-border">
                  <AgentOutputPanel agentId={selectedAgent} />
                </div>
              )}
            </div>
          </BootstrapGate>
        )}
        {activeTab === 'resources' && (
          <div className="w-full h-full overflow-hidden">
            <ResourcesPanel
              onNavigateToAgents={(agentId) => {
                setSelectedAgent(agentId);
                setActiveTab('agents');
              }}
            />
          </div>
        )}
        {activeTab === 'skills' && (
          <div className="p-6 w-full overflow-auto">
            <SkillsList />
          </div>
        )}
        {activeTab === 'health' && (
          <div className="p-6 w-full overflow-auto">
            <HealthDashboard />
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="w-full h-full">
            <ActivityPanel onClose={() => setActiveTab('kanban')} />
          </div>
        )}
        {activeTab === 'metrics' && (
          <div className="w-full overflow-auto">
            <MetricsPage />
          </div>
        )}
        {activeTab === 'costs' && (
          <div className="w-full overflow-auto">
            <CostsPage />
          </div>
        )}
        {activeTab === 'awaiting-merge' && (
          <div className="w-full overflow-auto">
            <AwaitingMergePage />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="p-6 w-full overflow-auto">
            <SettingsPage />
          </div>
        )}
        {activeTab === 'god-view' && (
          <BootstrapGate fallback={
            <div className="w-full h-full overflow-hidden">
              <GodViewSkeleton />
            </div>
          }>
            <div className="w-full h-full overflow-hidden">
              <GodViewPage />
            </div>
          </BootstrapGate>
        )}
        </main>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        request={currentConfirmation}
        isOpen={!!currentConfirmation}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
        onClose={handleCloseConfirmation}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectIssue={handleSelectIssueFromSearch}
        cycleFilter="current"
        includeCompletedFilter={false}
      />

      {/* Command Palette — Cmd+K / Ctrl+K */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onNavigate={(tab, issueId) => {
          setActiveTab(tab as Tab);
          if (issueId) setSelectedIssue(issueId);
        }}
      />

      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}
