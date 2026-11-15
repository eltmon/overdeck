import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useShortcut, type ShortcutDef } from '../../lib/shortcuts/registry';
import { useShallow } from 'zustand/react/shallow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { ProjectNode } from './ProjectTree/ProjectNode';
import { type TreeSessionFilter } from './ProjectTree/FeatureItem';
import { Stage } from '../Stage';
import { ProjectHome } from '../Stage/ProjectHome';
import { IssueOverview } from '../Stage/IssueOverview';
import { SessionFeedSidebar } from '../sessionFeed/SessionFeedSidebar';
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
import { NewConversationSplitButton } from '../newConversation/NewConversationSplitButton';
import type { Issue } from '../../types';
import { useDashboardStore } from '../../lib/store';
import { useAgentSetInvalidation } from '../../lib/useAgentSetInvalidation';
import { agentIdsByIssueKey, issueCreatedAtById, issueTitlesByKey } from './agentIdsByIssueKey';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
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
import { openIssueTabIn, useDeckDialogs, useIssueSessionActions } from '../frame/deck/useIssueSessionActions';
import { useNewConversationDefaults } from '../frame/deck/newConversationDefaults';
import { useCreateConversation } from '../frame/deck/useCreateConversation';
import { useOpenConversation } from '../frame/deck/useOpenConversation';
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
  const planDialogIssue = useDeckDialogs((s) => s.planDialogIssue);
  const setPlanDialogIssue = useDeckDialogs.getState().setPlanDialogIssue;
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
  const { model: sidebarModel, harness: sidebarHarness, effort: sidebarEffort, setModel: setSidebarModel, setHarness: setSidebarHarness, setEffort: setSidebarEffort } =
    useNewConversationDefaults(useShallow((d) => ({ model: d.model, harness: d.harness, effort: d.effort, setModel: d.setModel, setHarness: d.setHarness, setEffort: d.setEffort })));

  // Per-issue session selection (PAN-830 pan-11sr) — slice keyed by issueId.
  // The tree highlight uses the value for whichever feature is currently active.
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

  const { projects, projectsWithSessions, isLoading } = useDeckProjects();
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


  const { data: conversationList = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  const { conversations, error: conversationRouteError } = usePriorityConversation(convId, conversationList);

  const {
    handleSelectFeature, handleSelectSession, handleStopSession, handleCleanupOrphanedResources, handleViewTerminal,
    handlePauseSession, handleResumeSession, handleUnpauseSession, handleRestartSession, handleDeepWipe,
    handleOpenStateDir, handleOpenPlanDialog, handleViewJsonl,
  } = useIssueSessionActions(selectedProject);
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

  const openConversationTabIn = useCallback((projectKey: string, name: string, label: string, target?: {
    messageId: string;
    messageIndex?: number;
    nonce: number;
    subagentId?: string;
  }, viewMode?: ViewMode) => openConversationTab(projectKey, name, label, target, viewMode), []);

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
  }, [cockpitIssue, onSelectProject, registeredProjects]);

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

  // Reverse sync from the Stage: clicking an issue pane tab bypasses
  // handleSelectFeature, so mirror the selection here to keep the cockpit URL
  // (/command-deck/<project>/<issue>) following the visible view.
  const handleActiveIssuePane = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedConversation(null);
  }, []);

  // Resolve a session id → its live SessionNode for Stage's session-backed agent panes.
  const resolveSession = useCallback((sessionId: string) =>
    projectsWithSessions
      .flatMap((p) => p.features)
      .flatMap((f) => f.sessions ?? [])
      .find((s) => s.sessionId === sessionId),
  [projectsWithSessions]);


  // The project header in column 2 is a single (selected) project; clicking it
  // focuses the deck's HOME tab via the App sidebar's selection callback.
  const handleSelectProject = useCallback((projectName: string) => {
    onSelectProject?.(projectName);
    setSelectedFeature(null);
    setSelectedConversation(null);
  }, [onSelectProject]);

  // PAN-1561: selecting a conversation opens it as an agent tab in its project's
  // deck (switching project if it belongs to a different one than is shown).
  const keepUrlSyncInStep = useCallback((name: string) => { prevSelectedRef.current = name; }, []);
  const handleSelectConversation = useOpenConversation(selectedProject, { conversations, onOpened: keepUrlSyncInStep });

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
  // agent tab in the deck. The deck's own refs follow the new conversation so
  // its deep-link and URL-sync effects do not re-apply it.
  const onConversationCreated = useCallback((conv: Conversation) => {
    if (convsCollapsed) setConvsCollapsed(false);
    appliedConvId.current = `${String(conv.id)}::${conversationViewMode ?? 'conversation'}`;
    prevSelectedRef.current = conv.name;
  }, [convsCollapsed, conversationViewMode]);
  const { create: createConversationForProject, createForAgent: createDeckConversation } =
    useCreateConversation(selectedProject, onConversationCreated);

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
