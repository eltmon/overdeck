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
import { ChannelPermissionDialog } from './components/ChannelPermissionDialog';
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

import { StandaloneTerminal } from './components/StandaloneTerminal';
import { DeaconPauseBanner } from './components/DeaconPauseToggle';
import { NoResumeBanner } from './components/NoResumeBanner';
import { StoppedAgentsBanner } from './components/StoppedAgentsBanner';
import { CodexAuthBanner } from './components/CodexAuthBanner';
import { useCodexAutoRetry } from './hooks/useCodexAutoRetry';
import { SystemHealthPill } from './components/SystemHealthPill';
import { CostWarningStyles } from './components/shared/costWarning';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Agent, Issue } from './types';
import { useDashboardStore, selectAgentList, selectChannelPermissionRequests, selectIssues, selectDashboardLifecycle } from './lib/store';
import { refreshDashboardState } from './lib/refresh-dashboard-state';
import type { ClaudeChannelPermissionBehavior } from '@panctl/contracts';
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
  return PATH_TO_TAB[path] || 'command-deck';
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

// Cached supervisor URL — populated by successful /api/version polls.
// Used as a final fallback for Force Restart when the dashboard is dead.
let cachedSupervisorUrl: string | null = null;

async function fetchBackendHealth(): Promise<{ version: string }> {
  const res = await fetch('/api/version');
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  const data = await res.json();
  if (data.supervisorUrl) cachedSupervisorUrl = data.supervisorUrl;
  return data;
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

async function respondToChannelPermission(
  agentId: string,
  requestId: string,
  behavior: ClaudeChannelPermissionBehavior,
): Promise<void> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/permissions/${encodeURIComponent(requestId)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ behavior }),
  });
  if (res.ok) return;
  let message = `Failed to respond to permission request (${res.status})`;
  try {
    const body = await res.json() as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // Ignore invalid JSON bodies and fall back to the generic message.
  }
  throw new Error(message);
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
    const token = new URLSearchParams(window.location.search).get('token') ?? undefined;
    return (
      <div className="h-screen overflow-hidden bg-[#0d1117]">
        <EventRouter />
        <StandaloneTerminal sessionName={sessionName} token={token} />
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
  useCodexAutoRetry();
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

  useEffect(() => {
    if (!selectedIssue) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedIssue(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIssue]);

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
  // Banner state machine for the backend health indicator.
  //   'down'        — red banner, retrying, force-restart available
  //   'recovering'  — yellow banner, "back up", auto-hides after a short pause
  //   null          — hidden (steady state)
  // The "down" entry threshold is still 2 failed polls so a single hiccup
  // doesn't latch the banner. Recovery is one success — but rather than
  // snapping closed we transition to a yellow confirmation that fades on a
  // timer, so the user gets explicit feedback that things are back instead
  // of having the banner just disappear.
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bannerState, setBannerState] = useState<'down' | 'recovering' | null>(null);
  useEffect(() => {
    if (backendDown) {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      if (backendFailureCount >= 2) setBannerState('down');
    } else if (bannerState === 'down') {
      setBannerState('recovering');
      recoveryTimerRef.current = setTimeout(() => {
        setBannerState(null);
        recoveryTimerRef.current = null;
      }, 2500);
    }
  }, [backendDown, backendFailureCount, bannerState]);
  useEffect(() => () => {
    if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
  }, []);
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

  // Force Restart for the dashboard backend. Three-layer fallback chain:
  // 1. Electron bridge — most direct, available only in desktop app
  // 2. Dashboard's own endpoint — works when dashboard is wedged but responding
  // 3. Supervisor sidecar — works even when dashboard is fully dead; URL was
  //    cached from the last healthy /api/version poll.
  const restartBackendMutation = useMutation({
    mutationFn: async () => {
      const bridge = window.panopticonBridge;
      if (bridge?.restartDashboard) {
        await bridge.restartDashboard();
        return;
      }

      // Layer 2 — try dashboard endpoint (short timeout since it may hang if wedged)
      try {
        const res = await fetch('/api/system/restart-dashboard', {
          method: 'POST',
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) return;
      } catch {
        // Fall through to supervisor
      }

      // Layer 3 — supervisor sidecar, independent of dashboard process
      const supervisorUrl = cachedSupervisorUrl;
      if (!supervisorUrl) {
        throw new Error('Dashboard is unreachable and supervisor URL is unknown — try restarting from the CLI.');
      }
      const res = await fetch(`${supervisorUrl}/restart-dashboard`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Supervisor returned ${res.status}`);
    },
    onSuccess: () => {
      toast.success('Restart requested — reconnecting…');
    },
    onError: (err: Error) => {
      toast.error('Restart failed: ' + err.message);
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
  const channelPermissionRequests = useDashboardStore(selectChannelPermissionRequests);
  const [optimisticallyResolvedChannelPermissionRequestIds, setOptimisticallyResolvedChannelPermissionRequestIds] =
    useState<Set<string>>(new Set());

  // Issues from Zustand store (event-sourced via snapshot — no polling)
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];
  const visibleChannelPermissionRequests = channelPermissionRequests.filter(
    (request) => !optimisticallyResolvedChannelPermissionRequestIds.has(request.requestId)
  );
  const currentChannelPermissionRequest = visibleChannelPermissionRequests[0] ?? null;
  const currentChannelPermissionIssueId = currentChannelPermissionRequest?.issueId
    ?? agents.find((agent) => agent.id === currentChannelPermissionRequest?.agentId)?.issueId;

  useEffect(() => {
    setOptimisticallyResolvedChannelPermissionRequestIds((prev) => {
      const next = new Set<string>();
      const visibleRequestIds = new Set(channelPermissionRequests.map((request) => request.requestId));
      for (const requestId of prev) {
        if (visibleRequestIds.has(requestId)) {
          next.add(requestId);
        }
      }
      if (next.size === prev.size && Array.from(next).every((requestId) => prev.has(requestId))) {
        return prev;
      }
      return next;
    });
  }, [channelPermissionRequests]);

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
      (a) => a.role === 'plan' && a.hasPendingQuestion && a.status !== 'stopped'
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


  const channelPermissionResponseMutation = useMutation({
    mutationFn: ({
      agentId,
      requestId,
      behavior,
    }: {
      agentId: string;
      requestId: string;
      behavior: ClaudeChannelPermissionBehavior;
    }) => respondToChannelPermission(agentId, requestId, behavior),
    onMutate: async (variables) => {
      setOptimisticallyResolvedChannelPermissionRequestIds((prev) => {
        const next = new Set(prev);
        next.add(variables.requestId);
        return next;
      });
    },
    onSuccess: async (_data, variables) => {
      await refreshDashboardState(queryClient);
      toast.success(
        variables.behavior === 'allow'
          ? `Allowed ${variables.agentId} to continue`
          : `Denied permission request for ${variables.agentId}`,
      );
    },
    onError: (error: Error, variables) => {
      setOptimisticallyResolvedChannelPermissionRequestIds((prev) => {
        if (!prev.has(variables.requestId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(variables.requestId);
        return next;
      });
      toast.error(`Permission response failed: ${error.message}`);
    },
  });

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

  const handleAllowChannelPermission = useCallback(() => {
    if (!currentChannelPermissionRequest) return;
    channelPermissionResponseMutation.mutate({
      agentId: currentChannelPermissionRequest.agentId,
      requestId: currentChannelPermissionRequest.requestId,
      behavior: 'allow',
    });
  }, [channelPermissionResponseMutation, currentChannelPermissionRequest]);

  const handleDenyChannelPermission = useCallback(() => {
    if (!currentChannelPermissionRequest) return;
    channelPermissionResponseMutation.mutate({
      agentId: currentChannelPermissionRequest.agentId,
      requestId: currentChannelPermissionRequest.requestId,
      behavior: 'deny',
    });
  }, [channelPermissionResponseMutation, currentChannelPermissionRequest]);

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

      {/* Mounts @keyframes for the pulsing extreme-tier cost warning badge */}
      <CostWarningStyles />

      {/* Collapsible sidebar navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSearchOpen={() => setIsSearchOpen(true)}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <NoResumeBanner />

        {/* Deacon Frozen Banner — shown whenever the global patrol pause flag is set */}
        <DeaconPauseBanner />

        {/* Stopped Agents Banner — shown when agents are stopped (e.g., after reboot) */}
        <StoppedAgentsBanner />

        {/* Codex Auth Banner — shown when Codex OAuth tokens are expired/burned */}
        <CodexAuthBanner />

        {/* Dashboard Restart Banner — shown during a planned restart (post-merge deploy, pan restart) */}
        {showRestartBanner && (
          <div className="bg-primary/15 border-b-2 border-primary/40 px-4 py-3 flex items-center gap-3 shrink-0 overflow-hidden animate-slide-down-banner">
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
        {bannerState === 'down' && !showRestartBanner && (
          <div className="bg-destructive/15 border-b-2 border-destructive/50 px-4 py-3 flex items-center gap-3 shrink-0 overflow-hidden animate-slide-down-banner">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-destructive text-sm font-semibold flex-1">
              Backend is unreachable — waiting for it to come back.
            </p>
            <span className="text-destructive/60 text-xs shrink-0 animate-pulse">● Retrying…</span>
            <button
              onClick={() => restartBackendMutation.mutate()}
              disabled={restartBackendMutation.isPending}
              className="px-4 py-1.5 bg-destructive/20 hover:bg-destructive/30 text-destructive text-sm font-bold rounded-md border border-destructive/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {restartBackendMutation.isPending ? 'Restarting…' : 'Force Restart'}
            </button>
          </div>
        )}

        {/* Backend Recovered Banner — yellow confirmation, auto-hides */}
        {bannerState === 'recovering' && !showRestartBanner && (
          <div className="bg-warning/15 border-b-2 border-warning/50 px-4 py-3 flex items-center gap-3 shrink-0 overflow-hidden animate-slide-down-banner">
            <CheckCircle2 className="w-5 h-5 text-warning-foreground shrink-0" />
            <p className="text-warning-foreground text-sm font-semibold flex-1">
              Backend is back up.
            </p>
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

        <div className="relative border-b border-border bg-background px-3 py-1 shrink-0">
          <div className="flex items-center justify-end">
            <SystemHealthPill />
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
              <div className="flex-1 overflow-auto p-6 w-full">
                <MetricsSummaryRow />
                <KanbanBoard
                  selectedIssue={selectedIssue}
                  onSelectIssue={setSelectedIssue}
                  onPlanDialogChange={setPlanDialogIssueId}
                />
              </div>
              {selectedIssue && selectedIssueData && (
                <div
                  className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6"
                  onClick={() => setSelectedIssue(null)}
                >
                  <div
                    className="h-[min(90vh,1100px)] w-[min(92vw,1400px)] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DetailPanelLayout
                      agent={selectedIssueAgent ?? undefined}
                      issueId={selectedIssue}
                      issueUrl={selectedIssueData.url}
                      issue={selectedIssueData}
                      onClose={() => setSelectedIssue(null)}
                      suppressTerminal={planDialogIssueId === selectedIssue}
                      inline
                    />
                  </div>
                </div>
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

      <ChannelPermissionDialog
        request={currentChannelPermissionRequest}
        issueId={currentChannelPermissionIssueId}
        isOpen={!!currentChannelPermissionRequest}
        isSubmitting={channelPermissionResponseMutation.isPending}
        onAllow={handleAllowChannelPermission}
        onDeny={handleDenyChannelPermission}
      />

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
