import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { ProjectNode, ProjectFeature } from './ProjectTree/ProjectNode';
import { sessionMatchesFilter, type TreeSessionFilter } from './ProjectTree/FeatureItem';
import { ProjectOverview, type IssueCostBreakdown } from './ProjectOverview';
import { DeaconStatus } from './DeaconStatus';
import { IssueWorkbench } from './IssueWorkbench';
import { BeadsDialog } from '../BeadsDialog';
import { PlanDialog } from '../PlanDialog';
import { ConversationList, type Conversation } from './ConversationList';
import { useConversationMutations } from './useConversationMutations';
import { ForkModal } from './ForkModal';
import { ConversationPanel, type ViewMode } from '../chat/ConversationPanel';
import { ModelPicker, loadStoredHarness, loadStoredModel, saveStoredHarness, saveStoredModel } from '../chat/ModelPicker';
import type { AuthMode, Harness } from '../shared/ModelPicker';
import type { Agent, Issue, StartAgentResponse } from '../../types';
import { useDashboardStore, selectAgentList } from '../../lib/store';
import { useCommandDeckSelection } from '../../lib/commandDeckSelection';
import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport';
import { refreshDashboardState } from '../../lib/refresh-dashboard-state';
import { isCodexBlockedResponse, setPendingCodexSpawn } from '../../lib/pending-codex-spawn';
import { WS_METHODS } from '@panctl/contracts';
import type { ProjectSessionTree, SessionTreeDelta } from '@panctl/contracts';
import styles from './styles/command-deck.module.css';

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

interface ProjectData {
  name: string;
  path: string;
  features: ProjectFeature[];
}

function groupProjects(issues: ProjectFeature[]): ProjectData[] {
  const grouped = new Map<string, ProjectData>();

  for (const issue of issues) {
    const existing = grouped.get(issue.projectName);
    if (existing) {
      existing.features.push(issue);
      continue;
    }

    grouped.set(issue.projectName, {
      name: issue.projectName,
      path: issue.projectName,
      features: [issue],
    });
  }

  return [...grouped.values()]
    .map((project) => ({
      ...project,
      features: [...project.features].sort((a, b) => a.issueId.localeCompare(b.issueId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchProjects(): Promise<ProjectData[]> {
  const [issuesRes, registeredRes] = await Promise.all([
    fetch('/api/issues/resource-allocated'),
    fetch('/api/registered-projects'),
  ]);
  if (!issuesRes.ok) throw new Error('Failed to fetch resource-allocated issues');
  if (!registeredRes.ok) throw new Error('Failed to fetch registered projects');

  const issues = await issuesRes.json() as ProjectFeature[];
  const registered = await registeredRes.json() as { key: string; name: string; path: string }[];

  // Start with projects that have qualifying issues
  const projectMap = new Map(groupProjects(issues).map(p => [p.name, p]));

  // Add registered projects that have no qualifying issues (empty features list)
  for (const proj of registered) {
    const name = proj.name ?? proj.key;
    if (!projectMap.has(name)) {
      projectMap.set(name, { name, path: proj.path, features: [] });
    }
  }

  return [...projectMap.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  /** Called when the selected conversation changes so App can sync the URL */
  onConvIdChange?: (id: string | null) => void;
  onConversationViewModeChange?: (mode: ViewMode) => void;
}

const CONVS_COLLAPSED_KEY = 'mc-convs-collapsed';
const PROJECTS_COLLAPSED_KEY = 'mc-projects-collapsed';
const SECTION_SPLIT_KEY = 'mc-section-split';

export function CommandDeck({
  issues = [],
  convId,
  conversationViewMode = 'conversation',
  onConvIdChange,
  onConversationViewModeChange,
}: CommandDeckProps) {
  const [projectQueryEpoch, bumpProjectQueryEpoch] = useReducer((value: number) => value + 1, 0);
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
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
  const [anthropicAuthMode, setAnthropicAuthMode] = useState<AuthMode | undefined>(undefined);

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

      const featureSessions = new Map<string, readonly import('@panctl/contracts').SessionNode[]>();
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

  // Split projects into active (has features) and inactive (empty features from registered projects with no issues)
  const { activeProjects, inactiveProjects } = useMemo(() => {
    const active: typeof projects = [];
    const inactive: typeof projects = [];
    for (const project of projectsWithSessions) {
      if (project.features.length > 0) {
        active.push(project);
      } else {
        inactive.push(project);
      }
    }
    return { activeProjects: active, inactiveProjects: inactive };
  }, [projectsWithSessions]);

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

  // Agents from dashboard store (for terminal panel in detail view)
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

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
  const { projectConversations, excludeConvIds } = useMemo(() => {
    const map: Record<string, import('./ConversationList').Conversation[]> = {};
    const excludeSet = new Set<number>();
    if (!Array.isArray(registeredProjects) || registeredProjects.length === 0) return { projectConversations: map, excludeConvIds: excludeSet };

    const pathToKey = new Map<string, string>();
    for (const rp of registeredProjects) {
      if (rp.path) pathToKey.set(rp.path, rp.key);
    }

    for (const conv of conversations) {
      if (!conv.cwd) continue;
      for (const [projectPath, projectKey] of pathToKey) {
        if (conv.cwd === projectPath || conv.cwd.startsWith(projectPath + '/')) {
          if (!map[projectKey]) map[projectKey] = [];
          map[projectKey].push(conv);
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

  // On mount or when convId changes (popstate), apply the deep-link
  useEffect(() => {
    if (!convId || conversations.length === 0) return;
    if (convId === appliedConvId.current) return;
    const conv = conversations.find((c) => String(c.id) === convId);
    if (conv) {
      setSelectedConversation(conv.name);
      setSelectedProject(null);
      appliedConvId.current = convId;
    }
  }, [convId, conversations]);

  // Auto-select first conversation on initial load if no deep-link and no feature selected
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (conversations.length === 0 || convId || selectedConversation !== null || selectedFeature !== null || selectedProject !== null) return;
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
      const nextId = String(conv.id);
      if (nextId === convId) return;
      onConvIdChange(nextId);
    }
  }, [selectedConversation, conversations, onConvIdChange, convId]);

  const handleSelectFeature = useCallback((issueId: string) => {
    setSelectedFeature(issueId);
    setSelectedProject(null);
    setSelectedConversation(null);

    // Auto-select the active work agent session so the user lands in
    // conversation view instead of the overview with a disabled composer.
    const feature = projectsWithSessions
      .flatMap(p => p.features)
      .find(f => f.issueId === issueId);
    const activeWorkSession = feature?.sessions?.find(
      (s) => s.presence === 'active' && s.type === 'work',
    );
    selectSession(issueId, activeWorkSession?.sessionId ?? null);
  }, [selectSession, projectsWithSessions]);

  const handleSelectSession = useCallback((issueId: string, sessionId: string) => {
    setSelectedFeature(issueId);
    setSelectedProject(null);
    selectSession(issueId, sessionId);
    setSelectedConversation(null);
  }, [selectSession]);

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
    // Find which issue owns this session and select it
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          setSelectedProject(null);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession]);

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
      const res = await fetch(`/api/agents/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Resumed from dashboard' }),
      });
      if (!res.ok) throw new Error('Failed to resume session');
      await refreshDashboardState(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume session');
    }
  }, [queryClient]);

  const handleRestartSession = useCallback(async (sessionId: string, issueId: string, sessionType?: string, role?: string, model?: string) => {
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

      if (sessionType === 'review') {
        // Restart all reviewers — kill coordinator + all 5, then re-dispatch.
        // Guard here so review sessions never fall through to the work-agent restart path.
        if (!projectKey) throw new Error(`Cannot find project for ${issueId}`);
        const res = await fetch(`/api/specialists/${encodeURIComponent(projectKey)}/${encodeURIComponent(issueId)}/review/restart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to restart review');
        toast.success('Review restarted');
        await refreshDashboardState(queryClient);
        return;
      }

      if (sessionType === 'reviewer' && role) {
        // Restart single reviewer role.
        // Guard here so reviewer sessions never fall through to the work-agent restart path.
        if (!projectKey) throw new Error(`Cannot find project for ${issueId}`);
        const res = await fetch(`/api/specialists/${encodeURIComponent(projectKey)}/${encodeURIComponent(issueId)}/reviewer/${encodeURIComponent(role)}/restart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed to restart ${role} reviewer`);
        toast.success(`${role} reviewer restarted`);
        await refreshDashboardState(queryClient);
        return;
      }

      // Default: work agent restart. Try resume first — Claude sessions are never
      // discarded. Only start fresh if the agent has no saved session to resume.
      const resumeRes = await fetch(`/api/agents/${sessionId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model ? { model } : {}),
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
          body: JSON.stringify(model ? { model } : {}),
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
  }, [queryClient, projectsWithSessions, sessionTreeMap]);

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
    const path = `~/.panopticon/agents/${sessionId}/`;
    navigator.clipboard?.writeText(path).catch(() => { /* ignore */ });
  }, []);

  const handleOpenPlanDialog = useCallback((issueId: string) => {
    const issue = issues.find(i => i.identifier.toLowerCase() === issueId.toLowerCase());
    if (issue) setPlanDialogIssue(issue);
  }, [issues]);

  const handleViewJsonl = useCallback((sessionId: string) => {
    // Select the session so the conversation panel shows its JSONL transcript
    for (const project of projectsWithSessions) {
      for (const feature of project.features) {
        if (feature.sessions?.some(s => s.sessionId === sessionId)) {
          setSelectedFeature(feature.issueId);
          setSelectedProject(null);
          selectSession(feature.issueId, sessionId);
          setSelectedConversation(null);
          return;
        }
      }
    }
  }, [projectsWithSessions, selectSession]);

  const handleSelectProject = useCallback((projectName: string) => {
    setSelectedProject(projectName);
    setSelectedFeature(null);
    setSelectedConversation(null);
  }, []);

  const handleSelectConversation = useCallback((name: string | null) => {
    setSelectedConversation(name);
    if (selectedFeature) {
      selectSession(selectedFeature, null);
    }
    if (name !== null) {
      setSelectedProject(null);
      setSelectedFeature(null);
    }
  }, [selectSession, selectedFeature]);

  const projectConvMutations = useConversationMutations(selectedConversation, handleSelectConversation);

  useEffect(() => {
    let canceled = false;
    void fetch('/api/settings/claude-auth')
      .then((r) => r.json())
      .then((status: { loggedIn?: boolean; hasAnthropicApiKey?: boolean }) => {
        if (!canceled) setAnthropicAuthMode(status.hasAnthropicApiKey ? 'api-key' : (status.loggedIn ? 'subscription' : undefined));
      })
      .catch(() => undefined);
    return () => { canceled = true; };
  }, []);

  const createConversationForProject = useCallback(async (projectKey?: string) => {
    try {
      const payload: Record<string, unknown> = { model: sidebarModel, harness: sidebarHarness };
      if (projectKey) payload.projectKey = projectKey;
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
      setSelectedProject(null);
      setSelectedFeature(null);
      if (convsCollapsed) setConvsCollapsed(false);
      if (onConvIdChange) {
        const newId = String(conv.id);
        onConvIdChange(newId);
        appliedConvId.current = newId;
        prevSelectedRef.current = conv.name;
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      console.error('[CommandDeck] Failed to create conversation:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create conversation');
    }
  }, [sidebarModel, sidebarHarness, queryClient, onConvIdChange, convsCollapsed]);

  const handleNewConversation = useCallback(() => {
    void createConversationForProject();
  }, [createConversationForProject]);

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
    window.addEventListener('panopticon:reconnected', handler);
    return () => window.removeEventListener('panopticon:reconnected', handler);
  }, [queryClient]);

  // Find selected feature data (memoized to avoid O(P×F) scan per render)
  const selectedFeatureData = useMemo(() => {
    if (!selectedFeature) return null;
    for (const p of projectsWithSessions) {
      const f = p.features.find(f => f.issueId === selectedFeature);
      if (f) return f;
    }
    return null;
  }, [projectsWithSessions, selectedFeature]);

  const selectedProjectData = useMemo(() => {
    if (!selectedProject) return null;
    return projectsWithSessions.find(p => p.name === selectedProject) ?? null;
  }, [projectsWithSessions, selectedProject]);

  const selectedIssueTitle = selectedFeature
    ? issueTitles[selectedFeature.toLowerCase()] || issueTitles[selectedFeature] || selectedFeature
    : '';

  const selectedIssue = selectedFeature
    ? issues.find(i => i.identifier === selectedFeature)
    : null;

  const selectedAgent = useMemo(() => {
    if (!selectedFeature) return undefined;
    const key = selectedFeature.toLowerCase();
    return agents.find(a => a.issueId?.toLowerCase() === key && a.id.startsWith('agent-'))
      ?? agents.find(a => a.issueId?.toLowerCase() === key);
  }, [agents, selectedFeature]);

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
                  authMode={anthropicAuthMode}
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
              <span className={styles.segmentCount}>{conversations.length - excludeConvIds.size}</span>
            </div>
            {!convsCollapsed && (
              <div className={styles.sectionBody}>
                <ConversationList
                  selectedConversation={selectedConversation}
                  onSelectConversation={handleSelectConversation}
                  excludeIds={excludeConvIds}
                />
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

          {/* ── Projects section ──────────────────────────────────── */}
          <div
            className={`${styles.sidebarSection} ${projectsCollapsed ? styles.sidebarSectionCollapsed : ''}`}
            style={!convsCollapsed && !projectsCollapsed ? { flex: `0 0 ${100 - sectionSplit}%` } : undefined}
          >
            <div className={styles.sectionHeader} onClick={toggleProjectsCollapsed}>
              {projectsCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span className={styles.sectionTitle}>Projects</span>
              <span className={styles.segmentCount}>
                {activeProjects.reduce((sum, p) => sum + p.features.length, 0)}
              </span>
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
                {isLoading && activeProjects.length === 0 && inactiveProjects.length === 0 ? (
                  <div className={styles.skeletonList}>
                    <div className={styles.skeletonItem} style={{ width: '60%' }} />
                    <div className={styles.skeletonItem} style={{ width: '80%' }} />
                    <div className={styles.skeletonItem} style={{ width: '45%' }} />
                    <div className={styles.skeletonItem} style={{ width: '70%' }} />
                  </div>
                ) : activeProjects.length === 0 && inactiveProjects.length === 0 ? (
                  <div className={styles.emptyProject}>No projects configured</div>
                ) : (
                  <>
                    {activeProjects
                      .filter((project) => {
                        const hasConvs = (projectConversations[project.name]?.length ?? 0) > 0;
                        if (treeFilter === 'all') return project.features.length > 0 || hasConvs;
                        return project.features.some((feature) =>
                          (feature.sessions ?? []).some((session) => sessionMatchesFilter(session, treeFilter)),
                        ) || hasConvs;
                      })
                      .map(project => (
                      <ProjectNode
                        key={project.path}
                        name={project.name}
                        features={project.features}
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
                        onRestartSession={handleRestartSession}
                        onDeepWipe={handleDeepWipe}
                        onOpenStateDir={handleOpenStateDir}
                        onViewJsonl={handleViewJsonl}
                        onCleanupOrphanedResources={handleCleanupOrphanedResources}
                        onOpenPlanDialog={handleOpenPlanDialog}
                        onNewConversation={handleNewProjectConversation}
                        conversations={projectConversations[project.name] ?? []}
                        selectedConversation={selectedConversation}
                        onSelectConversation={handleSelectConversation}
                        conversationMutations={projectConvMutations}
                        containerStats={containerStats}
                      />
                    ))}
                    {inactiveProjects.length > 0 && (
                      <div className={styles.inactiveProjectsSection}>
                        <div className={styles.inactiveProjectsSectionHeader}>
                          Projects (Inactive)
                        </div>
                        {inactiveProjects.map(project => (
                          <ProjectNode
                            key={project.path}
                            name={project.name}
                            features={project.features}
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
                            onRestartSession={handleRestartSession}
                            onDeepWipe={handleDeepWipe}
                            onOpenStateDir={handleOpenStateDir}
                            onViewJsonl={handleViewJsonl}
                            onCleanupOrphanedResources={handleCleanupOrphanedResources}
                            onOpenPlanDialog={handleOpenPlanDialog}
                            onNewConversation={handleNewProjectConversation}
                            conversations={projectConversations[project.name] ?? []}
                            selectedConversation={selectedConversation}
                            onSelectConversation={handleSelectConversation}
                            conversationMutations={projectConvMutations}
                            containerStats={containerStats}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          </div>

          {projectConvMutations.forkTarget && (
            <ForkModal
              conversation={projectConvMutations.forkTarget}
              isPending={projectConvMutations.isForkPending}
              onClose={projectConvMutations.closeForkModal}
              onConfirm={(conv, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary, title, launchHarness) => {
                projectConvMutations.submitFork(conv, launchModel, summaryModel, plainFork, localSummaryOnly, includeThinkingInSummary, title, launchHarness);
              }}
            />
          )}

          <DeaconStatus />
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

        {/* Content Area */}
        <div className={styles.content}>
          {selectedConversation ? (
            (() => {
              const conv = conversations.find(c => c.name === selectedConversation);
              return conv ? (
                <ConversationPanel
                  key={conv.name}
                  conversation={conv}
                  viewMode={conversationViewMode}
                  onViewModeChange={onConversationViewModeChange}
                  agentId={selectedAgent?.id}
                  onArchived={() => {
                    setSelectedConversation(null);
                    queryClient.invalidateQueries({ queryKey: ['conversations'] });
                  }}
                />
              ) : (
                <div className={styles.contentEmpty}>
                  <div style={{ textAlign: 'center' }}>
                    <p>Loading session…</p>
                  </div>
                </div>
              );
            })()
          ) : selectedFeature ? (
            <IssueWorkbench
              issueId={selectedFeature}
              title={selectedIssueTitle}
              sessions={selectedFeatureData?.sessions ?? []}
              source={selectedIssue?.source}
              url={selectedIssue?.url}
              onOpenBeads={() => setShowBeads(true)}
              agent={selectedAgent}
              issue={selectedIssue ?? undefined}
            />
          ) : selectedProject ? (
            <ProjectOverview
              projectName={selectedProject}
              features={selectedProjectData?.features ?? []}
              issueCosts={issueCosts}
              issueCostDetails={issueCostDetails}
              onSelectFeature={(feature) => handleSelectFeature(feature.issueId)}
            />
          ) : (
            <div className={styles.contentEmpty}>
              <div style={{ textAlign: 'center' }}>
                <Compass size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
                <p>Select a feature to view activity</p>
              </div>
            </div>
          )}
        </div>
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
