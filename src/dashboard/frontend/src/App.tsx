import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { ConfirmationDialog, ConfirmationRequest } from './components/ConfirmationDialog';
import { EmergencyStopOverlay, triggerEmergencyStop, EMERGENCY_STOP_HOTKEY_LABEL } from './components/EmergencyStopOverlay';
import { ChannelPermissionDialog } from './components/ChannelPermissionDialog';
import { AskUserQuestionDialog, type AskUserQuestionSubject } from './components/AskUserQuestionDialog';
import { EventRouter } from './components/EventRouter';
import { SearchModal } from './components/search/SearchModal';
import { CommandPalette, type ConversationPaletteOpenRequest } from './components/CommandPalette';
import { NO_PROJECT_KEY } from './components/CommandDeck/projectsData';
import { IssueDrawer } from './components/drawer/IssueDrawer';
import { SessionFeedSidebar } from './components/sessionFeed/SessionFeedSidebar';
import { NewProjectModal, type CreatedProject } from './components/CommandDeck/NewProjectModal';
import { Tab } from './components/Header';
import { Sidebar } from './components/Sidebar';

import { DeaconPauseToggle } from './components/DeaconPauseToggle';
import { NoResumeBanner } from './components/NoResumeBanner';
import { LowCostModePill } from './components/LowCostModePill';
import { SystemMenu } from './components/SystemMenu';
import { StoppedAgentsBanner } from './components/StoppedAgentsBanner';
import { OrphanTestAgentsSurface } from './components/OrphanTestAgentsSurface';
import { CodexAuthBanner } from './components/CodexAuthBanner';
import { useCodexAutoRetry } from './hooks/useCodexAutoRetry';
import { SystemHealthPill } from './components/SystemHealthPill';
import { CostWarningStyles } from './components/shared/costWarning';
import { AlertTriangle, CheckCircle2, History, RefreshCw, Search, StopCircle } from 'lucide-react';
import { Agent, Issue } from './types';
import { useDashboardStore, selectAgents, selectAgentsWithPendingAskUserQuestion, selectChannelPermissionRequests, selectIssues, selectDashboardLifecycle } from './lib/store';
import { useAskUserQuestionUiStore } from './lib/askUserQuestionUiStore';
import { usePanesStore } from './lib/panesStore';
import { refreshDashboardState } from './lib/refresh-dashboard-state';
import { fetchWithTimeout } from './lib/apiFetch';
import { fetchExperimentalFeaturesEnabled, isExperimentalTab } from './lib/experimentalFeatures';
import type { ClaudeChannelPermissionBehavior } from '@overdeck/contracts';
import type { ViewMode as ConversationViewMode } from './components/chat/ConversationPanel';
import {
  describeConversationHitOpenFailure,
  fetchBackendHealth,
  fetchCliproxyStatus,
  fetchConfirmations,
  fetchConversationMessageLocator,
  fetchTrackerStatus,
  getCachedSupervisorUrl,
  respondToChannelPermission,
  respondToConfirmation,
  restartCliproxy,
} from './App/api';
import {
  buildConversationUrl,
  getCockpitRouteFromPath,
  getCommandDeckProjectRouteFromPath,
  getConversationRouteState,
  normalizeCurrentRoute,
  TAB_PATHS,
  type ConversationViewModeMap,
} from './App/routes';
import {
  StandaloneConversationPopoutRoute,
  StandaloneDiffPopoutRoute,
  StandaloneFlywheelPopoutRoute,
  StandaloneTerminalRoute,
} from './App/StandaloneRoutes';
import { AppRoutes, type PendingConversationTarget } from './App/AppRoutes';

export {
  buildConversationUrl,
  getCockpitRouteFromPath,
  getCommandDeckProjectRouteFromPath,
  getConversationRouteState,
  getConversationViewModeFromSearch,
  getConvIdFromPath,
  normalizeLegacyAwaitingMergeRoute,
  parseConversationViewModes,
  serializeConversationViewModes,
} from './App/routes';
export type { ConversationViewModeMap } from './App/routes';

export const SESSION_FEED_SIDEBAR_OPEN_STORAGE_KEY = 'overdeck.ui.sessionFeedSidebarOpen';

function readSessionFeedSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  const value = window.localStorage.getItem(SESSION_FEED_SIDEBAR_OPEN_STORAGE_KEY);
  return value === null ? true : value === 'true';
}

export default function App() {
  useEffect(() => {
    normalizeCurrentRoute();
  }, []);
  const terminalPath = window.location.pathname;
  const terminalSession = new URLSearchParams(window.location.search).get('terminal');
  if (terminalPath.startsWith('/terminal/') || terminalSession) {
    const sessionName = terminalPath.startsWith('/terminal/')
      ? terminalPath.replace('/terminal/', '')
      : terminalSession!;
    const token = new URLSearchParams(window.location.search).get('token') ?? undefined;
    return <StandaloneTerminalRoute sessionName={sessionName} token={token} />;
  }

  if (terminalPath === '/popout/flywheel-conversation') {
    return <StandaloneFlywheelPopoutRoute />;
  }

  // /popout/conversation/<id> — bare conversation window, no dashboard chrome.
  // Match before the existing /popout/diff route so its path-prefix never swallows
  // a numeric segment.
  const conversationPopoutMatch = terminalPath.match(/^\/popout\/conversation\/([^/]+)$/);
  if (conversationPopoutMatch) {
    return <StandaloneConversationPopoutRoute conversationId={conversationPopoutMatch[1]!} />;
  }

  if (terminalPath === '/popout/diff') {
    return <StandaloneDiffPopoutRoute />;
  }

  const [activeTab, setActiveTabState] = useState<Tab>(() => getConversationRouteState().tab);
  const [, setSelectedAgentState] = useState<string | null>(() => {
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
  const initialCockpitRoute = getCockpitRouteFromPath();
  const initialProjectRoute = getCommandDeckProjectRouteFromPath();
  const [selectedConvId, setSelectedConvIdState] = useState<string | null>(() => initialConversationRoute.convId);
  // PAN-1561: the project whose deck is shown in the Command Deck, driven by the
  // sidebar's Projects rail.
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(
    () => initialCockpitRoute?.project ?? initialProjectRoute,
  );
  const [conversationViewMode, setConversationViewModeState] = useState<ConversationViewMode>(
    () => initialConversationRoute.viewMode,
  );
  const [conversationViewModes, setConversationViewModes] = useState<ConversationViewModeMap>(
    () => initialConversationRoute.viewModes,
  );
  // Cockpit deep-link (PAN-2005): the issue cockpit tab restored from
  // /command-deck/<project>/<issue>. Mirrors the conversation deep-link pattern.
  const [cockpitRoute, setCockpitRouteState] = useState<{ project: string; issue: string } | null>(
    () => initialCockpitRoute,
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
  const recentActivity = useDashboardStore((state) => (state.recentActivity ?? []) as Array<Record<string, unknown>>);

  // PAN-1970: New Project modal
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const handleNewProject = useCallback(() => setIsNewProjectModalOpen(true), []);
  const handleProjectCreated = useCallback((project: CreatedProject) => {
    void queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
    void queryClient.invalidateQueries({ queryKey: ['registered-projects'] });
    setSelectedProjectKey(project.key);
    setActiveTabState('command-deck');
    const path = `/command-deck/${encodeURIComponent(project.key)}`;
    if (window.location.pathname !== path) {
      window.history.pushState({ tab: 'command-deck', project: project.key }, '', path);
    }
    usePanesStore.getState().ensureHome(project.key);
  }, [queryClient]);
  const seenWorkspaceActivityIds = useRef(new Set<string>());

  useEffect(() => {
    for (const entry of recentActivity.slice(0, 10)) {
      const id = typeof entry['id'] === 'string' ? entry['id'] : null;
      const issueId = typeof entry['issueId'] === 'string' ? entry['issueId'] : null;
      const message = typeof entry['message'] === 'string' ? entry['message'] : '';
      if (!id || !issueId || seenWorkspaceActivityIds.current.has(id)) continue;
      if (!/^Rebuild stack for\b/.test(message)) continue;
      seenWorkspaceActivityIds.current.add(id);
      void queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
    }
  }, [queryClient, recentActivity]);

  const [_planDialogIssueId, setPlanDialogIssueId] = useState<string | null>(null);
  const [currentConfirmation, setCurrentConfirmation] = useState<ConfirmationRequest | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // Issue prefix of the deck's selected project, reported by CommandDeck — scopes
  // the app-bar search to that project (PAN-1593).
  const [searchProjectPrefix, setSearchProjectPrefix] = useState<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [pendingConversationTarget, setPendingConversationTarget] = useState<PendingConversationTarget | null>(null);
  const [isSessionFeedSidebarOpen, setIsSessionFeedSidebarOpen] = useState(readSessionFeedSidebarOpen);
  const [trackerBannerDismissed, setTrackerBannerDismissed] = useState(false);

  const drawerIssueId = useDashboardStore((state) => state.drawer.issueId);
  const drawerOpen = drawerIssueId !== null;
  const openIssue = useDashboardStore((state) => state.openIssue);
  const syncDrawerFromUrl = useDashboardStore((state) => state.syncDrawerFromUrl);

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
  // `data` is undefined while the settings query is loading (or errored) and
  // a boolean once it settles — fetchExperimentalFeaturesEnabled always returns
  // true/false. We must NOT default to false: doing so makes the redirect
  // effect below bounce a deep-link to an experimental route (e.g. /agents) to
  // /home during the loading window, before the settings resolve — so a reload
  // with experimental features ON would always lose the route.
  const { data: experimentalFeaturesEnabled } = useQuery({
    queryKey: ['settings', 'experimental-features'],
    queryFn: fetchExperimentalFeaturesEnabled,
    staleTime: 30_000,
  });
  const experimentalFeaturesKnown = experimentalFeaturesEnabled === true || experimentalFeaturesEnabled === false;

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
      const bridge = window.overdeckBridge;
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
      const supervisorUrl = getCachedSupervisorUrl();
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

  // URL-synced tab navigation. Only bounce experimental tabs once the settings
  // query has actually resolved to "off"; during loading we honor the requested
  // tab and let the effect below reconcile once the value is known.
  const setActiveTab = useCallback((tab: Tab) => {
    const denyExperimental = experimentalFeaturesKnown && !experimentalFeaturesEnabled;
    const nextTab = denyExperimental && isExperimentalTab(tab) ? 'home' : tab;
    setActiveTabState(nextTab);
    const path = TAB_PATHS[nextTab];
    if (window.location.pathname !== path) {
      window.history.pushState({ tab: nextTab }, '', path);
    }
  }, [experimentalFeaturesEnabled, experimentalFeaturesKnown]);

  useEffect(() => {
    if (!experimentalFeaturesKnown) return;
    if (!experimentalFeaturesEnabled && isExperimentalTab(activeTab)) {
      setActiveTab('home');
    }
  }, [activeTab, experimentalFeaturesEnabled, experimentalFeaturesKnown, setActiveTab]);

  // Sync the URL to the active issue cockpit (PAN-2005). replaceState (like the
  // conversation route) keeps history clean; reload/bookmark restores the tab.
  // issueId=null reverts to the project home when a project is active.
  const onCockpitChange = useCallback((projectKey: string | null, issueId: string | null) => {
    if (projectKey && issueId) {
      const path = `/command-deck/${encodeURIComponent(projectKey)}/${encodeURIComponent(issueId)}`;
      if (window.location.pathname !== path) window.history.replaceState({ tab: 'command-deck' }, '', path);
    } else if (projectKey) {
      const path = `/command-deck/${encodeURIComponent(projectKey)}`;
      if (window.location.pathname !== path) window.history.replaceState({ tab: 'command-deck', project: projectKey }, '', path);
    } else if (window.location.pathname.startsWith('/command-deck/')) {
      window.history.replaceState({ tab: 'command-deck' }, '', '/command-deck');
    }
  }, []);

  const handleOpenConversationHit = useCallback(async (hit: ConversationPaletteOpenRequest) => {
    const conversationName = hit.conversationId || hit.sessionId;
    // hit.projectKey is the resolved dashboard project key (name ?? key); the raw
    // hit.projectId is the encoded ~/.claude/projects dir name and is NOT a deck
    // key, so routing on it lands on a phantom project. Fall back to the No-project
    // bucket when the conversation is under no registered project.
    const projectKey = hit.projectKey || NO_PROJECT_KEY;
    try {
      const locator = await fetchConversationMessageLocator(conversationName, hit.byteOffset);
      const nonce = Date.now();
      setPendingConversationTarget({
        conversationName,
        messageId: locator.messageId,
        messageIndex: locator.messageIndex,
        nonce,
        label: hit.label || 'Agent',
      });
      setActiveTab('command-deck');
      setSelectedProjectKey(projectKey);
      setConversationRoute(conversationName, 'conversation');
      const panes = usePanesStore.getState();
      panes.ensureHome(projectKey);
      const paneId = panes.addPane(projectKey, {
        paneType: 'agent',
        label: hit.label || 'Agent',
        conversationId: conversationName,
        viewMode: 'conversation',
      });
      usePanesStore.getState().updatePane(projectKey, paneId, {
        viewMode: 'conversation',
        targetMessageId: locator.messageId,
        targetMessageIndex: locator.messageIndex,
        targetMessageNonce: nonce,
      });
    } catch (err) {
      toast.error(describeConversationHitOpenFailure(hit, err));
    }
  }, [setActiveTab, setConversationRoute]);

  const setSessionFeedSidebarOpen = useCallback((open: boolean) => {
    setIsSessionFeedSidebarOpen(open);
    window.localStorage.setItem(SESSION_FEED_SIDEBAR_OPEN_STORAGE_KEY, String(open));
  }, []);

  // PAN-1561: open a project's deck from the sidebar rail. Land on the project's
  // HOME pane (the S4 cockpit) rather than whatever tab the deck last had active
  // — the panes store remembers per-workspace, so it would otherwise restore a
  // stale conversation and the click would appear to "do nothing". A conversation
  // deep-link overrides this immediately afterward (openConversationTabIn runs
  // after onSelectProject), so deep-links still land on their conversation.
  const handleSelectProject = useCallback((projectName: string | null, opts?: { updateUrl?: boolean }) => {
    setSelectedProjectKey(projectName);
    setActiveTabState('command-deck');
    // When a conversation is being opened, the conversation route (/conv/<id>) owns
    // the URL — switching the deck's project must NOT clobber it with /command-deck/<project>.
    // Callers opening a conversation pass { updateUrl: false }; plain project-rail
    // selection leaves it default (true).
    if (opts?.updateUrl !== false) {
      const path = projectName ? `/command-deck/${encodeURIComponent(projectName)}` : '/command-deck';
      if (window.location.pathname !== path) {
        window.history.pushState({ tab: 'command-deck', project: projectName }, '', path);
      }
    }
    if (projectName) {
      // ensureHome hydrates/creates the workspace and replaces the store object,
      // so re-read getState() afterward — the pre-ensureHome snapshot can be
      // empty on a project's first access (its panes aren't hydrated yet).
      usePanesStore.getState().ensureHome(projectName);
      const fresh = usePanesStore.getState();
      const home = (fresh.panesByWorkspace[projectName] ?? []).find((p) => p.paneType === 'home');
      if (home) fresh.setActivePane(projectName, home.paneId);
    }
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      normalizeCurrentRoute();
      const routeState = getConversationRouteState();
      setActiveTabState(routeState.tab);
      setSelectedConvIdState(routeState.convId);
      setConversationViewModeState(routeState.viewMode);
      setConversationViewModes(routeState.viewModes);
      const cockpitRoute = getCockpitRouteFromPath();
      setCockpitRouteState(cockpitRoute);
      const routeProject = cockpitRoute?.project ?? getCommandDeckProjectRouteFromPath();
      if (routeProject) {
        setSelectedProjectKey(routeProject);
      } else if (window.location.pathname === '/command-deck') {
        setSelectedProjectKey(null);
      }
      syncDrawerFromUrl();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [syncDrawerFromUrl]);

  // Agents from Zustand store (event-sourced — no polling)
  // Cast to Agent[] since AgentSnapshot is a compatible subset for the fields used here
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  // Live agent count for the app-bar status pill (PAN-1591).
  const runningAgentCount = useMemo(
    () => agents.filter((a) => ['running', 'active', 'starting', 'thinking', 'working'].includes(a.status)).length,
    [agents],
  );
  const channelPermissionRequests = useDashboardStore(selectChannelPermissionRequests);
  const agentsWithAskUserQuestion = useDashboardStore(selectAgentsWithPendingAskUserQuestion);
  const [optimisticallyResolvedChannelPermissionRequestIds, setOptimisticallyResolvedChannelPermissionRequestIds] =
    useState<Set<string>>(new Set());
  // PAN-1520 / PAN-1563 — AUQs the operator already answered (so the dialog hides
  // immediately, before the next enrichment poll clears the field) and subjects
  // dismissed without answering. These live in the shared askUserQuestionUiStore
  // so the "Needs you" sidebar honors them too — otherwise an answered card
  // lingered there after the dialog closed.
  const optimisticallyAnsweredAskUserQuestionIds = useAskUserQuestionUiStore((s) => s.answeredToolUseIds);
  const dismissedAskUserQuestionAgentIds = useAskUserQuestionUiStore((s) => s.dismissedSubjectIds);
  const markAskUserQuestionAnswered = useAskUserQuestionUiStore((s) => s.markAnswered);
  const unmarkAskUserQuestionAnswered = useAskUserQuestionUiStore((s) => s.unmarkAnswered);
  const markAskUserQuestionDismissed = useAskUserQuestionUiStore((s) => s.markDismissed);
  const undismissAskUserQuestion = useAskUserQuestionUiStore((s) => s.undismiss);
  const reconcileAnsweredAskUserQuestions = useAskUserQuestionUiStore((s) => s.reconcileAnswered);
  const reconcileDismissedAskUserQuestions = useAskUserQuestionUiStore((s) => s.reconcileDismissed);

  // PAN-1395 — a subject the operator explicitly asked to re-open from the
  // Activity Feed / Project Activity "Needs you" list. Prioritised over the
  // default oldest-first selection (so clicking a specific question shows THAT
  // one) and un-dismissed (so an ESC-dismissed question becomes reachable again).
  const [focusedAskUserQuestionId, setFocusedAskUserQuestionId] = useState<string | null>(null);
  const askUserQuestionReopenId = useAskUserQuestionUiStore((s) => s.reopenId);
  const askUserQuestionReopenNonce = useAskUserQuestionUiStore((s) => s.reopenNonce);
  const requestAskUserQuestionReopen = useAskUserQuestionUiStore((s) => s.requestReopen);
  useEffect(() => {
    if (!askUserQuestionReopenId) return;
    // Bug 3 (TIN-1): a notification's Open/Answer can be clicked AFTER the asking
    // session stopped and its pending AUQ cleared (e.g. planning auto-completed).
    // Un-dismiss + focus so the dialog reopens if the question is still live; if
    // it's already resolved, tell the operator instead of silently no-opping.
    const agentEntry = useDashboardStore.getState().agentsById[askUserQuestionReopenId];
    // Only an agent subject (present in agentsById) can be confidently judged
    // resolved here; conversation subjects are tracked via a separate poll, so
    // never claim those are "no longer waiting".
    const knownAgent = agentEntry != null;
    const stillPending = agentEntry?.pendingAskUserQuestion != null;
    undismissAskUserQuestion(askUserQuestionReopenId);
    setFocusedAskUserQuestionId(askUserQuestionReopenId);
    if (knownAgent && !stillPending) {
      toast.info('That question is no longer waiting', {
        description: 'The agent stopped or already received an answer.',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askUserQuestionReopenNonce]);

  // Issues from Zustand store (event-sourced via snapshot — no polling)
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];
  const visibleChannelPermissionRequests = channelPermissionRequests.filter(
    (request) => !optimisticallyResolvedChannelPermissionRequestIds.has(request.requestId)
  );
  const currentChannelPermissionRequest = visibleChannelPermissionRequests[0] ?? null;
  const currentChannelPermissionIssueId = currentChannelPermissionRequest?.issueId
    ?? agents.find((agent) => agent.id === currentChannelPermissionRequest?.agentId)?.issueId;

  // PAN-1520 — poll conversations for pending AskUserQuestion. PAN-1705:
  // uses the dedicated pending-input feed (scans only tmux-alive sessions,
  // returns only rows that need attention) instead of pulling the full
  // 0.5 MB enriched list every 4s.
  type ConvAskUserQuestionRow = {
    name: string;
    title?: string | null;
    issueId?: string | null;
    pendingAskUserQuestion?: AskUserQuestionSubject['pendingAskUserQuestion'];
  };
  const { data: convAskUserQuestionRows = [] } = useQuery({
    queryKey: ['conv-ask-user-question'],
    queryFn: async ({ signal }): Promise<ConvAskUserQuestionRow[]> => {
      const res = await fetchWithTimeout('/api/conversations/pending-input', { signal });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });

  // PAN-1520 — surface the oldest unresolved AskUserQuestion from either an
  // agent or a conversation. Filter out:
  //   - questions the operator just optimistically answered (by toolUseId)
  //   - subjects the operator dismissed without answering
  const askUserQuestionSubjects: Array<AskUserQuestionSubject & { kind: 'agent' | 'conv'; askedAt: string }> = [
    ...agentsWithAskUserQuestion.map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      issueId: a.issueId ?? null,
      kindLabel: 'Agent',
      // PAN-1520 — prefer the issue title over the raw agent id (e.g.
      // "planning-pan-1395") so the dialog/toast read like a human label.
      title: a.issueId ? (issues.find((i) => i.id === a.issueId)?.title ?? null) : null,
      pendingAskUserQuestion: a.pendingAskUserQuestion,
      askedAt: a.pendingAskUserQuestion?.askedAt ?? '',
    })),
    ...convAskUserQuestionRows.map((c) => ({
      kind: 'conv' as const,
      id: c.name,
      issueId: c.issueId ?? null,
      kindLabel: 'Conversation',
      title: c.title ?? null,
      pendingAskUserQuestion: c.pendingAskUserQuestion,
      askedAt: c.pendingAskUserQuestion?.askedAt ?? '',
    })),
  ];
  askUserQuestionSubjects.sort((a, b) => (a.askedAt === b.askedAt ? a.id.localeCompare(b.id) : a.askedAt.localeCompare(b.askedAt)));
  const visibleAskUserQuestionSubjects = askUserQuestionSubjects.filter((s) => {
    const toolUseId = s.pendingAskUserQuestion?.toolUseId;
    if (!toolUseId) return false;
    if (optimisticallyAnsweredAskUserQuestionIds.has(toolUseId)) return false;
    if (dismissedAskUserQuestionAgentIds.has(s.id)) return false;
    return true;
  });
  const currentAskUserQuestionSubject =
    (focusedAskUserQuestionId
      ? visibleAskUserQuestionSubjects.find((s) => s.id === focusedAskUserQuestionId)
      : undefined) ??
    visibleAskUserQuestionSubjects[0] ??
    null;

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

  // PAN-1520 — desktop-notification permission grant on first interaction.
  // Browsers require user gesture for `Notification.requestPermission()` in
  // many configurations; we attempt once and silently degrade to toast-only.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      // Don't auto-prompt — wait for the first user gesture. We piggyback on
      // the existing pointerdown handler so this never fires on hostile pages.
      const ask = (): void => {
        Notification.requestPermission().catch(() => { /* ignore */ });
        window.removeEventListener('pointerdown', ask);
      };
      window.addEventListener('pointerdown', ask, { once: true });
      return (): void => { window.removeEventListener('pointerdown', ask); };
    }
    return undefined;
  }, []);

  // PAN-1520 — fire a desktop notification (+ in-app toast) when a subject
  // (agent OR conversation) transitions into a "needs operator input" state.
  // We track unique (subjectId, toolUseId) tuples in a ref so a single AUQ
  // only fires once.
  const notifiedPendingInputRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // #1102 — clicking the toast or desktop notification re-opens the dialog
    // for that subject (focus + un-dismiss), not just focuses the window.
    const announce = (id: string, subjectId: string, title: string, body: string): void => {
      const key = id;
      if (notifiedPendingInputRef.current.has(key)) return;
      notifiedPendingInputRef.current.add(key);
      const reopen = (): void => requestAskUserQuestionReopen(subjectId);
      toast.info(title, {
        description: body,
        duration: 12000,
        action: { label: 'Answer', onClick: reopen },
      });
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body, tag: key });
          n.onclick = (): void => { window.focus(); reopen(); n.close(); };
        } catch { /* ignore */ }
      }
    };

    for (const a of agentsWithAskUserQuestion) {
      const toolUseId = a.pendingAskUserQuestion?.toolUseId;
      if (!toolUseId) continue;
      const body = a.pendingAskUserQuestion?.questions?.[0]?.question ?? 'AskUserQuestion is open.';
      const label = (a.issueId ? issues.find((i) => i.id === a.issueId)?.title : undefined) ?? a.issueId ?? a.id;
      announce(`agent::${a.id}::${toolUseId}`, a.id, `${label} is waiting on you`, body);
    }
    for (const c of convAskUserQuestionRows) {
      const toolUseId = c.pendingAskUserQuestion?.toolUseId;
      if (!toolUseId) continue;
      const body = c.pendingAskUserQuestion?.questions?.[0]?.question ?? 'AskUserQuestion is open.';
      const label = c.title ?? c.name;
      announce(`conv::${c.name}::${toolUseId}`, c.name, `"${label}" is waiting on you`, body);
    }

    // Garbage-collect notification keys for AUQs that have cleared.
    const liveKeys = new Set<string>();
    for (const a of agentsWithAskUserQuestion) {
      const id = a.pendingAskUserQuestion?.toolUseId;
      if (id) liveKeys.add(`agent::${a.id}::${id}`);
    }
    for (const c of convAskUserQuestionRows) {
      const id = c.pendingAskUserQuestion?.toolUseId;
      if (id) liveKeys.add(`conv::${c.name}::${id}`);
    }
    for (const k of notifiedPendingInputRef.current) {
      if (!liveKeys.has(k)) notifiedPendingInputRef.current.delete(k);
    }
  }, [agentsWithAskUserQuestion, convAskUserQuestionRows]);

  // (PAN-1520) The former planning-specific "needs input" toast was removed —
  // the unified pending-input notifier above already covers planning agents
  // (with the issue title and an Answer action), so it was double-firing with
  // stale "open the Plan dialog" guidance.

  // PAN-1520 — answer an AskUserQuestion. Routes to the right endpoint based
  // on subject kind: agents go through /api/agents/:id/answer-question
  // (formats a "Q/A" message and delivers via deliverAgentMessage); conv
  // sessions use the regular POST /api/conversations/:name/message channel.
  const askUserQuestionAnswerMutation = useMutation({
    mutationFn: async ({ kind, id, answers, questions }: {
      kind: 'agent' | 'conv';
      id: string;
      /** Friendly display label (issue/conversation title) for the toast. */
      label?: string;
      answers: string[];
      questions: AskUserQuestionSubject['pendingAskUserQuestion'] extends infer T
        ? T extends { questions: infer Q } ? Q : never : never;
    }) => {
      if (kind === 'agent') {
        const res = await fetch(`/api/agents/${encodeURIComponent(id)}/answer-question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
        if (!res.ok) {
          let message = `Failed to deliver answer (${res.status})`;
          try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
          throw new Error(message);
        }
        return res.json();
      }
      // conv: compose the Q/A message ourselves and post via the regular
      // message channel — that's the path conversation input already uses.
      const lines: string[] = [];
      const qArr = (questions ?? []) as ReadonlyArray<{ question: string }>;
      for (let i = 0; i < answers.length && i < qArr.length; i++) {
        const q = qArr[i]?.question ?? `Question ${i + 1}`;
        lines.push(`Q: ${q}\nA: ${answers[i]}`);
      }
      const composed = `Operator answered the pending question${answers.length > 1 ? 's' : ''}:\n\n${lines.join('\n\n')}`;
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: composed }),
      });
      if (!res.ok) {
        let message = `Failed to deliver answer (${res.status})`;
        try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
        throw new Error(message);
      }
      return res.json();
    },
    onMutate: (variables) => {
      const toolUseId = currentAskUserQuestionSubject?.pendingAskUserQuestion?.toolUseId;
      if (toolUseId) {
        markAskUserQuestionAnswered(toolUseId);
      }
      return { subjectId: variables.id, toolUseId };
    },
    onSuccess: (_data, variables) => {
      toast.success(`Answer delivered to ${variables.label?.trim() || variables.id}`);
    },
    onError: (error: Error, _variables, context) => {
      if (context?.toolUseId) {
        unmarkAskUserQuestionAnswered(context.toolUseId);
      }
      toast.error(`Failed to deliver answer: ${error.message}`);
    },
  });

  // PAN-1690 — answer a Codex TUI approval menu. The selected option's label
  // is prefixed with its number ("1. Yes, proceed"); we send that number to the
  // codex-approval endpoint, which drives the menu via Down×(n-1) + Enter.
  const codexApprovalMutation = useMutation({
    mutationFn: async ({ id, optionNumber }: {
      id: string;
      optionNumber: number;
      label?: string;
      toolUseId?: string;
    }) => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/codex-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionNumber }),
      });
      if (!res.ok) {
        let message = `Failed to send approval (${res.status})`;
        try { const body = await res.json() as { error?: string }; if (body?.error) message = body.error; } catch { /* ignore */ }
        throw new Error(message);
      }
      return res.json();
    },
    onMutate: ({ toolUseId }) => {
      if (toolUseId) markAskUserQuestionAnswered(toolUseId);
      return { toolUseId };
    },
    onSuccess: (_data, variables) => {
      toast.success(`Approval sent to ${variables.label?.trim() || variables.id}`);
    },
    onError: (error: Error, _variables, context) => {
      if (context?.toolUseId) unmarkAskUserQuestionAnswered(context.toolUseId);
      toast.error(`Failed to send approval: ${error.message}`);
    },
  });

  const handleSubmitAskUserQuestion = useCallback((answers: string[]) => {
    if (!currentAskUserQuestionSubject) return;
    const subject = currentAskUserQuestionSubject;
    const toolUseId = subject.pendingAskUserQuestion?.toolUseId;
    // PAN-1690 — Codex approval: route the numbered choice to the keystroke
    // endpoint instead of delivering prose into the pane.
    if (toolUseId?.startsWith('codex-approval:')) {
      const match = /^\s*(\d+)/.exec(answers[0] ?? '');
      const optionNumber = match ? Number(match[1]) : NaN;
      if (!Number.isInteger(optionNumber)) {
        toast.error('Could not determine which option was selected');
        return;
      }
      codexApprovalMutation.mutate({
        id: subject.id,
        optionNumber,
        label: subject.title?.trim() || subject.id,
        toolUseId,
      });
      return;
    }
    askUserQuestionAnswerMutation.mutate({
      kind: (subject as AskUserQuestionSubject & { kind?: 'agent' | 'conv' }).kind ?? 'agent',
      id: subject.id,
      label: subject.title?.trim() || subject.id,
      answers,
      questions: subject.pendingAskUserQuestion?.questions as never,
    });
  }, [askUserQuestionAnswerMutation, codexApprovalMutation, currentAskUserQuestionSubject]);

  const handleDismissAskUserQuestion = useCallback(() => {
    if (!currentAskUserQuestionSubject) return;
    markAskUserQuestionDismissed(currentAskUserQuestionSubject.id);
  }, [currentAskUserQuestionSubject, markAskUserQuestionDismissed]);

  // PAN-1520 — purge optimistic state for AUQs that have actually cleared
  // server-side, and re-allow dismissed subjects whose tool-use id has
  // changed. Cleans up across both agent and conv sources.
  useEffect(() => {
    const liveAgentToolUseIds = agentsWithAskUserQuestion
      .map((a) => a.pendingAskUserQuestion?.toolUseId)
      .filter((id): id is string => typeof id === 'string');
    const liveConvToolUseIds = convAskUserQuestionRows
      .map((c) => c.pendingAskUserQuestion?.toolUseId)
      .filter((id): id is string => typeof id === 'string');
    const liveToolUseIds = new Set<string>([...liveAgentToolUseIds, ...liveConvToolUseIds]);
    reconcileAnsweredAskUserQuestions(liveToolUseIds);
    const liveSubjectIds = new Set<string>([
      ...agentsWithAskUserQuestion.map((a) => a.id),
      ...convAskUserQuestionRows.map((c) => c.name),
    ]);
    reconcileDismissedAskUserQuestions(liveSubjectIds);
    // PAN-1395 — drop the focus once its subject is no longer pending.
    setFocusedAskUserQuestionId((prev) => (prev && liveSubjectIds.has(prev) ? prev : null));
  }, [agentsWithAskUserQuestion, convAskUserQuestionRows, reconcileAnsweredAskUserQuestions, reconcileDismissedAskUserQuestions]);

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
    const bridge = window.overdeckBridge;
    if (!bridge) return;
    const unsub = bridge.onMenuAction((action: string) => {
      if (action === 'open-settings') {
        setActiveTab('settings');
      } else if (action.startsWith('open-workspace:')) {
        const issueId = action.slice('open-workspace:'.length);
        setActiveTab('kanban');
        if (issueId) openIssue(issueId);
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
  }, [openIssue, setActiveTab]);

  // Auto-start nag toast for desktop app (launched 2-5 times without enabling)
  function showAutoStartNag(count: number, max: number): void {
    const messages = [
      "Auto-start means never missing an agent asking for help.",
      "Your agents could be waiting for you right now.",
      "Overdeck works best when it's always watching.",
      "One click enables auto-start. You can disable it anytime.",
    ];
    const msg = messages[(count - 2) % messages.length] ?? messages[0];
    toast(`Reminder ${count} of ${max} — ${msg}`, {
      duration: 8_000,
      action: {
        label: 'Enable',
        onClick: () => {
          void window.overdeckBridge?.updateDesktopSetting('autoStart.enabled', true);
        },
      },
    });
  }

  const handleSelectIssueFromSearch = useCallback((issueId: string) => {
    setActiveTab('kanban');
    openIssue(issueId);
  }, [openIssue, setActiveTab]);

  // Registered projects (deck keys) — shared cache with CommandDeck. Used to map an
  // issue's tracker repo (e.g. "eltmon/panopticon-cli") to the dashboard deck key
  // (e.g. "panopticon-cli") so the cockpit opens in the deck whose conversations/tree
  // actually match (PAN-2005).
  const { data: registeredProjects = [] } = useQuery<Array<{ key: string; name: string; path: string }>>({
    queryKey: ['registered-projects'],
    queryFn: async () => {
      const r = await fetch('/api/registered-projects');
      if (!r.ok) throw new Error('Failed to fetch registered projects');
      return r.json();
    },
    staleTime: 60_000,
  });
  const resolveDeckKey = useCallback((issueId: string): string | null => {
    const issue = issues.find((i) => i.identifier === issueId);
    const repo = issue?.sourceRepo || issue?.project?.name || '';
    const repoName = repo.includes('/') ? repo.split('/').pop()! : repo;
    const rp = registeredProjects.find(
      (p) => p.key === repoName || p.name === repoName || p.key === repo || p.name === repo,
    );
    return rp ? (rp.name ?? rp.key) : (selectedProjectKey ?? null);
  }, [issues, registeredProjects, selectedProjectKey]);

  // PAN-2005: three ways to open an issue from the backlog detail drawer.
  //   browser → the tracker (GitHub) issue page in a new tab
  //   modal   → the right-side issue overlay (IssueDrawer; already URL-synced via ?issue=)
  //   panel   → the full cockpit tab in the project's deck (deep-linked /command-deck/<proj>/<issue>)
  const handleBacklogIssueAction = useCallback((issueId: string, mode: 'browser' | 'modal' | 'panel') => {
    const issue = issues.find((i) => i.identifier === issueId);
    if (mode === 'browser') {
      // Prefer the tracker's canonical URL; fall back to deriving from the
      // project's owner/repo (project.name is "owner/repo" for GitHub projects).
      const num = issueId.replace(/^[A-Za-z]+-/, '');
      const repo = issue?.project?.name;
      const url = issue?.url
        || (repo && repo.includes('/') ? `https://github.com/${repo}/issues/${num}` : null);
      if (!url) { openIssue(issueId); return; }
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (mode === 'modal') {
      openIssue(issueId);
      return;
    }
    // panel: resolve the issue's dashboard deck key (NOT the tracker repo) so the
    // cockpit opens in the deck whose conversations/tree match; fall back to the
    // overlay if we can't resolve a project key.
    const projectKey = resolveDeckKey(issueId);
    if (!projectKey) {
      openIssue(issueId);
      return;
    }
    setActiveTab('command-deck');
    setCockpitRouteState({ project: projectKey, issue: issueId });
    onCockpitChange(projectKey, issueId);
  }, [issues, openIssue, resolveDeckKey, setActiveTab, onCockpitChange]);

  const handleOpenWorkspaceHome = useCallback((issueId: string) => {
    setActiveTab('kanban');
    openIssue(issueId);
  }, [openIssue, setActiveTab]);

  return (
    <div className="h-screen flex flex-row overflow-hidden bg-background">
      {/* Event-sourced state: connects WsTransport → DashboardStore (PAN-428 B4) */}
      <EventRouter />

      {/* PAN-1970: New Project modal */}
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onCreated={handleProjectCreated}
      />

      {/* Mounts @keyframes for the pulsing extreme-tier cost warning badge */}
      <CostWarningStyles />

      {/* Collapsible sidebar navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSearchOpen={() => setIsSearchOpen(true)}
        selectedProject={selectedProjectKey}
        onSelectProject={handleSelectProject}
        onNewProject={handleNewProject}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <NoResumeBanner />

        {/* Deacon-frozen state and stopped-agents are now compact pills in the
            app bar (PAN-1591), not persistent full-width banners. */}
        <OrphanTestAgentsSurface />

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

        {/* App bar (PAN-1591) — project crumb · centered search · status pills.
            Replaces the persistent deacon/mem chrome with a compact strip. */}
        <div className="relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3">
          {/* left: active-project crumb */}
          <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground">
            {selectedProjectKey ? (
              <>
                <span className="h-3.5 w-3.5 rounded-[4px] bg-primary/40" aria-hidden="true" />
                {selectedProjectKey}
              </>
            ) : (
              <span className="text-muted-foreground">All projects</span>
            )}
          </div>

          {/* center: search (project-scoped placeholder — wired to global search today) */}
          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="mx-auto flex w-full min-w-0 max-w-md items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            title="Search"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{selectedProjectKey ? `Search ${selectedProjectKey}…` : 'Search issues, conversations, commands…'}</span>
            <kbd className="ml-auto rounded border border-border px-1.5 text-[11px]">/</kbd>
          </button>

          {/* right: status pills */}
          <div className="flex shrink-0 items-center gap-2">
            <DeaconPauseToggle compact />
            {runningAgentCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{runningAgentCount} agent{runningAgentCount === 1 ? '' : 's'}
              </span>
            )}
            {runningAgentCount > 0 && (
              <button
                type="button"
                onClick={triggerEmergencyStop}
                title={`Emergency stop — kill all agents and freeze auto-resume (${EMERGENCY_STOP_HOTKEY_LABEL})`}
                aria-label="Emergency stop all agents"
                className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
              >
                <StopCircle className="h-3.5 w-3.5" /> Stop all
              </button>
            )}
            <StoppedAgentsBanner variant="pill" />
            <LowCostModePill onOpenSettings={() => setActiveTab('settings')} />
            <SystemHealthPill />
            <SystemMenu onOpenSettings={() => setActiveTab('settings')} />
            {/* The Command Deck has the always-on Awareness rail, so the global
                feed toggle only appears on other pages (PAN-1591). */}
            {activeTab !== 'command-deck' && (
              <button
                type="button"
                aria-label="Toggle activity feed"
                aria-pressed={isSessionFeedSidebarOpen}
                title="Activity Feed"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                onClick={() => setSessionFeedSidebarOpen(!isSessionFeedSidebarOpen)}
              >
                <History className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex flex-1 overflow-hidden">
        <main
          data-drawer-open={drawerOpen ? 'true' : undefined}
          className="relative flex-1 flex overflow-hidden data-[drawer-open=true]:before:pointer-events-none data-[drawer-open=true]:before:absolute data-[drawer-open=true]:before:inset-0 data-[drawer-open=true]:before:z-[80] data-[drawer-open=true]:before:bg-primary/[0.04] data-[drawer-open=true]:before:backdrop-blur-[2px]"
        >
          <AppRoutes
            activeTab={activeTab}
            issues={issues}
            selectedConvId={selectedConvId}
            conversationViewMode={conversationViewMode}
            selectedProjectKey={selectedProjectKey}
            pendingConversationTarget={pendingConversationTarget}
            cockpitRoute={cockpitRoute}
            onOpenWorkspaceHome={handleOpenWorkspaceHome}
            onNewProject={handleNewProject}
            onSelectProject={handleSelectProject}
            onOpenSettings={() => setActiveTab('settings')}
            onConvIdChange={setSelectedConvId}
            onConversationViewModeChange={setConversationViewMode}
            onPendingConversationTargetConsumed={() => setPendingConversationTarget(null)}
            onProjectPrefixChange={setSearchProjectPrefix}
            onCockpitChange={onCockpitChange}
            onSearchOpen={() => setIsSearchOpen(true)}
            onTabChange={setActiveTab}
            onOpenIssue={openIssue}
            onPlanDialogChange={setPlanDialogIssueId}
            onSelectAgent={setSelectedAgent}
            onBacklogIssueAction={handleBacklogIssueAction}
          />
        </main>
        {/* PAN-1591: in the Command Deck the merged Awareness rail already covers
            this global feed, so don't double it up there. */}
        {isSessionFeedSidebarOpen && !['command-deck', 'backlog'].includes(activeTab) && (
          <SessionFeedSidebar onClose={() => setSessionFeedSidebarOpen(false)} />
        )}
        </div>
      </div>

      <IssueDrawer />

      <ChannelPermissionDialog
        request={currentChannelPermissionRequest}
        issueId={currentChannelPermissionIssueId}
        isOpen={!!currentChannelPermissionRequest}
        isSubmitting={channelPermissionResponseMutation.isPending}
        onAllow={handleAllowChannelPermission}
        onDeny={handleDenyChannelPermission}
      />

      {/* PAN-1520 — AskUserQuestion interactive dialog (covers both work
          agents and conversation sessions — same modal, same code path). */}
      <AskUserQuestionDialog
        subject={currentAskUserQuestionSubject}
        isOpen={!!currentAskUserQuestionSubject && !currentChannelPermissionRequest}
        isSubmitting={askUserQuestionAnswerMutation.isPending || codexApprovalMutation.isPending}
        onSubmit={handleSubmitAskUserQuestion}
        onDismiss={handleDismissAskUserQuestion}
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
        projectPrefix={activeTab === 'command-deck' ? searchProjectPrefix : null}
      />

      {/* Command Palette — Cmd+K / Ctrl+K */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        onNavigate={(tab, issueId) => {
          setActiveTab(tab as Tab);
          if (issueId) openIssue(issueId);
        }}
        onOpenConversationHit={handleOpenConversationHit}
      />

      {/* Emergency STOP hotkey (Cmd/Ctrl+Shift+.) — kills all agents, freezes auto-resume */}
      <EmergencyStopOverlay />

      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}
