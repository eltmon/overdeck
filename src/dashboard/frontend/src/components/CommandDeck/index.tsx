import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useShortcut, type ShortcutDef } from '../../lib/shortcuts/registry';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { ProjectNode } from './ProjectTree/ProjectNode';
import { type TreeSessionFilter } from './ProjectTree/FeatureItem';
import { Stage } from '../Stage';
import { ProjectHome } from '../Stage/ProjectHome';
import { IssueOverview } from '../Stage/IssueOverview';
import { SessionFeedSidebar } from '../sessionFeed/SessionFeedSidebar';
import { usePanesStore } from '../../lib/panesStore';
import { NO_PROJECT_KEY, NO_PROJECT_LABEL } from './projectsData';
import { ProjectMembershipBoundary } from './ProjectMembershipBoundary';
import { TasksDialog } from '../TasksDialog';
import { PlanDialog } from '../PlanDialog';
import { ConversationList, type Conversation } from './ConversationList';
import { useConversationMutations } from './useConversationMutations';
import { ForkModal } from './ForkModal';
import { NewConversationPickers } from './NewConversationPickers';
import { openConversationTab } from './openConversationTab';
import { type ViewMode } from '../chat/ConversationPanel';
import { MODEL_EFFORT_SUPPORT, loadStoredHarness, loadStoredModel, onKnownModelsSync } from '../chat/ModelPicker';
import { loadStoredEffort, type EffortLevel } from '../chat/EffortPicker';
import { pickerEffortLevels } from '../shared/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import { NewConversationSplitButton } from '../newConversation/NewConversationSplitButton';
import type { Agent, Issue, StartAgentResponse } from '../../types';
import { useDashboardStore } from '../../lib/store';
import { useAgentSetInvalidation } from '../../lib/useAgentSetInvalidation';
import { agentIdsByIssueKey, issueCreatedAtById, issueTitlesByKey } from './agentIdsByIssueKey';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../lib/pending-codex-spawn';
import { openRecoveryForStartBlock } from '../../lib/resumeRecovery';
import { getDirectRestartRequest } from '../../lib/restartRouting';
import { useConfirm } from '../DialogProvider';
import styles from './styles/command-deck.module.css';
import { fetchRegisteredProjects, ProjectRegistryErrorState, UnknownProjectState } from './UnknownProjectState';
import { DeckEmptyState } from './DeckEmptyState';
import { useDefaultDeckSelection } from './useDefaultDeckSelection';
import { IssuesPaneFilterRow } from './IssuesPaneFilterRow';
import { usePriorityConversation } from './usePriorityConversation';
import { LoadingBoundary } from '../primitives/LoadingBoundary';
import { useDeckProjects } from '../frame/deck/useDeckProjects';
import { useSessionTreeSubscription } from '../frame/deck/useSessionTreeSubscription';
import { useContainerStats } from '../frame/deck/useContainerStats';
import { useIssueCosts } from '../frame/deck/useIssueCosts';
import { fetchConversations, useProjectScope } from '../frame/deck/useProjectScope';
import { conversationRouteKey } from '../../lib/linkedConversation';

async function fetchVersion(): Promise<{ version: string }> {
  const res = await fetch('/api/version');
  if (!res.ok) throw new Error('Failed to fetch version');
  return res.json();
}

interface CommandDeckProps {
  /** Deep-link conversation ID — selects this conversation on mount */
  convId?: string | null;
  conversationViewMode?: ViewMode;
  pendingConversationTarget?: {
    conversationName: string;
    messageId: string;
    messageIndex?: number;
    nonce: number;
    label: string;
    subagentId?: string;
  } | null;
  onPendingConversationTargetConsumed?: () => void;
  /** Called when the selected conversation changes so App can sync the URL */
  onConvIdChange?: (id: string | null) => void;
  onConversationViewModeChange?: (mode: ViewMode) => void;
  /** PAN-1561: the project whose deck is shown, driven by the App sidebar. */
  selectedProject?: string | null;
  /** PAN-1561: switch the active project (e.g. when a conversation resolves to
   * a different project than the one currently shown). */
  onSelectProject?: (projectName: string | null, opts?: { updateUrl?: boolean }) => void;
  /** PAN-1593: report the selected project's issue prefix (e.g. "PAN") so the
   * app-bar search can scope to it. Null when no single prefix is resolvable. */
  onProjectPrefixChange?: (prefix: string | null) => void;
  /** PAN-2005: cockpit deep-link — open this issue's cockpit tab on mount/popstate. */
  cockpitIssue?: { project: string; issue: string } | null;
  /** PAN-2005: called when the selected issue changes so App can sync the URL
   * to /command-deck/<project>/<issue>. */
  onCockpitChange?: (projectKey: string | null, issueId: string | null) => void;
}

const CONVS_COLLAPSED_KEY = 'mc-convs-collapsed';
const PROJECTS_COLLAPSED_KEY = 'mc-projects-collapsed';
const SECTION_SPLIT_KEY = 'mc-section-split';

function ProjectPendingState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="status" className="flex items-center justify-center p-8">
      <LoadingBoundary label="The project" timeoutMs={8000} onRetry={onRetry}><span>Loading project…</span></LoadingBoundary>
    </div>
  )
}

// PAN-5293 F-D1: the left column and the deck share selection through this store.
const setSelectedFeature = (id: string | null) => useCommandDeckSelection.getState().setSelectedFeature(id);
const setSelectedConversation = (name: string | null) => useCommandDeckSelection.getState().setSelectedConversation(name);

export function CommandDeck({
  convId,
  pendingConversationTarget = null,
  onPendingConversationTargetConsumed,
  onConvIdChange,
  selectedProject = null,
  onSelectProject,
  onProjectPrefixChange,
  cockpitIssue = null,
  onCockpitChange,
  conversationViewMode,
}: CommandDeckProps) {
  const selectedFeature = useCommandDeckSelection((s) => s.selectedFeature);
  const selectedConversation = useCommandDeckSelection((s) => s.selectedConversation);
  // PAN-1591: the Awareness rail can be collapsed to reclaim pane width.
  const [awarenessCollapsed, setAwarenessCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('overdeck.ui.awarenessCollapsed') === 'true',
  );
  const toggleAwareness = useCallback((collapsed: boolean) => {
    setAwarenessCollapsed(collapsed);
    try { localStorage.setItem('overdeck.ui.awarenessCollapsed', String(collapsed)); } catch { /* ignore */ }
  }, []);
  const [showTasks, setShowTasks] = useState(false);
  const [planDialogIssue, setPlanDialogIssue] = useState<Issue | null>(null);
  const [convsCollapsed, setConvsCollapsed] = useState(() => {
    try { return localStorage.getItem(CONVS_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const [projectsCollapsed, setProjectsCollapsed] = useState(() => {
    try { return localStorage.getItem(PROJECTS_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const toggleConvsCollapsed = useCallback(() => {
    setConvsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(CONVS_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const toggleProjectsCollapsed = useCallback(() => {
    setProjectsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(PROJECTS_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [sectionSplit, setSectionSplit] = useState(() => {
    try {
      const saved = localStorage.getItem(SECTION_SPLIT_KEY);
      return saved ? Math.max(20, Math.min(80, Number(saved))) : 50;
    } catch { return 50; }
  });
  const isSectionDragging = useRef(false);
  const sectionDragStartY = useRef(0);
  const sectionDragStartSplit = useRef(50);
  const sectionContainerRef = useRef<HTMLDivElement>(null);
  const [treeFilter, setTreeFilter] = useState<TreeSessionFilter>('all');
  const [sidebarModel, setSidebarModel] = useState<string>(loadStoredModel);
  const [sidebarHarness, setSidebarHarness] = useState<Harness>(loadStoredHarness);
  const [sidebarEffort, setSidebarEffort] = useState<EffortLevel>(loadStoredEffort);

  // The mount-time loadStoredModel above runs before the picker's catalog
  // fetch completes, when only FALLBACK ids are "known" — a stored
  // catalog-only id (kimi-code/*, OpenRouter favorites) fails isKnownModel
  // and the composer shows the default instead. Re-derive once the catalog
  // syncs. Every explicit pick writes localStorage, so re-deriving always
  // reflects the user's latest choice and can never clobber a manual pick.
  useEffect(() => onKnownModelsSync(() => {
    setSidebarModel((current) => {
      const restored = loadStoredModel();
      return restored === current ? current : restored;
    });
  }), []);

  // Per-issue session selection (PAN-830 pan-11sr) — slice keyed by issueId.
  // The tree highlight uses the value for whichever feature is currently active.
  const selectSession = useCommandDeckSelection((s) => s.selectSession);
  const selectedSessionByIssue = useCommandDeckSelection((s) => s.selectedSessionByIssue);
  const selectedSessionId = selectedFeature
    ? selectedSessionByIssue[selectedFeature] ?? null
    : null;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('mc-sidebar-width');
    return saved ? Math.max(280, Number(saved)) : 320;
  });
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const currentWidth = useRef(sidebarWidth);
  const queryClient = useQueryClient();
  // PAN-2893: agent spawn/stop events refetch the projects pane immediately.
  useAgentSetInvalidation(queryClient);

  const { projects, projectsWithSessions, sessionTreeMap, isLoading } = useDeckProjects();
  // Until the frame swap (PAN-5293 WI-17) the deck still mounts the live
  // session-tree subscription itself.
  useSessionTreeSubscription(projects);
  const { issueCosts, issueCostDetails } = useIssueCosts();

  const { data: registeredProjects = [], isFetched: registeredProjectsFetched, isError: registeredProjectsError, refetch: refetchRegisteredProjects } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });
  useDefaultDeckSelection({ selectedProject, registeredProjects, onSelectProject, convId, loaded: registeredProjectsFetched && !registeredProjectsError });

  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: fetchVersion,
    staleTime: Infinity,
  });

  useEffect(() => {
    // A pending conversation deep-link (convId) must win over auto-select:
    // onSelectProject's default path clears the conversation route, which would
    // drop the deep-link before the effect below applies it.
    if (selectedProject || !onSelectProject || convId) return;
    const projectsWithFeatures = projectsWithSessions.filter((project) => project.features.length > 0);
    if (projectsWithFeatures.length === 1) {
      onSelectProject(projectsWithFeatures[0]!.name);
    }
  }, [convId, onSelectProject, projectsWithSessions, selectedProject]);

  const containerStats = useContainerStats(projectsWithSessions);

  // PAN-4560: flat lookup maps instead of the whole agent and issue slices, so
  // the deck re-renders only when an entry it reads changes. Handlers read the
  // store at call time.
  const agentIdByIssue = useDashboardStore(useShallow((s) => agentIdsByIssueKey(s.agentsById)));
  const issueTitles = useDashboardStore(useShallow((s) => issueTitlesByKey(s.issuesRaw as Issue[])));
  const createdAtByIssue = useDashboardStore(useShallow((s) => issueCreatedAtById(s.issuesRaw as Issue[])));

  // PAN-1985: confirmation for the destructive harness/model switch paths on
  // work and review sessions. Resumed sessions (no model/harness change) skip
  // the dialog.
  const confirm = useConfirm();

  const { data: conversationList = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const { conversations, error: conversationRouteError } = usePriorityConversation(convId, conversationList);

  const {
    projectConvs, projectConvIdSet, projectIssueIds, selectedProjectData, visibleFeatures,
    selectedRegisteredProject, resolveConversationProjectName, membership,
  } = useProjectScope(selectedProject, conversations);
  const isProjectValidationPending = membership.pending;
  const showUnknownProject = membership.unknown;

  // Track the last deep-link ID we applied so we only navigate for *new* deep-links
  // (e.g. popstate), not on every conversations refetch.
  const appliedConvId = useRef<string | null>(null);
  // PAN-2005: same idea for the issue cockpit deep-link (/command-deck/<proj>/<issue>).
  const appliedCockpit = useRef<string | null>(null);

  // ── Project-deck tab helpers (PAN-1561) ──────────────────────────────────────
  // Open/focus tabs in a project's deck directly via the shared panesStore (the
  // same store the Stage reads). `*In` variants take an explicit project key so
  // the deep-link effect can target a project before selection state settles.
  const openIssueTabIn = useCallback((projectKey: string, issueId: string, label: string) => {
    const store = usePanesStore.getState();
    store.ensureHome(projectKey);
    const panes = store.panesByWorkspace[projectKey] ?? [];
    const existing = panes.find((p) => p.paneType === 'issue' && p.issueId === issueId);
    if (existing) store.setActivePane(projectKey, existing.paneId);
    else store.addPane(projectKey, { paneType: 'issue', label, issueId });
  }, []);

  const openConversationTabIn = useCallback((projectKey: string, name: string, label: string, target?: {
    messageId: string;
    messageIndex?: number;
    nonce: number;
    subagentId?: string;
  }, viewMode?: ViewMode) => openConversationTab(projectKey, name, label, target, viewMode), []);

  const openTerminalTabIn = useCallback((projectKey: string, sessionId: string) => {
    const store = usePanesStore.getState();
    store.ensureHome(projectKey);
    store.addPane(projectKey, { paneType: 'terminal', label: 'Terminal', terminalId: sessionId });
  }, []);

  // Open a session-backed agent pane (clicking an agent in the rail tree). The pane
  // carries the sessionId on `agentId` and the owning issue on `issueId`; Stage's
  // resolveSession turns that into the live SessionNode → SessionPanel.
  const openSessionPaneIn = useCallback((projectKey: string, sessionId: string, issueId: string, label: string) => {
    const store = usePanesStore.getState();
    store.ensureHome(projectKey);
    const panes = store.panesByWorkspace[projectKey] ?? [];
    const existing = panes.find((p) => p.paneType === 'agent' && p.agentId === sessionId);
    if (existing) store.setActivePane(projectKey, existing.paneId);
    else store.addPane(projectKey, { paneType: 'agent', label, agentId: sessionId, issueId });
  }, []);

  // On mount or when convId changes (popstate), apply the deep-link: switch to
  // the conversation's project and open it as an agent tab in that deck.
  useEffect(() => {
    if (!convId || !registeredProjectsFetched || registeredProjectsError) return;
    // The view mode is part of the deep link: switching ?view=terminal on an
    // already-open conversation must re-apply, not be skipped as "unchanged".
    const deepLinkKey = `${convId}::${conversationViewMode ?? 'conversation'}`;
    if (deepLinkKey === appliedConvId.current) return;
    const conv = conversations.find((c) => String(c.id) === convId || c.name === convId);
    if (!conv) return;
    setSelectedConversation(conv.name);
    setSelectedFeature(null);
    const projectName = resolveConversationProjectName(conv) ?? NO_PROJECT_KEY;
    const target = pendingConversationTarget?.conversationName === conv.name
      ? {
          messageId: pendingConversationTarget.messageId,
          messageIndex: pendingConversationTarget.messageIndex,
          nonce: pendingConversationTarget.nonce,
          subagentId: pendingConversationTarget.subagentId,
        }
      : undefined;
    // Opening a conversation: the /conv/<id> route owns the URL, so switch the
    // deck's project without writing /command-deck/<project> over it.
    onSelectProject?.(projectName, { updateUrl: false });
    openConversationTabIn(
      projectName,
      conv.name,
      pendingConversationTarget?.label ?? conv.title ?? 'Agent',
      target,
      conversationViewMode === 'terminal' ? 'terminal' : undefined,
    );
    if (target) onPendingConversationTargetConsumed?.();
    appliedConvId.current = deepLinkKey;
  }, [convId, conversations, registeredProjectsFetched, registeredProjectsError, resolveConversationProjectName, onSelectProject, openConversationTabIn, pendingConversationTarget, onPendingConversationTargetConsumed, conversationViewMode]);

  // Auto-select first conversation on initial load if no deep-link and no feature selected.
  // An `?issue=` deep-link (issue cockpit/drawer, e.g. ?issue=PAN-1908&tab=conversation)
  // is ALSO a deep-link: without this guard, auto-select grabbed conversations[0] and
  // navigated to /conv/<id>, bouncing the operator off the issue's work-agent view onto an
  // unrelated conversation on every page load/reload.
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    const hasIssueDeepLink = new URLSearchParams(window.location.search).has('issue');
    if (conversations.length === 0 || convId || hasIssueDeepLink || selectedConversation !== null || selectedFeature !== null || selectedProject !== null) return;
    setSelectedConversation(conversations[0].name);
    hasAutoSelected.current = true;
  }, [conversations, convId, selectedConversation, selectedFeature, selectedProject]);

  // Sync URL when selected conversation changes (user clicks, draft promoted, etc.)
  // Use a ref to track the previous value so we only call onConvIdChange when it actually changes.
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onConvIdChange) return;
    if (selectedConversation === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedConversation;
    if (!selectedConversation) {
      onConvIdChange(null);
      return;
    }
    const conv = conversations.find((c) => c.name === selectedConversation);
    if (conv) {
      if (convId === String(conv.id) || convId === conv.name) return;
      onConvIdChange(conversationRouteKey(conv));
    }
  }, [selectedConversation, conversations, onConvIdChange, convId]);

  // PAN-2005: apply the cockpit deep-link (/command-deck/<proj>/<issue>) on mount
  // and popstate — select the project and open (or focus) the issue's cockpit tab.
  useEffect(() => {
    if (!cockpitIssue) return;
    // Wait until deck keys are loaded so the project segment normalizes correctly
    // on the FIRST apply (else we'd lock onto the raw repo key and never re-resolve).
    if (registeredProjects.length === 0) return;
    const key = `${cockpitIssue.project}/${cockpitIssue.issue}`;
    if (key === appliedCockpit.current) return;
    appliedCockpit.current = key;
    // Normalize the URL's project segment to a real dashboard deck key — a stale
    // or hand-built link may carry the tracker repo ("eltmon/panopticon-cli")
    // instead of the deck key ("panopticon-cli"); the sync effect then self-corrects
    // the URL once the feature is selected.
    const seg = cockpitIssue.project;
    const tail = seg.includes('/') ? seg.split('/').pop()! : seg;
    const rp = registeredProjects.find(
      (p) => p.key === seg || p.name === seg || p.key === tail || p.name === tail,
    );
    const deckKey = rp ? (rp.name ?? rp.key) : seg;
    setSelectedFeature(cockpitIssue.issue);
    setSelectedConversation(null);
    onSelectProject?.(deckKey);
    openIssueTabIn(deckKey, cockpitIssue.issue, cockpitIssue.issue);
  }, [cockpitIssue, onSelectProject, openIssueTabIn, registeredProjects]);

  // PAN-2005: sync the URL when the selected issue changes (tree click, etc.).
  // Defined after the conversation-route sync above so the issue path wins when
  // both fire on the same selection change (selecting a feature nulls the conv).
  const prevFeatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onCockpitChange) return;
    if (selectedFeature === prevFeatureRef.current) return;
    prevFeatureRef.current = selectedFeature;
    if (selectedFeature && selectedProject) {
      onCockpitChange(selectedProject, selectedFeature);
    }
  }, [selectedFeature, selectedProject, onCockpitChange]);

  // PAN-5293 F-D1: clear the store on unmount or the next mount's URL sync sees a leftover;
  // resetting the deep-link guards lets StrictMode's second effect pass re-apply the link.
  useEffect(() => () => {
    const selection = useCommandDeckSelection.getState();
    selection.setSelectedConversation(null);
    selection.setSelectedFeature(null);
    appliedConvId.current = null;
    appliedCockpit.current = null;
    hasAutoSelected.current = false;
  }, []);

  // PAN-1561: selecting an issue from the tree opens (or focuses) an issue tab
  // in the current project's deck rather than replacing the whole content area.
  const handleSelectFeature = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedConversation(null);
    if (selectedProject) openIssueTabIn(selectedProject, issueId, issueId);

    const feature = projectsWithSessions
      .flatMap(p => p.features)
      .find(f => f.issueId === issueId);
    const activeWorkSession = feature?.sessions?.find(
      (s) => s.presence === 'active' && s.type === 'work',
    );
    selectSession(issueId, activeWorkSession?.sessionId ?? null);
  }, [selectSession, projectsWithSessions, selectedProject, openIssueTabIn]);

  // Reverse sync from the Stage: clicking an issue pane tab bypasses
  // handleSelectFeature, so mirror the selection here to keep the cockpit URL
  // (/command-deck/<project>/<issue>) following the visible view.
  const handleActiveIssuePane = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedConversation(null);
  }, []);

  const handleSelectSession = useCallback((issueId: string, sessionId: string) => {
    setSelectedFeature(issueId);
    selectSession(issueId, sessionId);
    setSelectedConversation(null);
    if (!selectedProject) return;
    // Clicking an agent in the rail tree opens THAT agent's conversation (SessionPanel),
    // not the issue tab. Label from the session's role/type (e.g. "Security", "Work").
    const session = projectsWithSessions
      .flatMap((p) => p.features)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.sessionId === sessionId);
    const raw = session?.role ?? session?.type ?? 'Agent';
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    openSessionPaneIn(selectedProject, sessionId, issueId, label);
  }, [selectSession, selectedProject, projectsWithSessions, openSessionPaneIn]);

  // Resolve a session id → its live SessionNode for Stage's session-backed agent panes.
  const resolveSession = useCallback((sessionId: string) =>
    projectsWithSessions
      .flatMap((p) => p.features)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.sessionId === sessionId),
  [projectsWithSessions]);

  const handleStopSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to stop session');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop session');
    }
  }, [queryClient]);

  const handleCleanupOrphanedResources = useCallback(async (issueId: string) => {
    if (!window.confirm(`Clean up orphaned resources for ${issueId}? This removes leftover local workspace state for a closed issue.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/cleanup-workspace`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clean up orphaned resources');
      await queryClient.invalidateQueries({ queryKey: ['command-deck-projects'] });
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clean up resources');
    }
  }, [queryClient]);

  const handleViewTerminal = useCallback((sessionId: string) => {
    // Find which issue owns this session, highlight it, and open a terminal tab
    // for the session in the project deck.
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          if (selectedProject) openTerminalTabIn(selectedProject, sessionId);
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession, selectedProject, openTerminalTabIn]);

  const handlePauseSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error('Failed to pause session');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to pause session');
    }
  }, [queryClient]);

  const handleResumeSession = useCallback(async (sessionId: string) => {
    try {
      console.log(`[command-deck] handleResumeSession ${sessionId}`);
      const res = await fetch(`/api/agents/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Resumed from dashboard' }),
      });
      const data = await res.json().catch(() => ({})) as { messageDelivered?: boolean; error?: string };
      if (!res.ok) {
        console.warn(`[command-deck] handleResumeSession ${sessionId} failed: ${res.status} ${data.error ?? 'no body'}`);
        throw new Error(data.error || 'Failed to resume session');
      }
      console.log(`[command-deck] handleResumeSession ${sessionId} ok: messageDelivered=${data.messageDelivered}`);
      toast.success(data.messageDelivered === false
        ? 'Agent resumed; message queued in mail (PTY echo-confirm timed out)'
        : 'Agent resumed');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume session');
    }
  }, [queryClient]);

  // PAN-1779: clear a persistent pause gate. Distinct from resume — unpause
  // removes the gate without spawning; the deacon's next patrol resumes it.
  const handleUnpauseSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/agents/${sessionId}/unpause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to unpause agent');
      toast.success('Agent unpaused — deacon will resume it on the next patrol');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unpause agent');
    }
  }, [queryClient]);

  const handleRestartSession = useCallback(async (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string, harness?: Harness) => {
    try {
      // Find project key for this issue. Primary: resource-allocated issue list.
      // Fallback: session tree (covers issues where the work agent is done but
      // review is still running — those drop off resource-allocated but stay in the tree).
      const projectKey = projectsWithSessions.find(p =>
        p.features.some(f => f.issueId === issueId),
      )?.name
        ?? Object.entries(sessionTreeMap).find(([, tree]) =>
          tree.features.some(f => f.issueId.toLowerCase() === issueId.toLowerCase()),
        )?.[0];

      // PAN-1985: detect whether this picker click is actually changing the
      // work agent's harness or model, so we can route to the wipe+respawn
      // path instead of the cheap resume path. Same-harness, no-model
      // selections ("Default role config") keep the resume-first behavior;
      // any explicit harness or model change goes through the destructive
      // restart-fresh route after a typed confirmation.
      const isWorkSession = !sessionType || sessionType === 'work';
      const currentAgent = isWorkSession
        ? useDashboardStore.getState().agentsById[sessionId] as unknown as Agent | undefined
        : undefined;
      const currentHarness = currentAgent?.harness ?? undefined;
      const currentModel = currentAgent?.model ?? undefined;
      const harnessIsChanging = isWorkSession
        && harness !== undefined
        && harness !== currentHarness
        && currentHarness !== undefined;
      const modelIsChanging = isWorkSession
        && model !== undefined
        && model !== currentModel
        && currentModel !== undefined
        && !harnessIsChanging; // harness change implies model change too
      const isDestructiveWorkChange = harnessIsChanging || modelIsChanging;
      const isDestructiveReview = sessionType === 'review' || sessionType === 'reviewer';

      if (isDestructiveWorkChange || isDestructiveReview) {
        const confirmTitle = isDestructiveReview
          ? 'Re-run review on latest commit with new harness/model'
          : 'Restart work agent with new harness/model';
        const reviewMessage = `This will delete the review agent's state for ${issueId} (sessions, activity, logs) and start a fresh review run with the chosen harness/model.\n\nThe workspace, xBRIEF, tasks, and commit history are kept. The review will have to re-research the diff from scratch — this is a deliberate cost of switching harness/model or force-restarting the review.`;
        const workMessage = `This will delete the work agent's state for ${issueId} (sessions, activity, logs) and start a fresh ${harness ?? currentHarness ?? ''} + ${model ?? currentModel ?? ''} agent.\n\nThe workspace, xBRIEF, tasks, and commit history are kept. The new agent will read .pan/continue.json and the branch to continue. The agent will have to re-research the diff from scratch — this is a deliberate cost of switching harness/model.`;
        const confirmed = await confirm({
          title: confirmTitle,
          message: isDestructiveReview ? reviewMessage : workMessage,
          confirmLabel: isDestructiveReview ? 'Re-run review' : 'Restart work agent',
          variant: 'destructive',
        });
        if (!confirmed) {
          toast.info('Restart canceled');
          return;
        }
      }

      const directRestartRequest = getDirectRestartRequest({ projectKey, issueId, sessionId, sessionType, role, model, harness });
      if (directRestartRequest && !isDestructiveWorkChange) {
        // Note: isDestructiveWorkChange is false here because it's a work
        // session, but we still gate the direct path to avoid double-routing
        // in the rare case a future change makes getDirectRestartRequest
        // return for work sessions too.
        const res = await fetch(directRestartRequest.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(directRestartRequest.body),
        });
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (!res.ok) throw new Error(data.error || directRestartRequest.errorMessage);
        toast.success(directRestartRequest.successMessage);
        await refreshDashboardState(queryClient);
        return;
      }

      // PAN-1985: destructive work-agent change. Wipe the work agent dir and
      // respawn a fresh agent with the chosen harness/model. The user has
      // already confirmed; do not fall through to the cheap resume path.
      if (isDestructiveWorkChange) {
        const restartFreshRes = await fetch(`/api/agents/${sessionId}/restart-fresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spawn: true,
            ...(model ? { model } : {}),
            ...(harness ? { harness } : {}),
          }),
        });
        const restartFreshData = await restartFreshRes.json().catch(() => ({})) as {
          success?: boolean;
          error?: string;
          spawnedModel?: string;
          spawnedHarness?: string;
        };
        if (!restartFreshRes.ok) {
          // A live-session 409 offers Stop & restart with the SAME payload —
          // never the raw 'pan kill' instruction text.
          if (openRecoveryForStartBlock(restartFreshRes.status, restartFreshData, issueId, {
            url: `/api/agents/${sessionId}/restart-fresh`,
            body: { spawn: true, ...(model ? { model } : {}), ...(harness ? { harness } : {}) },
          })) return;
          throw new Error(restartFreshData.error || 'Failed to restart agent with new harness/model');
        }
        toast.success(
          `Agent restarted: ${restartFreshData.spawnedHarness ?? harness} + ${restartFreshData.spawnedModel ?? model}`,
        );
        await refreshDashboardState(queryClient);
        return;
      }

      // Default: work agent restart. Try resume first — Claude sessions are never
      // discarded. Only start fresh if the agent has no saved session to resume.
      const resumeRes = await fetch(`/api/agents/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(model ? { model } : {}),
          ...(harness ? { harness } : {}),
        }),
      });
      const resumeData = await resumeRes.json().catch(() => ({})) as { success?: boolean; error?: string; lifecycle?: { canResumeSession?: boolean; hasLivePane?: boolean; isRunning?: boolean } };
      if (resumeRes.ok) {
        toast.success('Agent resumed');
        await refreshDashboardState(queryClient);
        return;
      }
      // Agent is currently running — true restart: stop it, then resume from saved session.
      if (resumeData.lifecycle?.isRunning) {
        const stopRes = await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
        if (!stopRes.ok) throw new Error('Failed to stop agent before restart');
        const resumeRetryRes = await fetch(`/api/agents/${sessionId}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(model ? { model } : {}),
            ...(harness ? { harness } : {}),
          }),
        });
        if (!resumeRetryRes.ok) {
          const retryData = await resumeRetryRes.json().catch(() => ({})) as { error?: string };
          if (openRecoveryForStartBlock(resumeRetryRes.status, retryData, issueId)) return;
          throw new Error(retryData.error || 'Failed to restart agent');
        }
        toast.success('Agent restarted');
        await refreshDashboardState(queryClient);
        return;
      }
      // Only fall through to start-fresh when there is genuinely no session to resume.
      const noSession = resumeData.lifecycle?.canResumeSession === false && !resumeData.lifecycle?.hasLivePane;
      if (!noSession) {
        // A gate/resumable 409 opens the recovery dialog instead of toasting CLI text.
        if (openRecoveryForStartBlock(resumeRes.status, resumeData, issueId)) return;
        throw new Error(resumeData.error || 'Failed to resume agent');
      }

      // No saved session — start fresh.
      await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      const requestBody: Record<string, unknown> = { issueId };
      if (model) requestBody.model = model;
      if (harness) requestBody.harness = harness;
      let lastRequestBody = requestBody;
      let res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastRequestBody),
      });
      let data = await res.json().catch(() => ({})) as StartAgentResponse;
      if (res.status === 409 && data.requiresAcknowledgement) {
        const confirmed = window.confirm((data.guardrails?.warnings ?? []).map((warning) => `• ${warning.message}`).join('\n'));
        if (!confirmed) throw new Error('Agent start canceled');
        lastRequestBody = { ...requestBody, guardrailAcknowledged: true };
        res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastRequestBody),
        });
        data = await res.json().catch(() => ({})) as StartAgentResponse;
      }
      if (!res.ok) {
        if (isCodexBlockedResponse(res, data)) {
          setPendingCodexSpawn(lastRequestBody);
          throw new Error(data.hint || data.error || 'Codex authentication expired — re-authenticate to continue');
        }
        // Start-block 409s open the recovery dialog instead of toasting CLI text.
        if (openRecoveryForStartBlock(res.status, data, issueId)) return;
        throw new Error(data.error || data.hint || 'Failed to start agent');
      }
      if (data.guardrails?.warnings?.length) {
        toast.success('Agent started after acknowledging system health warnings.', { duration: 6000 });
      }
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restart session');
    }
  }, [queryClient, projectsWithSessions, sessionTreeMap, confirm]);

  const handleDeepWipe = useCallback(async (issueId: string) => {
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/deep-wipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: true }),
      });
      if (!res.ok) throw new Error('Failed to deep wipe');
      await refreshDashboardState(queryClient);
      // Deselect the feature since its workspace is gone
      setSelectedFeature(null);
      selectSession(issueId, null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deep wipe');
    }
  }, [queryClient, selectSession]);

  const handleOpenStateDir = useCallback((sessionId: string) => {
    const path = `~/.overdeck/agents/${sessionId}/`;
    navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
  }, []);

  const handleOpenPlanDialog = useCallback((issueId: string) => {
    const issues = useDashboardStore.getState().issuesRaw as Issue[];
    const found = issues.find(i => i.identifier.toLowerCase() === issueId.toLowerCase());
    // Never silently no-op: if the issue isn't in the loaded `issues` list (filtered/
    // paginated/out-of-sync), synthesize a minimal one so the dialog still opens.
    const issue = found ?? ({
      id: issueId, identifier: issueId, title: issueId, status: 'Todo',
      priority: 0, labels: [], url: '', createdAt: '', updatedAt: '',
    } as unknown as Issue);
    setPlanDialogIssue(issue);
  }, []);

  const handleViewJsonl = useCallback((sessionId: string) => {
    // Highlight the owning issue and open its tab so its transcript is reachable.
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          if (selectedProject) openIssueTabIn(selectedProject, feature.issueId, feature.issueId);
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession, selectedProject, openIssueTabIn]);

  // The project header in column 2 is a single (selected) project; clicking it
  // focuses the deck's HOME tab via the App sidebar's selection callback.
  const handleSelectProject = useCallback((projectName: string) => {
    onSelectProject?.(projectName);
    setSelectedFeature(null);
    setSelectedConversation(null);
  }, [onSelectProject]);

  // PAN-1561: selecting a conversation opens it as an agent tab in its project's
  // deck (switching project if it belongs to a different one than is shown).
  const handleSelectConversation = useCallback((name: string | null) => {
    setSelectedConversation(name);
    if (selectedFeature) {
      selectSession(selectedFeature, null);
    }
    if (name) {
      setSelectedFeature(null);
      const conv = conversations.find((c) => c.name === name);
      // Unscoped conversations live in the No-project bucket.
      const projectName = resolveConversationProjectName(conv) ?? NO_PROJECT_KEY;
      // Opening a conversation: the /conv/<id> route owns the URL, so switch the
      // deck's project without writing /command-deck/<project> over it.
      if (projectName !== selectedProject) onSelectProject?.(projectName, { updateUrl: false });
      openConversationTabIn(projectName, name, conv?.title ?? 'Agent');
      // A click is an explicit intent to open this conversation, so drive the
      // /conv/<id> URL directly. Re-clicking the already-selected conversation
      // leaves `selectedConversation` unchanged, so the state->URL sync effect
      // never re-runs — without this the URL would stay on /command-deck/<project>
      // (e.g. after navigating to another page and back). prevSelectedRef is kept
      // in sync so that effect skips the redundant follow-up call.
      if (conv && onConvIdChange) {
        prevSelectedRef.current = name;
        onConvIdChange(conversationRouteKey(conv));
      }
    }
  }, [selectSession, selectedFeature, conversations, resolveConversationProjectName, selectedProject, onSelectProject, openConversationTabIn, onConvIdChange]);

  const projectConvMutations = useConversationMutations(selectedConversation, handleSelectConversation);

  // Listen for `/handoff …` submitted in the chat composer — opens the fork
  // modal pre-set to handoff mode for the conversation that emitted the
  // event. Trailing text after the verb becomes the focus and pre-fills the
  // dialog's Focus textarea.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        conversation: Conversation;
        mode?: 'summary' | 'fast-summary' | 'plain' | 'handoff';
        focus?: string;
      }>).detail;
      if (!detail?.conversation) return;
      projectConvMutations.openForkModal(detail.conversation, { mode: detail.mode, focus: detail.focus });
    };
    window.addEventListener('overdeck:open-fork-modal', handler);
    return () => window.removeEventListener('overdeck:open-fork-modal', handler);
  }, [projectConvMutations]);

  // Create a conversation (optionally scoped to a project) and open it as an
  // agent tab in the current project's deck. Returns the new conversation's
  // name or the creation error so launch components can render the outcome.
  const createConversationForProject = useCallback(
    async (projectKey?: string, harnessOverride?: Harness, message?: string, viewMode?: ViewMode): Promise<{ name: string } | { error: string }> => {
      try {
        const harness = harnessOverride ?? sidebarHarness;
        const payload: Record<string, unknown> = { model: sidebarModel, harness };
        const sidebarEffortLevels = pickerEffortLevels(sidebarModel) ?? MODEL_EFFORT_SUPPORT[sidebarModel as keyof typeof MODEL_EFFORT_SUPPORT];
        if (sidebarEffortLevels?.length !== 0) payload.effort = sidebarEffort;
        if (projectKey) payload.projectKey = projectKey;
        const trimmedMessage = message?.trim();
        if (trimmedMessage) payload.message = trimmedMessage;
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }));
          throw new Error((err as { error?: string }).error || 'Failed to create conversation');
        }
        const conv = await res.json() as Conversation;
        setSelectedConversation(conv.name);
        if (convsCollapsed) setConvsCollapsed(false);
        const deckKey = projectKey ?? selectedProject;
        if (deckKey) openConversationTabIn(deckKey, conv.name, conv.title ?? 'Agent', undefined, viewMode);
        if (onConvIdChange) {
          const newId = String(conv.id);
          onConvIdChange(newId);
          appliedConvId.current = `${newId}::${conversationViewMode ?? 'conversation'}`;
          prevSelectedRef.current = conv.name;
        }
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        return { name: conv.name };
      } catch (err) {
        console.error('[CommandDeck] Failed to create conversation:', err);
        toast.error(err instanceof Error ? err.message : 'Failed to create conversation');
        return { error: err instanceof Error ? err.message : 'Failed to create conversation' };
      }
    },
    [sidebarModel, sidebarHarness, sidebarEffort, queryClient, onConvIdChange, convsCollapsed, selectedProject, openConversationTabIn, conversationViewMode],
  );

  const handleNewConversation = useCallback(() => {
    const projectKey = selectedProject && selectedProject !== NO_PROJECT_KEY ? selectedProject : undefined;
    void createConversationForProject(projectKey);
  }, [createConversationForProject, selectedProject]);
  // PAN-5287 S-D7: N starts a conversation here; moves to the left column in child F.
  useShortcut(useMemo((): ShortcutDef => ({
    id: 'deck.new-conversation', keys: { mac: 'N', other: 'N' }, scope: 'not-editing',
    label: 'New conversation', group: 'General', run: () => handleNewConversation(),
    when: () => !document.querySelector('[aria-modal="true"]'),
  }), [handleNewConversation]));

  const handleNewProjectConversation = useCallback((projectKey: string) => {
    void createConversationForProject(projectKey);
  }, [createConversationForProject]);

  // Launch-component conversation creator (ProjectHome / IssueOverview): create
  // a project conversation for the chosen agent and return its result so the
  // caller can open the tab or surface the creation error.
  const createDeckConversation = useCallback(
    (agentId: string, message?: string, viewMode?: ViewMode): Promise<{ name: string } | { error: string }> => {
      const harness: Harness = agentId === 'codex' ? 'codex' : agentId === 'pi' ? 'pi' : agentId === 'ohmypi' ? 'ohmypi' : 'claude-code';
      // The No-project bucket creates unscoped conversations (no projectKey).
      const projectKey = selectedProject && selectedProject !== NO_PROJECT_KEY ? selectedProject : undefined;
      return createConversationForProject(projectKey, harness, message, viewMode);
    },
    [createConversationForProject, selectedProject],
  );

  // Section divider drag handlers
  const handleSectionDragStart = useCallback((e: React.MouseEvent) => {
    isSectionDragging.current = true;
    sectionDragStartY.current = e.clientY;
    sectionDragStartSplit.current = sectionSplit;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [sectionSplit]);

  useEffect(() => {
    const handleSectionDragMove = (e: MouseEvent) => {
      if (!isSectionDragging.current || !sectionContainerRef.current) return;
      const containerHeight = sectionContainerRef.current.getBoundingClientRect().height;
      if (containerHeight <= 0) return;
      const deltaY = e.clientY - sectionDragStartY.current;
      const deltaPct = (deltaY / containerHeight) * 100;
      const newSplit = Math.max(15, Math.min(85, sectionDragStartSplit.current + deltaPct));
      setSectionSplit(newSplit);
    };

    const handleSectionDragEnd = () => {
      if (isSectionDragging.current) {
        isSectionDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setSectionSplit(prev => {
          try { localStorage.setItem(SECTION_SPLIT_KEY, String(Math.round(prev))); } catch { /* ignore */ }
          return prev;
        });
      }
    };

    document.addEventListener('mousemove', handleSectionDragMove);
    document.addEventListener('mouseup', handleSectionDragEnd);
    return () => {
      document.removeEventListener('mousemove', handleSectionDragMove);
      document.removeEventListener('mouseup', handleSectionDragEnd);
    };
  }, []);

  // Resizable sidebar drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.max(280, Math.min(500, startWidth.current + delta));
      setSidebarWidth(newWidth);
      currentWidth.current = newWidth;
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        localStorage.setItem('mc-sidebar-width', String(currentWidth.current));
      }
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Re-fetch all query caches when the WebSocket transport reconnects after
  // a dashboard restart. Without this, the Command Deck operates on stale
  // data — conversations vanish, session trees freeze, costs go stale.
  useEffect(() => {
    const handler = () => {
      console.log('[CommandDeck] transport reconnected — invalidating query caches');
      queryClient.invalidateQueries();
    };
    window.addEventListener('overdeck:reconnected', handler);
    return () => window.removeEventListener('overdeck:reconnected', handler);
  }, [queryClient]);

  // ── Project-scoped deck data (PAN-1561) ── from useProjectScope above.
  const isNoProject = selectedProject === NO_PROJECT_KEY;

  // PAN-1593: the selected project's single issue prefix (e.g. "PAN"), derived
  // from its issue ids — the same signal ProjectOverview uses. Reported up so the
  // app-bar search can scope to this project. Null when ambiguous/empty.
  const selectedProjectPrefix = useMemo(() => {
    const prefixes = new Set(
      projectIssueIds.map((id) => id.split('-')[0]?.toUpperCase()).filter(Boolean),
    );
    return prefixes.size === 1 ? [...prefixes][0]! : null;
  }, [projectIssueIds]);
  useEffect(() => {
    onProjectPrefixChange?.(selectedProjectPrefix);
  }, [selectedProjectPrefix, onProjectPrefixChange]);

  // Resolve the per-issue data an issue tab's IssueOverview needs.
  const resolveIssue = useCallback(
    (issueId: string) => {
      const key = issueId.toLowerCase();
      const title = issueTitles[key] || issueTitles[issueId] || issueId;
      const createdAt = createdAtByIssue[issueId];
      const branch = selectedProjectData?.features.find(f => f.issueId === issueId)?.branch;
      const agentId = agentIdByIssue[key];
      return { title, createdAt, branch, agentId };
    },
    [issueTitles, createdAtByIssue, selectedProjectData, agentIdByIssue],
  );

  return (
    <div className={styles.commandDeck}>
      <div className={styles.layout}>
        {/* Sidebar: Project Tree */}
        <div className={styles.sidebar} style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarHeaderRow}>
              <h2 className={styles.sidebarTitle}>Command Deck</h2>
              <div className={styles.sidebarHeaderGroup}>
                <NewConversationPickers
                  model={sidebarModel}
                  onModelChange={setSidebarModel}
                  harness={sidebarHarness}
                  onHarnessChange={setSidebarHarness}
                  effort={sidebarEffort}
                  onEffortChange={setSidebarEffort}
                />
                <NewConversationSplitButton
                  onQuickCreate={handleNewConversation}
                  projectKey={selectedProject && selectedProject !== NO_PROJECT_KEY ? selectedProject : undefined}
                />
              </div>
            </div>
          </div>

          <div ref={sectionContainerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* ── Conversations section ─────────────────────────────── */}
          <div
            className={`${styles.sidebarSection} ${convsCollapsed ? styles.sidebarSectionCollapsed : ''}`}
            style={!convsCollapsed && !projectsCollapsed ? { flex: `0 0 ${sectionSplit}%` } : undefined}
          >
            <div className={styles.sectionHeader} onClick={toggleConvsCollapsed}>
              {convsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span className={styles.sectionTitle}>Conversations</span>
              <span className={styles.segmentCount}>{projectConvs.length}</span>
            </div>
            {!convsCollapsed && (
              <div className={styles.sectionBody}>
                {selectedProject ? (
                  <ConversationList
                    selectedConversation={selectedConversation}
                    onSelectConversation={handleSelectConversation}
                    includeIds={projectConvIdSet}
                  />
                ) : (
                  <div className={styles.emptyProject}>Select a project to see its conversations</div>
                )}
              </div>
            )}
          </div>

          {/* ── Draggable divider ─────────────────────────────────── */}
          {!convsCollapsed && !projectsCollapsed && (
            <div
              className={styles.sectionDivider}
              onMouseDown={handleSectionDragStart}
            />
          )}

          {/* ── Issues section (selected project's tree, PAN-1561) ───── */}
          <div
            className={`${styles.sidebarSection} ${projectsCollapsed ? styles.sidebarSectionCollapsed : ''}`}
            style={!convsCollapsed && !projectsCollapsed ? { flex: `0 0 ${100 - sectionSplit}%` } : undefined}
          >
            <div className={styles.sectionHeader} onClick={toggleProjectsCollapsed}>
              {projectsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span className={styles.sectionTitle}>Issues</span>
              <span className={styles.segmentCount}>{visibleFeatures.length}</span>
            </div>
            {!projectsCollapsed && (
              <div className={styles.sectionBody}>
                <IssuesPaneFilterRow
                  filter={treeFilter}
                  onFilterChange={setTreeFilter}
                />
                <ProjectMembershipBoundary
                  selectedProject={selectedProject} projectKey={selectedRegisteredProject?.key ?? selectedProjectData?.key}
                  projectName={selectedProjectData?.name}
                  loading={isLoading && !selectedProjectData}
                  disabled={isProjectValidationPending || Boolean(registeredProjectsError) || showUnknownProject}
                >
                  {selectedProjectData ? (
                    <ProjectNode
                      key={selectedProjectData.path} projectKey={selectedProjectData.key}
                    name={selectedProjectData.name}
                    features={visibleFeatures}
                    selectedFeature={selectedFeature}
                    onSelectFeature={handleSelectFeature}
                    onSelectProject={handleSelectProject}
                    selectedProject={selectedProject}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={handleSelectSession}
                    issueTitles={issueTitles}
                    issueCosts={issueCosts}
                    filter={treeFilter}
                    onStopSession={handleStopSession}
                    onViewTerminal={handleViewTerminal}
                    onPauseSession={handlePauseSession}
                    onResumeSession={handleResumeSession}
                    onUnpauseSession={handleUnpauseSession}
                    onRestartSession={handleRestartSession}
                    onDeepWipe={handleDeepWipe}
                    onOpenStateDir={handleOpenStateDir}
                    onViewJsonl={handleViewJsonl}
                    onCleanupOrphanedResources={handleCleanupOrphanedResources}
                    onOpenPlanDialog={handleOpenPlanDialog}
                    onNewConversation={handleNewProjectConversation}
                    containerStats={containerStats}
                  />
                  ) : (
                    <div className={styles.emptyProject}>No issues for this project</div>
                  )}
                </ProjectMembershipBoundary>
              </div>
            )}
          </div>
          </div>

          {projectConvMutations.forkTarget && (
            <ForkModal
              conversation={projectConvMutations.forkTarget}
              initialMode={projectConvMutations.forkTargetMode}
              initialFocus={projectConvMutations.forkTargetFocus}
              isPending={projectConvMutations.isForkPending}
              onClose={projectConvMutations.closeForkModal}
              onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey, handoffExtras) => {
                projectConvMutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey, handoffExtras);
              }}
            />
          )}

          {versionData && (
            <div className={styles.sidebarFooter}>
              <span className={styles.versionLabel}>v{versionData.version}</span>
            </div>
          )}
        </div>

        {/* Resize Handle */}
        <div
          className={styles.resizeHandle}
          onMouseDown={handleMouseDown}
        />

        {/* Content Area — the project-scoped deck (PAN-1561) */}
        <div className={styles.content}>
          {conversationRouteError && <p role="alert">{conversationRouteError.message}</p>}
          {isProjectValidationPending ? <ProjectPendingState onRetry={() => void refetchRegisteredProjects()} />
          : registeredProjectsError ? <ProjectRegistryErrorState onRetry={() => void refetchRegisteredProjects()} />
          : showUnknownProject ? (
            <UnknownProjectState project={selectedProject!} registeredProjects={registeredProjects} onSelectProject={onSelectProject} />
          ) : selectedProject ? (
            <Stage
              key={selectedProject}
              deckKey={selectedProject}
              conversations={conversations}
              resolveSession={resolveSession}
              onCreateConversation={createDeckConversation}
              onActiveConversationChange={setSelectedConversation}
              onActiveIssueChange={handleActiveIssuePane}
              terminalCwd={selectedRegisteredProject?.path}
              renderHome={(api) => (
                <ProjectHome
                  projectName={isNoProject ? NO_PROJECT_LABEL : selectedProject}
                  projectKey={selectedRegisteredProject?.key}
                  conversations={projectConvs}
                  onCreateConversation={createDeckConversation}
                  features={visibleFeatures}
                  issueCosts={issueCosts}
                  issueCostDetails={issueCostDetails}
                  onSelectFeature={(feature) => handleSelectFeature(feature.issueId)}
                  api={api}
                />
              )}
              renderIssue={(issueId, api) => {
                const info = resolveIssue(issueId);
                return (
                  <IssueOverview
                    issueId={issueId}
                    title={info.title}
                    branch={info.branch}
                    projectName={selectedProject ?? undefined}
                    createdAt={info.createdAt}
                    agentId={info.agentId}
                    conversations={conversations}
                    onCreateConversation={createDeckConversation}
                    api={api}
                  />
                );
              }}
            />
          ) : (
            <DeckEmptyState onStartWithoutProject={() => onSelectProject?.(NO_PROJECT_KEY)} />
          )}
        </div>

        {/* Awareness rail (PAN-1591) — the merged feed: one column with a
            Needs-you / Project / Global scope switcher, replacing the separate
            Project Activity + global Activity Feed columns. */}
        {selectedProject && !isProjectValidationPending && !registeredProjectsError && !showUnknownProject && (
          awarenessCollapsed ? (
            <button
              type="button"
              className={styles.activityColumnCollapsed}
              onClick={() => toggleAwareness(false)}
              title="Show Awareness"
              aria-label="Show Awareness rail"
            >
              <ChevronLeft size={16} />
              <span className={styles.activityCollapsedLabel}>Awareness</span>
            </button>
          ) : (
            <div className={styles.activityColumn}>
              <SessionFeedSidebar
                embedded
                heading="Awareness"
                scopeSwitcher
                projectIssueIds={isNoProject ? undefined : projectIssueIds}
                projectConversationIds={isNoProject ? undefined : projectConvIdSet}
                onClose={() => toggleAwareness(true)}
              />
            </div>
          )
        )}
      </div>

      {/* Tasks Dialog */}
      {showTasks && selectedFeature && (
        <TasksDialog
          issueId={selectedFeature}
          isOpen={showTasks}
          onClose={() => setShowTasks(false)}
        />
      )}

      {planDialogIssue && (
        <PlanDialog
          issue={planDialogIssue}
          isOpen={true}
          onClose={() => setPlanDialogIssue(null)}
          onComplete={async () => {
            setPlanDialogIssue(null);
            await refreshDashboardState(queryClient);
          }}
        />
      )}
    </div>
  );
}
