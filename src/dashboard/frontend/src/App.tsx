import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { EmergencyStopOverlay } from './components/EmergencyStopOverlay';
import { ChannelPermissionDialog } from './components/ChannelPermissionDialog';
import { AskUserQuestionDialog } from './components/AskUserQuestionDialog';
import { EventRouter } from './components/EventRouter';
import { SearchModal } from './components/search/SearchModal';
import { CommandPalette, type ConversationPaletteOpenRequest } from './components/CommandPalette';
import { NO_PROJECT_KEY } from './components/CommandDeck/projectsData';
import { IssueDrawer } from './components/drawer/IssueDrawer';
import { SessionFeedSidebar } from './components/sessionFeed/SessionFeedSidebar';
import { NewProjectModal, type CreatedProject } from './components/CommandDeck/NewProjectModal';
import { Tab } from './components/Header';
import { Sidebar } from './components/Sidebar';

import { useCodexAutoRetry } from './hooks/useCodexAutoRetry';
import { CostWarningStyles } from './components/shared/costWarning';
import { Agent, Issue } from './types';
import { useDashboardStore, selectAgents, selectIssues, selectDashboardLifecycle } from './lib/store';
import { usePanesStore } from './lib/panesStore';
import { fetchExperimentalFeaturesEnabled, isExperimentalTab } from './lib/experimentalFeatures';
import type { ViewMode as ConversationViewMode } from './components/chat/ConversationPanel';
import {
  describeConversationHitOpenFailure,
  fetchBackendHealth,
  fetchCliproxyStatus,
  fetchConversationMessageLocator,
  fetchTrackerStatus,
  getCachedSupervisorUrl,
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
import { AppChrome } from './App/AppChrome';
import { usePendingInputDialogs } from './App/hooks/usePendingInputDialogs';

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
  // Issues from Zustand store (event-sourced via snapshot — no polling)
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];
  const {
    currentChannelPermissionRequest,
    currentChannelPermissionIssueId,
    isChannelPermissionSubmitting,
    handleAllowChannelPermission,
    handleDenyChannelPermission,
    currentAskUserQuestionSubject,
    isAskUserQuestionSubmitting,
    handleSubmitAskUserQuestion,
    handleDismissAskUserQuestion,
    currentConfirmation,
    handleConfirm,
    handleDeny,
    handleCloseConfirmation,
  } = usePendingInputDialogs({ agents, issues });

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
        <AppChrome
          activeTab={activeTab}
          selectedProjectKey={selectedProjectKey}
          runningAgentCount={runningAgentCount}
          dashboardLifecycle={dashboardLifecycle}
          showRestartBanner={showRestartBanner}
          bannerState={bannerState}
          missingKeyTrackers={missingKeyTrackers}
          trackerBannerDismissed={trackerBannerDismissed}
          showCliproxyBanner={showCliproxyBanner}
          isRestartBackendPending={restartBackendMutation.isPending}
          isRestartCliproxyPending={restartCliproxyMutation.isPending}
          isSessionFeedSidebarOpen={isSessionFeedSidebarOpen}
          onSearchOpen={() => setIsSearchOpen(true)}
          onOpenSettings={() => setActiveTab('settings')}
          onDismissTrackerBanner={() => setTrackerBannerDismissed(true)}
          onRestartBackend={() => restartBackendMutation.mutate()}
          onRestartCliproxy={() => restartCliproxyMutation.mutate()}
          onToggleSessionFeedSidebar={() => setSessionFeedSidebarOpen(!isSessionFeedSidebarOpen)}
        />

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
        isSubmitting={isChannelPermissionSubmitting}
        onAllow={handleAllowChannelPermission}
        onDeny={handleDenyChannelPermission}
      />

      {/* PAN-1520 — AskUserQuestion interactive dialog (covers both work
          agents and conversation sessions — same modal, same code path). */}
      <AskUserQuestionDialog
        subject={currentAskUserQuestionSubject}
        isOpen={!!currentAskUserQuestionSubject && !currentChannelPermissionRequest}
        isSubmitting={isAskUserQuestionSubmitting}
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
