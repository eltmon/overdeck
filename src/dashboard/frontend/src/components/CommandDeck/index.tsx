import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Plus, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { ProjectNode, ProjectFeature } from './ProjectTree/ProjectNode';
import { type TreeSessionFilter } from './ProjectTree/FeatureItem';
import { type IssueCostBreakdown } from './ProjectOverview';
import { Stage } from '../Stage';
import { ProjectHome } from '../Stage/ProjectHome';
import { IssueOverview } from '../Stage/IssueOverview';
import { SessionFeedSidebar } from '../sessionFeed/SessionFeedSidebar';
import { usePanesStore } from '../../lib/panesStore';
import { fetchProjects, isUnscopedConversation, NO_PROJECT_KEY, NO_PROJECT_LABEL } from './projectsData';
import { BeadsDialog } from '../BeadsDialog';
import { PlanDialog } from '../PlanDialog';
import { ConversationList, type Conversation } from './ConversationList';
import { useConversationMutations } from './useConversationMutations';
import { ForkModal } from './ForkModal';
import { type ViewMode } from '../chat/ConversationPanel';
import { ModelPicker, loadStoredHarness, loadStoredModel, saveStoredHarness, saveStoredModel } from '../chat/ModelPicker';
import type { Harness } from '../shared/ModelPicker';
import type { Agent, Issue, StartAgentResponse } from '../../types';
import { useDashboardStore, selectAgents } from '../../lib/store';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../lib/pending-codex-spawn';
import { getDirectRestartRequest } from '../../lib/restartRouting';
import { useConfirm } from '../DialogProvider';
import { WS_METHODS } from '@overdeck/contracts';
import type { ProjectSessionTree, SessionTreeDelta } from '@overdeck/contracts';
import styles from './styles/command-deck.module.css';
import { fetchWithTimeout } from '../../lib/apiFetch';

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetchWithTimeout('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

interface IssueCostEntry {
  issueId: string;
  totalCost: number;
  byModel: IssueCostBreakdown['byModel'];
  byStage: IssueCostBreakdown['byStage'];
}

async function fetchCostsByIssue(): Promise<{ issues: IssueCostEntry[] }> {
  const res = await fetch('/api/costs/by-issue');
  if (!res.ok) throw new Error('Failed to fetch costs');
  return res.json();
}

async function fetchVersion(): Promise<{ version: string }> {
  const res = await fetch('/api/version');
  if (!res.ok) throw new Error('Failed to fetch version');
  return res.json();
}

interface RegisteredProject {
  key: string;
  name: string;
  path: string;
}

async function fetchRegisteredProjects(): Promise<RegisteredProject[]> {
  const res = await fetch('/api/registered-projects');
  if (!res.ok) throw new Error('Failed to fetch registered projects');
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchAllSessionTrees(projectKeys: string[]): Promise<ProjectSessionTree[]> {
  if (projectKeys.length === 0) return [];
  const res = await fetch(`/api/session-trees?projects=${encodeURIComponent(projectKeys.join(','))}`);
  if (!res.ok) throw new Error('Failed to fetch session trees');
  const data = await res.json() as { trees: ProjectSessionTree[] };
  return data.trees;
}

/** Apply a live delta to a cached ProjectSessionTree. Returns a new object or undefined if not applicable.
 *  Optimized to O(F + S) per delta by finding the target feature/session by index instead of nested scans.
 */
function applySessionTreeDelta(tree: ProjectSessionTree, delta: SessionTreeDelta): ProjectSessionTree {
  const deltaIssueIdLower = delta.issueId.toLowerCase();
  const featureIdx = tree.features.findIndex(f => f.issueId.toLowerCase() === deltaIssueIdLower);
  if (featureIdx === -1) return tree;

  const feature = tree.features[featureIdx];
  if (!feature) return tree;

  switch (delta.kind) {
    case 'session_added': {
      // Lightweight delta — invalidate to trigger refetch
      return tree;
    }
    case 'session_removed': {
      const filtered = feature.sessions.filter(s => s.sessionId !== delta.sessionId);
      if (filtered.length === feature.sessions.length) return tree;
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: filtered };
      return { ...tree, features: newFeatures };
    }
    case 'presence_changed':
    case 'status_changed': {
      const sessionIdx = feature.sessions.findIndex(s => s.sessionId === delta.sessionId);
      if (sessionIdx === -1) return tree;
      const newSessions = [...feature.sessions];
      newSessions[sessionIdx] = {
        ...feature.sessions[sessionIdx]!,
        ...(delta.presence !== undefined && { presence: delta.presence }),
        ...(delta.status !== undefined && { status: delta.status }),
      };
      const newFeatures = [...tree.features];
      newFeatures[featureIdx] = { ...feature, sessions: newSessions };
      return { ...tree, features: newFeatures };
    }
    default:
      return tree;
  }
}

interface ContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkIn: number;
  networkOut: number;
  status: 'running' | 'stopped' | 'unhealthy' | 'restarting';
}

interface CommandDeckProps {
  issues?: Issue[];
  /** Deep-link conversation ID — selects this conversation on mount */
  convId?: string | null;
  conversationViewMode?: ViewMode;
  pendingConversationTarget?: {
    conversationName: string;
    messageId: string;
    messageIndex: number;
    nonce: number;
    label: string;
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

export function CommandDeck({
  issues = [],
  convId,
  pendingConversationTarget = null,
  onPendingConversationTargetConsumed,
  onConvIdChange,
  selectedProject = null,
  onSelectProject,
  onProjectPrefixChange,
  cockpitIssue = null,
  onCockpitChange,
}: CommandDeckProps) {
  const [projectQueryEpoch, bumpProjectQueryEpoch] = useReducer((value: number) => value + 1, 0);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  // PAN-1591: the Awareness rail can be collapsed to reclaim pane width.
  const [awarenessCollapsed, setAwarenessCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('overdeck.ui.awarenessCollapsed') === 'true',
  );
  const toggleAwareness = useCallback((collapsed: boolean) => {
    setAwarenessCollapsed(collapsed);
    try { localStorage.setItem('overdeck.ui.awarenessCollapsed', String(collapsed)); } catch { /* ignore */ }
  }, []);
  const [showBeads, setShowBeads] = useState(false);
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

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['command-deck-projects', projectQueryEpoch],
    queryFn: fetchProjects,
    refetchInterval: 30000,
  });

  const { data: costData } = useQuery({
    queryKey: ['costs-by-issue'],
    queryFn: fetchCostsByIssue,
    refetchInterval: 15000,
  });

  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });

  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: fetchVersion,
    staleTime: Infinity,
  });

  // ── Session Tree (PAN-821) ───────────────────────────────────────────────────
  // Fetch all session trees in a single request to avoid N+1 HTTP waterfall
  const projectNamesKey = useMemo(() => projects.map(p => p.name).join(','), [projects]);
  const { data: sessionTrees = [] } = useQuery({
    queryKey: ['session-trees', projectNamesKey],
    queryFn: () => fetchAllSessionTrees(projects.map(p => p.name)),
    enabled: projects.length > 0,
  });

  const sessionTreeDataRef = useRef<Record<string, ProjectSessionTree>>({});
  const sessionTreeMap = useMemo(() => {
    const map: Record<string, ProjectSessionTree> = {};
    let changed = false;
    for (const tree of sessionTrees) {
      map[tree.projectKey] = tree;
      if (sessionTreeDataRef.current[tree.projectKey] !== tree) changed = true;
    }
    if (!changed && Object.keys(map).length === Object.keys(sessionTreeDataRef.current).length) {
      return sessionTreeDataRef.current;
    }
    sessionTreeDataRef.current = map;
    return map;
  }, [sessionTrees]);

  // Track current project names key for delta handlers (avoids stale closure)
  // Subscribe to live session tree deltas for each project
  useEffect(() => {
    const transport = getTransport();
    const unsubscribes: Array<() => void> = [];

    for (const project of projects) {
      const unsubscribe = transport.subscribe(
        (client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.subscribeProjectSessionTree]({
            projectKey: project.name,
          }) as unknown as import('effect').Stream.Stream<SessionTreeDelta, Error>,
        (delta) => {
          const bulkKey = ['session-trees', projectNamesKey] as const;
          const bulkData = queryClient.getQueryData<ProjectSessionTree[]>(bulkKey);
          if (!bulkData) return;
          const tree = bulkData.find(t => t.projectKey === project.name);
          if (!tree) return;
          if (delta.kind === 'session_added') {
            void queryClient.invalidateQueries({ queryKey: bulkKey, exact: true });
            return;
          }

          const updated = applySessionTreeDelta(tree, delta);
          if (updated === tree) return;
          const newBulkData = bulkData.map(t => t.projectKey === project.name ? updated : t);
          queryClient.setQueryData(bulkKey, newBulkData);
        },
      );
      unsubscribes.push(unsubscribe);
    }

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [projectNamesKey, projects, queryClient]);

  // Merge session trees into project features, preserving object identity
  // for features whose sessions haven't changed (avoids O(total features)
  // re-renders per delta — only features in the affected project re-render).
  const projectsWithSessions = useMemo(() => {
    return projects.map(project => {
      const tree = sessionTreeMap[project.name];
      if (!tree) return project;

      const featureSessions = new Map<string, readonly import('@overdeck/contracts').SessionNode[]>();
      for (const feature of tree.features) {
        featureSessions.set(feature.issueId.toLowerCase(), feature.sessions);
      }

      let featuresChanged = false;
      const nextFeatures = project.features.map((feature: ProjectFeature) => {
        const treeSessions = featureSessions.get(feature.issueId.toLowerCase());
        if (!treeSessions && !feature.sessions) return feature;
        if (treeSessions === feature.sessions) return feature;
        featuresChanged = true;
        return { ...feature, sessions: treeSessions ?? feature.sessions };
      });
      if (!featuresChanged) return project;
      return { ...project, features: nextFeatures };
    });
  }, [projects, sessionTreeMap]);

  useEffect(() => {
    if (selectedProject || !onSelectProject) return;
    const projectsWithFeatures = projectsWithSessions.filter((project) => project.features.length > 0);
    if (projectsWithFeatures.length === 1) {
      onSelectProject(projectsWithFeatures[0]!.name);
    }
  }, [onSelectProject, projectsWithSessions, selectedProject]);

  const [containerStats, setContainerStats] = useState<Record<string, ContainerStats>>({});

  // Poll container stats every 5s when issues have containers
  useEffect(() => {
    const hasContainers = projectsWithSessions.some((p) =>
      p.features.some((f) => (f.resourceDetails?.dockerContainerCount ?? 0) > 0),
    );
    if (!hasContainers) return;

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/resources');
        if (!res.ok) return;
        const data = (await res.json()) as { containers: ContainerStats[] };
        const byName: Record<string, ContainerStats> = {};
        for (const c of data.containers) {
          byName[c.name] = c;
        }
        setContainerStats(byName);
      } catch {
        // ignore
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [projectsWithSessions]);

  // Agents from the dashboard store — used to scope issue tabs' Files/Commits
  // panes to the issue's workspace agent (PAN-1561).
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];

  // PAN-1985: confirmation for the destructive harness/model switch paths on
  // work and review sessions. Resumed sessions (no model/harness change) skip
  // the dialog.
  const confirm = useConfirm();

  // Map aggregated costs per issue for the project tree sidebar and project overview.
  const { issueCosts, issueCostDetails } = useMemo(() => {
    const costs: Record<string, number> = {};
    const detailsByIssue: Record<string, IssueCostBreakdown> = {};

    for (const entry of costData?.issues || []) {
      costs[entry.issueId] = entry.totalCost;
      costs[entry.issueId.toLowerCase()] = entry.totalCost;

      const details: IssueCostBreakdown = {
        byModel: entry.byModel ?? {},
        byStage: entry.byStage ?? {},
      };
      detailsByIssue[entry.issueId] = details;
      detailsByIssue[entry.issueId.toLowerCase()] = details;
    }

    return { issueCosts: costs, issueCostDetails: detailsByIssue };
  }, [costData]);

  // Build title map from issues (memoized to avoid new object identity per render)
  const issueTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const issue of issues) {
      if (!issue.identifier) continue;
      map[issue.identifier.toLowerCase()] = issue.title;
      map[issue.identifier] = issue.title;
    }
    return map;
  }, [issues]);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });

  // Partition conversations into project-scoped vs unscoped
  const { projectConversations } = useMemo(() => {
    const map: Record<string, import('./ConversationList').Conversation[]> = {};
    const excludeSet = new Set<number>();
    if (!Array.isArray(registeredProjects) || registeredProjects.length === 0) return { projectConversations: map, excludeConvIds: excludeSet };

    const pathToKeys = new Map<string, string[]>();
    for (const rp of registeredProjects) {
      if (!rp.path) continue;
      const keys = Array.from(new Set([rp.key, rp.name].filter((key): key is string => Boolean(key))));
      pathToKeys.set(rp.path.replace(/\/+$/, ''), keys);
    }

    for (const conv of conversations) {
      if (!conv.cwd) continue;
      const cwd = conv.cwd.replace(/\/+$/, '');
      for (const [projectPath, projectKeys] of pathToKeys) {
        if (cwd === projectPath || cwd.startsWith(projectPath + '/')) {
          for (const projectKey of projectKeys) {
            if (!map[projectKey]) map[projectKey] = [];
            map[projectKey].push(conv);
          }
          excludeSet.add(conv.id);
          break;
        }
      }
    }

    return { projectConversations: map, excludeConvIds: excludeSet };
  }, [conversations, registeredProjects]);

  // Track the last deep-link ID we applied so we only navigate for *new* deep-links
  // (e.g. popstate), not on every conversations refetch.
  const appliedConvId = useRef<string | null>(null);
  // PAN-2005: same idea for the issue cockpit deep-link (/command-deck/<proj>/<issue>).
  const appliedCockpit = useRef<string | null>(null);

  // Resolve the registered project (by name) that owns a conversation's cwd,
  // or null when the conversation is unscoped — cwd not under any registered
  // project (e.g. created without a projectKey, so cwd defaults to ~/Projects).
  const resolveConversationProjectName = useCallback(
    (conv: Conversation | null | undefined): string | null => {
      if (!conv?.cwd) return null;
      const cwd = conv.cwd;
      const matched = registeredProjects.find(
        (rp) => !!rp.path && (cwd === rp.path || cwd.startsWith(rp.path + '/')),
      );
      return matched ? (matched.name ?? matched.key) : null;
    },
    [registeredProjects],
  );

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
    messageIndex: number;
    nonce: number;
  }, viewMode?: ViewMode) => {
    const store = usePanesStore.getState();
    store.ensureHome(projectKey);
    const panes = store.panesByWorkspace[projectKey] ?? [];
    const existing = panes.find((p) => p.paneType === 'agent' && p.conversationId === name);
    const paneId = existing ? existing.paneId : store.addPane(projectKey, { paneType: 'agent', label, conversationId: name, ...(viewMode ? { viewMode } : {}) });
    store.setActivePane(projectKey, paneId);
    if (target) {
      usePanesStore.getState().updatePane(projectKey, paneId, {
        targetMessageId: target.messageId,
        targetMessageIndex: target.messageIndex,
        targetMessageNonce: target.nonce,
      });
    }
  }, []);

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
    if (!convId || conversations.length === 0) return;
    if (convId === appliedConvId.current) return;
    const conv = conversations.find((c) => String(c.id) === convId || c.name === convId);
    if (conv) {
      setSelectedConversation(conv.name);
      setSelectedFeature(null);
      const projectName = resolveConversationProjectName(conv) ?? NO_PROJECT_KEY;
      const target = pendingConversationTarget?.conversationName === conv.name
        ? {
            messageId: pendingConversationTarget.messageId,
            messageIndex: pendingConversationTarget.messageIndex,
            nonce: pendingConversationTarget.nonce,
          }
        : undefined;
      // Opening a conversation: the /conv/<id> route owns the URL, so switch the
      // deck's project without writing /command-deck/<project> over it.
      onSelectProject?.(projectName, { updateUrl: false });
      openConversationTabIn(projectName, conv.name, pendingConversationTarget?.label ?? conv.title ?? 'Agent', target);
      if (target) onPendingConversationTargetConsumed?.();
      appliedConvId.current = convId;
    }
  }, [convId, conversations, resolveConversationProjectName, onSelectProject, openConversationTabIn, pendingConversationTarget, onPendingConversationTargetConsumed]);

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
      onConvIdChange(String(conv.id));
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
      bumpProjectQueryEpoch();
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
        ? (agents as unknown as Agent[]).find((a) => a.id === sessionId)
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
          ? 'Restart review with new harness/model'
          : 'Restart work agent with new harness/model';
        const reviewMessage = `This will delete the review agent's state for ${issueId} (sessions, activity, logs) and start a fresh review run with the chosen harness/model.\n\nThe workspace, vBRIEF, beads, and commit history are kept. The review will have to re-research the diff from scratch — this is a deliberate cost of switching harness/model or force-restarting the review.`;
        const workMessage = `This will delete the work agent's state for ${issueId} (sessions, activity, logs) and start a fresh ${harness ?? currentHarness ?? ''} + ${model ?? currentModel ?? ''} agent.\n\nThe workspace, vBRIEF, beads, and commit history are kept. The new agent will read .pan/continue.json and the branch to continue. The agent will have to re-research the diff from scratch — this is a deliberate cost of switching harness/model.`;
        const confirmed = await confirm({
          title: confirmTitle,
          message: isDestructiveReview ? reviewMessage : workMessage,
          confirmLabel: isDestructiveReview ? 'Restart review' : 'Restart work agent',
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
      const resumeData = await resumeRes.json().catch(() => ({})) as { success?: boolean; error?: string; lifecycle?: { canResumeSession?: boolean; hasLiveTmuxSession?: boolean; isRunning?: boolean } };
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
          throw new Error(retryData.error || 'Failed to restart agent');
        }
        toast.success('Agent restarted');
        await refreshDashboardState(queryClient);
        return;
      }
      // Only fall through to start-fresh when there is genuinely no session to resume.
      const noSession = resumeData.lifecycle?.canResumeSession === false && !resumeData.lifecycle?.hasLiveTmuxSession;
      if (!noSession) {
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
        throw new Error(data.error || data.hint || 'Failed to start agent');
      }
      if (data.guardrails?.warnings?.length) {
        toast.success('Agent started after acknowledging system health warnings.', { duration: 6000 });
      }
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restart session');
    }
  }, [queryClient, projectsWithSessions, sessionTreeMap, confirm, agents]);

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
    const found = issues.find(i => i.identifier.toLowerCase() === issueId.toLowerCase());
    // Never silently no-op: if the issue isn't in the loaded `issues` list (filtered/
    // paginated/out-of-sync), synthesize a minimal one so the dialog still opens.
    const issue = found ?? ({
      id: issueId, identifier: issueId, title: issueId, status: 'Todo',
      priority: 0, labels: [], url: '', createdAt: '', updatedAt: '',
    } as unknown as Issue);
    setPlanDialogIssue(issue);
  }, [issues]);

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
        onConvIdChange(String(conv.id));
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
  // name so the deck's launch components can focus the tab.
  const createConversationForProject = useCallback(
    async (projectKey?: string, harnessOverride?: Harness, message?: string, viewMode?: ViewMode): Promise<string | undefined> => {
      try {
        const payload: Record<string, unknown> = {
          model: sidebarModel,
          harness: harnessOverride ?? sidebarHarness,
        };
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
          appliedConvId.current = newId;
          prevSelectedRef.current = conv.name;
        }
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        return conv.name;
      } catch (err) {
        console.error('[CommandDeck] Failed to create conversation:', err);
        toast.error(err instanceof Error ? err.message : 'Failed to create conversation');
        return undefined;
      }
    },
    [sidebarModel, sidebarHarness, queryClient, onConvIdChange, convsCollapsed, selectedProject, openConversationTabIn],
  );

  const handleNewConversation = useCallback(() => {
    const projectKey = selectedProject && selectedProject !== NO_PROJECT_KEY ? selectedProject : undefined;
    void createConversationForProject(projectKey);
  }, [createConversationForProject, selectedProject]);

  const handleNewProjectConversation = useCallback((projectKey: string) => {
    void createConversationForProject(projectKey);
  }, [createConversationForProject]);

  // Launch-component conversation creator (ProjectHome / IssueOverview): create
  // a project conversation for the chosen agent and return its name so the deck
  // can open/focus an agent tab on it.
  const createDeckConversation = useCallback(
    (agentId: string, message?: string, viewMode?: ViewMode): Promise<string | undefined> => {
      const harness: Harness = agentId === 'codex' ? 'codex' : agentId === 'ohmypi' ? 'ohmypi' : 'claude-code';
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

  const selectedProjectData = useMemo(() => {
    if (!selectedProject) return null;
    return projectsWithSessions.find(p => p.name === selectedProject) ?? null;
  }, [projectsWithSessions, selectedProject]);

  // ── Project-scoped deck data (PAN-1561) ──────────────────────────────────────
  // For a real project: its scoped conversations + issue ids. For the special
  // "No project" bucket: conversations not under any registered project.
  const isNoProject = selectedProject === NO_PROJECT_KEY;
  const unscopedConversations = useMemo(
    () => conversations.filter((c) => isUnscopedConversation(c, registeredProjects)),
    [conversations, registeredProjects],
  );
  const projectConvs = useMemo(
    () =>
      isNoProject
        ? unscopedConversations
        : selectedProject
          ? (projectConversations[selectedProject] ?? [])
          : [],
    [isNoProject, unscopedConversations, selectedProject, projectConversations],
  );
  const projectConvIdSet = useMemo(() => new Set(projectConvs.map(c => c.id)), [projectConvs]);
  const projectIssueIds = useMemo(
    () => (selectedProjectData?.features ?? []).map(f => f.issueId),
    [selectedProjectData],
  );

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
      const createdAt = issues.find(i => i.identifier === issueId)?.createdAt;
      const branch = selectedProjectData?.features.find(f => f.issueId === issueId)?.branch;
      const agentId =
        agents.find(a => a.issueId?.toLowerCase() === key && a.id.startsWith('agent-'))?.id
        ?? agents.find(a => a.issueId?.toLowerCase() === key)?.id;
      return { title, createdAt, branch, agentId };
    },
    [issueTitles, issues, selectedProjectData, agents],
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
                <ModelPicker
                  value={sidebarModel}
                  onChange={(modelId) => {
                    setSidebarModel(modelId);
                    saveStoredModel(modelId);
                  }}
                  harness={sidebarHarness}
                  onHarnessChange={(harness) => {
                    setSidebarHarness(harness);
                    saveStoredHarness(harness);
                  }}
                />
                <button
                  className={styles.conversationAddBtn}
                  onClick={handleNewConversation}
                  title="New conversation"
                  aria-label="New conversation"
                >
                  <Plus size={13} />
                </button>
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
              <span className={styles.segmentCount}>{selectedProjectData?.features.length ?? 0}</span>
            </div>
            {!projectsCollapsed && (
              <div className={styles.sectionBody}>
                <div className={styles.treeFilterRow}>
                  {(['all', 'alive', 'failed'] as TreeSessionFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setTreeFilter(f)}
                      className={`${styles.treeFilterButton} ${treeFilter === f ? styles.treeFilterButtonActive : ''}`}
                    >
                      {f === 'all' ? 'All' : f === 'alive' ? 'Alive' : 'Failed'}
                    </button>
                  ))}
                </div>
                {!selectedProject ? (
                  <div className={styles.emptyProject}>Select a project to see its issues</div>
                ) : isLoading && !selectedProjectData ? (
                  <div className={styles.skeletonList}>
                    <div className={styles.skeletonItem} style={{ width: '60%' }} />
                    <div className={styles.skeletonItem} style={{ width: '80%' }} />
                    <div className={styles.skeletonItem} style={{ width: '45%' }} />
                  </div>
                ) : selectedProjectData ? (
                  <ProjectNode
                    key={selectedProjectData.path}
                    name={selectedProjectData.name}
                    features={selectedProjectData.features}
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
              onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness) => {
                projectConvMutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness);
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
          {selectedProject ? (
            <Stage
              key={selectedProject}
              deckKey={selectedProject}
              conversations={conversations}
              resolveSession={resolveSession}
              onCreateConversation={createDeckConversation}
              onActiveConversationChange={setSelectedConversation}
              terminalCwd={
                registeredProjects.find((rp) => (rp.name ?? rp.key) === selectedProject)?.path
              }
              renderHome={(api) => (
                <ProjectHome
                  projectName={isNoProject ? NO_PROJECT_LABEL : selectedProject}
                  projectKey={registeredProjects.find((rp) => (rp.name ?? rp.key) === selectedProject)?.key}
                  conversations={projectConvs}
                  onCreateConversation={createDeckConversation}
                  features={selectedProjectData?.features}
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
            <div className={styles.contentEmpty}>
              <div style={{ textAlign: 'center' }}>
                <Compass size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
                <p>Select a project to open its deck</p>
              </div>
            </div>
          )}
        </div>

        {/* Awareness rail (PAN-1591) — the merged feed: one column with a
            Needs-you / Project / Global scope switcher, replacing the separate
            Project Activity + global Activity Feed columns. */}
        {selectedProject && (
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
                onClose={() => toggleAwareness(true)}
              />
            </div>
          )
        )}
      </div>

      {/* Beads Dialog */}
      {showBeads && selectedFeature && (
        <BeadsDialog
          issueId={selectedFeature}
          isOpen={showBeads}
          onClose={() => setShowBeads(false)}
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
