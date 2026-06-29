import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDashboardStore, selectAgents, selectIssuesByCycle } from '../lib/store';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  useDroppable,
} from '@dnd-kit/core';
import { Issue, Agent, LinearProject, STATUS_ORDER, STATUS_LABELS, CanonicalState } from '../types';
import { Tag, X } from 'lucide-react';
import { PlanDialog } from './PlanDialog';
// PAN-1048 — SpecialistAgent type retired; specialist-style indicators now
// derive directly from role-tagged AgentSnapshots (review / test / ship).
import { VBriefDialog } from './vbrief/VBriefDialog';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { getIssueWorkAgentMap } from '../lib/workAgents';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { BulkActionBar } from './BulkActionBar';
import { BulkAgentWarningDialog } from './BulkAgentWarningDialog';
import { BulkCloseOutProgress, type BulkCloseResult } from './BulkCloseOutProgress';
import { useWorkspaceStackHealthQuery } from './CommandDeck/ZoneCOverviewTabs/queries';
import {
  AgentWarningDialog,
  BeadsDialog,
  SyncPromptDialog,
  UndoToast,
} from './KanbanBoard/dialogs';
import { DragOverlayCard, ListIssueRow } from './KanbanBoard/cards';
import { ColumnContent } from './KanbanBoard/columns';
import { useDragDrop } from './KanbanBoard/hooks/useDragDrop';
import { KanbanFilterBar } from './KanbanBoard/views';
import {
  COLUMN_COLORS,
  COLUMN_TITLES,
  applyReviewStateToIssue,

  generateMockRallyData,
  groupByCanceledType,
  groupByLabels,
  groupByProject,
  groupByStatus,
} from './KanbanBoard/kanban-utils';
import type { CycleFilter, IssueCost, PlanningState } from './KanbanBoard/types';

export {
  applyReviewStateToIssue,
  getPipelineCallToAction,
  groupByCanceledType,
  groupByLabels,
  groupByStatus,
  shouldShowAgentDoneBadge,
  shouldShowReviewReadyBadge,
} from './KanbanBoard/kanban-utils';

export {
  DeaconIgnoreButton,
  DivergedBadge,
  ReviewInfraStuckBadge,
} from './KanbanBoard/badges';

export {
  CompactChildCard,
  DragOverlayCard,
  DraggableCardWrapper,
  FeatureCard,
  IssueCard,
  ListIssueRow,
} from './KanbanBoard/cards';

export type { IssueCost } from './KanbanBoard/types';

// Fetch costs for all issues
async function fetchIssueCosts(): Promise<Record<string, IssueCost>> {
  try {
    const res = await fetch('/api/costs/by-issue');
    if (!res.ok) return {};
    const data = await res.json();
    const costMap: Record<string, IssueCost> = {};
    for (const issue of data.issues || []) {
      costMap[issue.issueId.toLowerCase()] = issue;
    }
    return costMap;
  } catch {
    return {};
  }
}

interface KanbanBoardProps {
  selectedIssue?: string | null;
  onSelectIssue?: (issueId: string | null) => void;
  onPlanDialogChange?: (issueId: string | null) => void;
  bulkSelectedIds?: Set<string>;
  onBulkToggle?: (issueId: string) => void;
  onBulkSelectAll?: (issueIds: string[]) => void;
  onBulkDeselectAll?: (issueIds: string[]) => void;
}

// Undo history entry
interface UndoEntry {
  issueId: string;
  fromStatus: CanonicalState;
  toStatus: CanonicalState;
  timestamp: number;
}

export function KanbanBoard({ selectedIssue: externalSelectedIssue, onSelectIssue: externalOnSelectIssue, onPlanDialogChange, bulkSelectedIds, onBulkToggle, onBulkSelectAll, onBulkDeselectAll }: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const [internalSelectedIssue, setInternalSelectedIssue] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set()); // Empty = all projects
  const [planDialogIssue, setPlanDialogIssue] = useState<Issue | null>(null); // Lifted dialog state
  const [planDialogAutoStart, setPlanDialogAutoStart] = useState(false);
  const openPlanDialog = useCallback((issue: Issue, autoStart = false) => {
    setPlanDialogAutoStart(autoStart);
    setPlanDialogIssue(issue);
  }, []);

  // Notify parent when plan dialog opens/closes so it can suppress the detail panel terminal
  useEffect(() => {
    onPlanDialogChange?.(planDialogIssue?.identifier ?? null);
  }, [planDialogIssue, onPlanDialogChange]);
  const [beadsDialogIssue, setBeadsDialogIssue] = useState<Issue | null>(null); // Beads viewer
  const [vbriefDialogIssue, setVbriefDialogIssue] = useState<Issue | null>(null); // vBRIEF viewer
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>('current'); // Default to current cycle
  const [includeCompleted, setIncludeCompleted] = useState(false);

  // Rally feature expand/collapse state (lifted from ColumnContent for expand/collapse all)
  const [collapsedFeatures, setCollapsedFeatures] = useState<Set<string>>(new Set());

  const toggleFeature = useCallback((featureId: string) => {
    setCollapsedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
      } else {
        next.add(featureId);
      }
      return next;
    });
  }, []);

  // Undo state
  const [undoHistory, setUndoHistory] = useState<UndoEntry[]>([]);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [undoTimeoutId, setUndoTimeoutId] = useState<NodeJS.Timeout | null>(null);

  // Dialog states
  const [agentWarningDialog, setAgentWarningDialog] = useState<{
    open: boolean;
    issue: Issue | null;
    targetStatus: CanonicalState | null;
  }>({ open: false, issue: null, targetStatus: null });
  const [syncPromptDialog, setSyncPromptDialog] = useState<{
    open: boolean;
    issue: Issue | null;
  }>({ open: false, issue: null });

  // Use external state if provided, otherwise use internal state
  const selectedIssue = externalSelectedIssue !== undefined ? externalSelectedIssue : internalSelectedIssue;
  const onSelectIssue = externalOnSelectIssue || setInternalSelectedIssue;

  // Event-sourced state from Zustand store (PAN-433 read model)
  const issues = useDashboardStore(selectIssuesByCycle(cycleFilter, includeCompleted)) as unknown as Issue[];
  const {
    activeDragIssue,
    activeDragStatus,
    activeOverId,
    columnOrderOverrides,
    dropAnimation,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    sensors,
  } = useDragDrop(issues);
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const openIssue = useDashboardStore((state) => state.openIssue);
  // PAN-1048 — derive specialist-role agents (review / test / ship) from the
  // unified agent list. Replaces the retired specialistsByName projection.
  const specialists = useMemo(
    () => agents.filter(
      (a) => a.role === 'review' || a.role === 'test' || a.role === 'ship',
    ),
    [agents],
  );
  const reviewStatusByIssueId = useDashboardStore((s) => s.reviewStatusByIssueId);

  // Bulk selection state — key based on filters so selection survives data refreshes
  const internalBulkSelection = useBulkSelection(`${cycleFilter}-${includeCompleted}-${Array.from(selectedProjects).sort().join(',')}`);
  const bulkSelection = useMemo(() =>
    bulkSelectedIds && onBulkToggle && onBulkSelectAll && onBulkDeselectAll
      ? { selectedIds: bulkSelectedIds, toggle: onBulkToggle, selectAll: onBulkSelectAll, deselectAll: onBulkDeselectAll, clear: () => onBulkDeselectAll(Array.from(bulkSelectedIds)), isSelected: (id: string) => bulkSelectedIds.has(id), count: bulkSelectedIds.size }
      : internalBulkSelection,
    [bulkSelectedIds, onBulkToggle, onBulkSelectAll, onBulkDeselectAll, internalBulkSelection]
  );

  // Bulk close-out mutation
  const [bulkCloseResults, setBulkCloseResults] = useState<BulkCloseResult[]>([]);
  const [showBulkProgress, setShowBulkProgress] = useState(false);
  const [showBulkWarning, setShowBulkWarning] = useState(false);

  const bulkCloseOutMutation = useMutation({
    mutationFn: async (issueIds: string[]) => {
      const res = await fetch('/api/issues/bulk-close-out', {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ issueIds }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.length < 200 ? text : `Failed to bulk close out (${res.status})`);
      }
      return res.json() as Promise<{ results: Array<{ issueId: string; success: boolean; error?: string; skipped?: boolean }> }>;
    },
    onSuccess: (data) => {
      setBulkCloseResults(prev => {
        const backendMap = new Map(data.results.map(r => [r.issueId, r]));
        return prev.map(p => {
          const backend = backendMap.get(p.issueId);
          if (backend) {
            return {
              issueId: p.issueId,
              status: backend.skipped ? 'skipped' : backend.success ? 'done' : 'failed',
              error: backend.error,
            };
          }
          // Backend response omitted this issueId — if already marked skipped (active-agent guardrail), preserve it
          if (p.status === 'skipped') return p;
          // Otherwise mark as failed so modal doesn't hang
          return { issueId: p.issueId, status: 'failed' as const, error: 'Missing from server response' };
        });
      });
      refreshDashboardState(queryClient);
    },
    onError: (err: Error, issueIds) => {
      setBulkCloseResults(prev => {
        const failedIds = new Set(issueIds);
        return prev.map(p => failedIds.has(p.issueId) ? { ...p, status: 'failed' as const, error: err.message } : p);
      });
    },
  });

  // Memoize selected issues and active-agent filtering — pre-index agents by issueId for O(1) lookup
  const selectedIssues = useMemo(
    () => issues.filter(i => bulkSelection.isSelected(i.identifier)),
    [issues, bulkSelection]
  );
  const issuesWithAgents = useMemo(() => {
    // Build a Set of issueIds that have at least one active agent
    const selectedIssueById = new Map(selectedIssues.map(issue => [issue.identifier.toLowerCase(), issue]));
    const activeAgentIssueIds = new Set<string>();
    for (const agent of agents) {
      if (!agent.issueId || agent.status === 'dead' || agent.status === 'stopped' || agent.status === 'failed') continue;
      const issue = selectedIssueById.get(agent.issueId.toLowerCase());
      if (agent.paused && issue?.mergeStatus === 'merged') continue;
      activeAgentIssueIds.add(agent.issueId.toLowerCase());
    }
    return selectedIssues.filter(issue => activeAgentIssueIds.has(issue.identifier.toLowerCase()));
  }, [selectedIssues, agents]);

  const handleBulkCloseOut = useCallback(() => {
    if (issuesWithAgents.length > 0) {
      setShowBulkWarning(true);
    } else {
      // No active agents — proceed directly
      const ids = selectedIssues.map(i => i.identifier);
      setBulkCloseResults(ids.map(id => ({ issueId: id, status: 'pending' })));
      setShowBulkProgress(true);
      bulkCloseOutMutation.mutate(ids);
    }
  }, [issuesWithAgents, selectedIssues, bulkCloseOutMutation]);

  const handleProceedAfterWarning = useCallback(() => {
    setShowBulkWarning(false);
    const issuesWithoutAgents = selectedIssues.filter(i => !issuesWithAgents.some(wa => wa.identifier === i.identifier));
    const ids = issuesWithoutAgents.map(i => i.identifier);

    // Mark skipped issues
    const results: BulkCloseResult[] = [
      ...issuesWithAgents.map(i => ({ issueId: i.identifier, status: 'skipped' as const })),
      ...ids.map(id => ({ issueId: id, status: 'pending' as const })),
    ];
    setBulkCloseResults(results);
    setShowBulkProgress(true);
    if (ids.length > 0) {
      bulkCloseOutMutation.mutate(ids);
    }
  }, [selectedIssues, issuesWithAgents, bulkCloseOutMutation]);

  const handleCloseProgress = useCallback(() => {
    setShowBulkProgress(false);
    bulkSelection.clear();
  }, [bulkSelection]);

  // Move status mutation
  const moveStatusMutation = useMutation({
    mutationFn: async ({ issueId, targetStatus, syncToTracker }: { issueId: string; targetStatus: CanonicalState; syncToTracker?: boolean }) => {
      const res = await fetch(`/api/issues/${issueId}/move-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStatus, syncToTracker }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to move issue');
      }
      return res.json();
    },
    onSuccess: async () => {
      await refreshDashboardState(queryClient);
    },
  });

  // Handle undo
  const handleUndo = useCallback(() => {
    if (undoHistory.length === 0) return;

    const lastEntry = undoHistory[undoHistory.length - 1];
    moveStatusMutation.mutate({
      issueId: lastEntry.issueId,
      targetStatus: lastEntry.fromStatus,
    });

    setUndoHistory(prev => prev.slice(0, -1));
    setShowUndoToast(false);
    if (undoTimeoutId) {
      clearTimeout(undoTimeoutId);
      setUndoTimeoutId(null);
    }
  }, [undoHistory, moveStatusMutation, undoTimeoutId]);

  // Keyboard shortcut for undo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo]);

  // Show undo toast
  const showUndoNotification = useCallback((issueId: string, fromStatus: CanonicalState, toStatus: CanonicalState) => {
    setUndoHistory(prev => [...prev, { issueId, fromStatus, toStatus, timestamp: Date.now() }]);
    setShowUndoToast(true);

    if (undoTimeoutId) {
      clearTimeout(undoTimeoutId);
    }

    const timeoutId = setTimeout(() => {
      setShowUndoToast(false);
    }, 8000);
    setUndoTimeoutId(timeoutId);
  }, [undoTimeoutId]);

  // Confirm agent warning
  const confirmAgentMove = useCallback(() => {
    const { issue, targetStatus } = agentWarningDialog;
    if (!issue || !targetStatus) return;

    setAgentWarningDialog({ open: false, issue: null, targetStatus: null });

    const currentStatus = STATUS_LABELS[issue.status] as CanonicalState;

    if (targetStatus === 'done') {
      setSyncPromptDialog({ open: true, issue });
      return;
    }

    showUndoNotification(issue.identifier, currentStatus, targetStatus);
    moveStatusMutation.mutate({ issueId: issue.identifier, targetStatus });
  }, [agentWarningDialog, moveStatusMutation, showUndoNotification]);

  // Handle sync prompt response
  const handleSyncPrompt = useCallback(async (syncToTracker: boolean, options?: { cleanupWorkspace?: boolean; stopAgents?: boolean }) => {
    const { issue } = syncPromptDialog;
    if (!issue) return;

    setSyncPromptDialog({ open: false, issue: null });

    const currentStatus = STATUS_LABELS[issue.status] as CanonicalState;

    // Stop agents if requested
    if (options?.stopAgents) {
      const issueIdLower = issue.identifier.toLowerCase();
      const issueAgents = agents.filter(a => a.issueId?.toLowerCase() === issueIdLower);
      for (const agent of issueAgents) {
        try {
          await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
        } catch (e) {
          console.error(`Failed to stop agent ${agent.id}:`, e);
        }
      }
    }

    // Cleanup workspace if requested
    if (options?.cleanupWorkspace) {
      try {
        await fetch(`/api/issues/${issue.identifier}/cleanup-workspace`, { method: 'POST' });
      } catch (e) {
        console.error(`Failed to cleanup workspace for ${issue.identifier}:`, e);
      }
    }

    showUndoNotification(issue.identifier, currentStatus, 'done');
    moveStatusMutation.mutate({ issueId: issue.identifier, targetStatus: 'done', syncToTracker });

    // Invalidate agents query to refresh the list
    if (options?.stopAgents) {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
  }, [syncPromptDialog, moveStatusMutation, showUndoNotification, agents, queryClient]);

  // Fetch costs for all issues
  const { data: issueCosts = {}, isLoading: costsLoading } = useQuery({
    queryKey: ['issueCosts'],
    queryFn: fetchIssueCosts,
    staleTime: 10000,
  });

  // Fetch registered projects from projects.yaml
  interface RegisteredProject {
    key: string;
    name: string;
    linearTeam: string | null;
    githubRepo: string | null;
    linearProject: string | null;
  }
  const { data: registeredProjects = [] } = useQuery<RegisteredProject[]>({
    queryKey: ['registered-projects'],
    queryFn: async () => {
      const res = await fetch('/api/registered-projects');
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  // Extract unique projects from issues, then merge registered projects that have no issues yet
  const projects = useMemo(() => {
    const projectMap = new Map<string, LinearProject>();
    for (const issue of (issues || [])) {
      if (issue.project && !projectMap.has(issue.project.id)) {
        projectMap.set(issue.project.id, issue.project);
      }
    }
    // Add registered projects that aren't already represented by issues
    const existingNames = new Set(Array.from(projectMap.values()).map(p => p.name.toLowerCase()));
    for (const rp of registeredProjects) {
      const displayName = rp.linearProject || rp.githubRepo || rp.name;
      if (!existingNames.has(displayName.toLowerCase()) && !existingNames.has(rp.name.toLowerCase())) {
        projectMap.set(`registered:${rp.key}`, {
          id: `registered:${rp.key}`,
          name: displayName,
          color: '#6b7280', // neutral gray for projects with no issues yet
        });
      }
    }
    return Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues, registeredProjects]);

  // Filter issues by selected projects
  const filteredIssuesBase = useMemo(() => {
    if (!issues) return [];
    if (selectedProjects.size === 0) return issues; // Show all if none selected
    return issues.filter(issue => issue.project && selectedProjects.has(issue.project.id));
  }, [issues, selectedProjects]);

  const filteredIssuesWithReviewState = useMemo(() => (
    filteredIssuesBase.map((issue) => applyReviewStateToIssue(issue, reviewStatusByIssueId[issue.identifier]))
  ), [filteredIssuesBase, reviewStatusByIssueId]);

  // Inject mock Rally data for visual testing (?mockRally=true)
  const mockRallyEnabled = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mockRally') === 'true';
  }, []);

  const filteredIssues = useMemo(() => {
    if (!mockRallyEnabled) return filteredIssuesWithReviewState;
    return [...filteredIssuesWithReviewState, ...generateMockRallyData()];
  }, [filteredIssuesWithReviewState, mockRallyEnabled]);

  // Detect if any filtered issues use Rally hierarchy (for expand/collapse all button)
  const hasAnyRallyHierarchy = useMemo(() =>
    filteredIssues.some(i => i.artifactType?.includes('PortfolioItem')),
    [filteredIssues]
  );

  // Collect all feature identifiers for expand/collapse all
  const allFeatureIds = useMemo(() =>
    filteredIssues
      .filter(i => i.artifactType?.includes('PortfolioItem'))
      .map(i => i.identifier),
    [filteredIssues]
  );

  const expandAllFeatures = useCallback(() => {
    setCollapsedFeatures(new Set());
  }, []);

  const collapseAllFeatures = useCallback(() => {
    setCollapsedFeatures(new Set(allFeatureIds));
  }, [allFeatureIds]);

  const allExpanded = collapsedFeatures.size === 0;

  const refreshTrackers = useCallback(async () => {
    try {
      await fetch('/api/trackers/refresh', { method: 'POST' });
      await refreshDashboardState(queryClient);
    } catch (e) {
      console.error('Refresh failed:', e);
    }
  }, [queryClient]);

  const issueWorkAgentsById = useMemo(() => getIssueWorkAgentMap(agents), [agents]);

  // Group by labels for list view - MUST be before any conditional returns (Rules of Hooks)
  const groupedByLabels = useMemo(() => groupByLabels(filteredIssues), [filteredIssues]);
  const groupedByProject = useMemo(() => groupByProject(filteredIssues), [filteredIssues]);
  const groupedByCanceledType = useMemo(() => groupByCanceledType(filteredIssues), [filteredIssues]);

  const toggleProject = (projectId: string) => {
    setSelectedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };


  const grouped = useMemo(() => groupByStatus(filteredIssues, includeCompleted), [filteredIssues, includeCompleted]);

  // Planning-state is embedded in each issue from the /api/issues response
  // (computed server-side via cheap filesystem checks). No per-card fetches needed.
  const planningStateById = useMemo(() => {
    const map: Record<string, PlanningState> = {};
    for (const issue of filteredIssues) {
      map[issue.identifier] = {
        hasPlan: issue.hasPlan ?? false,
        hasBeads: issue.hasBeads ?? false,
        planningComplete: issue.planningComplete ?? false,
      };
    }
    return map;
  }, [filteredIssues]);

  // Sort Todo: planning-complete first, then updatedAt desc
  const sortedGrouped = useMemo(() => {
    const result = { ...grouped };
    if (result.todo) {
      result.todo = [...result.todo].sort((a, b) => {
        const aReady = planningStateById[a.identifier]?.planningComplete ? 1 : 0;
        const bReady = planningStateById[b.identifier]?.planningComplete ? 1 : 0;
        if (aReady !== bReady) return bReady - aReady;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    for (const status of Object.keys(result)) {
      const order = columnOrderOverrides[status];
      if (!order) continue;
      const rank = new Map(order.map((id, index) => [id, index]));
      result[status] = [...result[status]].sort((a, b) => {
        const aRank = rank.get(a.identifier) ?? Number.MAX_SAFE_INTEGER;
        const bRank = rank.get(b.identifier) ?? Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return 0;
      });
    }

    return result;
  }, [columnOrderOverrides, grouped, planningStateById]);

  const kanbanIssueIds = useMemo(() => {
    if (cycleFilter === 'all' || cycleFilter === 'backlog' || cycleFilter === 'canceled') return [];
    return STATUS_ORDER
      .filter((status) => status !== 'backlog')
      .flatMap((status) => sortedGrouped[status].map((issue) => issue.identifier));
  }, [cycleFilter, sortedGrouped]);
  const stackHealthByIssue = useWorkspaceStackHealthQuery(kanbanIssueIds).data?.workspaces ?? {};

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <KanbanFilterBar
        cycleFilter={cycleFilter}
        onCycleFilterChange={setCycleFilter}
        includeCompleted={includeCompleted}
        onIncludeCompletedChange={setIncludeCompleted}
        onRefreshTrackers={refreshTrackers}
        issueCount={issues?.length || 0}
        hasAnyRallyHierarchy={hasAnyRallyHierarchy}
        allExpanded={allExpanded}
        onExpandAllFeatures={expandAllFeatures}
        onCollapseAllFeatures={collapseAllFeatures}
        projects={projects}
        selectedProjects={selectedProjects}
        onToggleProject={toggleProject}
        onClearProjects={() => setSelectedProjects(new Set())}
      />

      {/* All Issues - List View (grouped by labels) */}
      {cycleFilter === 'all' ? (
        <div className="space-y-6 overflow-y-auto pb-4">
          {Object.entries(groupedByLabels).map(([label, labelIssues]) => (
            <div key={label} className="bg-card rounded-lg">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-foreground">{label}</h3>
                  <span className="text-sm text-muted-foreground">({labelIssues.length})</span>
                </div>
              </div>
              <div className="divide-y divide-divider">
                {labelIssues.map((issue) => (
                  <ListIssueRow
                    key={issue.id}
                    issue={issue}
                    issueWorkAgentsById={issueWorkAgentsById}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    costsLoading={costsLoading}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={openPlanDialog}
                    isBulkSelected={bulkSelection.isSelected(issue.identifier)}
                    onBulkToggle={() => bulkSelection.toggle(issue.identifier)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : cycleFilter === 'backlog' ? (
        /* Backlog - List View (grouped by project) */
        <div className="space-y-6 overflow-y-auto pb-4">
          {groupedByProject.map((group) => (
            <div key={group.name} className="bg-card rounded-lg">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: group.color || '#6b7280' }}
                  />
                  <h3 className="font-semibold text-foreground">{group.name}</h3>
                  <span className="text-sm text-muted-foreground">({group.issues.length})</span>
                </div>
              </div>
              <div className="divide-y divide-divider">
                {group.issues.map((issue) => (
                  <ListIssueRow
                    key={issue.id}
                    issue={issue}
                    issueWorkAgentsById={issueWorkAgentsById}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    costsLoading={costsLoading}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={openPlanDialog}
                    isBulkSelected={bulkSelection.isSelected(issue.identifier)}
                    onBulkToggle={() => bulkSelection.toggle(issue.identifier)}
                  />
                ))}
              </div>
            </div>
          ))}
          {groupedByProject.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No backlog items
            </div>
          )}
        </div>
      ) : cycleFilter === 'canceled' ? (
        /* Canceled - List View (grouped by cancellation type) */
        <div className="space-y-6 overflow-y-auto pb-4">
          {groupedByCanceledType.map((group) => (
            <div key={group.name} className="bg-card rounded-lg">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <X className="w-4 h-4 text-destructive-foreground" />
                  <h3 className="font-semibold text-foreground">{group.name}</h3>
                  <span className="text-sm text-muted-foreground">({group.issues.length})</span>
                </div>
              </div>
              <div className="divide-y divide-divider">
                {group.issues.map((issue) => (
                  <ListIssueRow
                    key={issue.id}
                    issue={issue}
                    issueWorkAgentsById={issueWorkAgentsById}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    costsLoading={costsLoading}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={openPlanDialog}
                    isBulkSelected={bulkSelection.isSelected(issue.identifier)}
                    onBulkToggle={() => bulkSelection.toggle(issue.identifier)}
                  />
                ))}
              </div>
            </div>
          ))}
          {groupedByCanceledType.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No canceled issues
            </div>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-hidden pb-4">
            {STATUS_ORDER.filter(s => s !== 'backlog').map((status) => {
            const columnIssueIds = sortedGrouped[status].map(i => i.identifier);
            const selectedInColumn = columnIssueIds.filter(id => bulkSelection.isSelected(id));
            const allSelected = columnIssueIds.length > 0 && selectedInColumn.length === columnIssueIds.length;
            const someSelected = selectedInColumn.length > 0 && selectedInColumn.length < columnIssueIds.length;

            return (
              <DroppableColumn key={status} status={status} activeDragStatus={activeDragStatus} overId={activeOverId} issueIds={sortedGrouped[status].map(i => i.id)}>
                <div
                  className="flex-1 min-w-0"
                  data-testid={`kanban-column-${status.replace(/_/g, '-')}`}
                >
                  <div className={`border-t-4 ${COLUMN_COLORS[status]} bg-card rounded-lg transition-colors`}>
                  <div className="px-4 py-3 border-b border-border bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={() => {
                            if (allSelected) {
                              bulkSelection.deselectAll(columnIssueIds);
                            } else {
                              bulkSelection.selectAll(columnIssueIds);
                            }
                          }}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer shrink-0"
                          aria-label={`Select all ${COLUMN_TITLES[status]}`}
                        />
                        <h3 className="font-semibold text-foreground">{COLUMN_TITLES[status]}</h3>
                      </div>
                      <span className="text-sm text-muted-foreground">{sortedGrouped[status].length}</span>
                    </div>
                  </div>
                  <ColumnContent
                    issues={sortedGrouped[status]}
                    issueWorkAgentsById={issueWorkAgentsById}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    costsLoading={costsLoading}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onOpenIssue={openIssue}
                    onPlan={openPlanDialog}
                    onViewBeads={setBeadsDialogIssue}
                    onViewVBrief={setVbriefDialogIssue}
                    collapsedFeatures={collapsedFeatures}
                    onToggleFeature={toggleFeature}
                    bulkSelectedIds={bulkSelection.selectedIds}
                    onBulkToggle={bulkSelection.toggle}
                    planningStateById={planningStateById}
                    workspaceByIssueId={stackHealthByIssue}
                  />
                  {/* TODO(PAN-1242): + New issue column footer button — see PRD §4.7.6 */}
                  </div>
                </div>
              </DroppableColumn>
            );
          })}
          </div>
          <DragOverlay dropAnimation={dropAnimation}>
            {activeDragIssue ? <DragOverlayCard issue={activeDragIssue} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Undo Toast */}
      <UndoToast
        isVisible={showUndoToast}
        onUndo={handleUndo}
        onClose={() => setShowUndoToast(false)}
      />

      {/* Agent Warning Dialog */}
      <AgentWarningDialog
        isOpen={agentWarningDialog.open}
        onClose={() => setAgentWarningDialog({ open: false, issue: null, targetStatus: null })}
        onConfirm={confirmAgentMove}
        issue={agentWarningDialog.issue}
      />

      {/* Sync Prompt Dialog */}
      <SyncPromptDialog
        isOpen={syncPromptDialog.open}
        onClose={() => setSyncPromptDialog({ open: false, issue: null })}
        onSync={handleSyncPrompt}
        issue={syncPromptDialog.issue}
      />

      {/* Plan Dialog - lifted to survive IssueCard re-renders */}
      {planDialogIssue && (
        <PlanDialog
          issue={planDialogIssue}
          isOpen={true}
          onClose={() => {
            setPlanDialogIssue(null);
            setPlanDialogAutoStart(false);
          }}
          onComplete={async () => {
            setPlanDialogIssue(null);
            setPlanDialogAutoStart(false);
            await refreshDashboardState(queryClient);
          }}
          onTerminalReleased={() => onPlanDialogChange?.(null)}
          autoStart={planDialogAutoStart}
        />
      )}

      {/* Beads Dialog - view tasks for issue */}
      {beadsDialogIssue && (
        <BeadsDialog
          issue={beadsDialogIssue}
          onClose={() => setBeadsDialogIssue(null)}
        />
      )}

      {/* vBRIEF Dialog - view plan for issue */}
      {vbriefDialogIssue && (
        <VBriefDialog
          issueId={vbriefDialogIssue.identifier}
          onClose={() => setVbriefDialogIssue(null)}
        />
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        count={bulkSelection.count}
        onCloseOut={handleBulkCloseOut}
        onCancel={bulkSelection.clear}
      />

      {/* Bulk Agent Warning Dialog */}
      <BulkAgentWarningDialog
        isOpen={showBulkWarning}
        onClose={() => setShowBulkWarning(false)}
        onProceed={handleProceedAfterWarning}
        issues={issues.filter(i => bulkSelection.isSelected(i.identifier))}
        agents={agents}
      />

      {/* Bulk Close Out Progress */}
      <BulkCloseOutProgress
        isOpen={showBulkProgress}
        results={bulkCloseResults}
        onClose={handleCloseProgress}
      />
    </div>
  );
}

// DroppableColumn component
export function DroppableColumn({ status, activeDragStatus, overId, issueIds, children }: { status: CanonicalState; activeDragStatus?: CanonicalState | null; overId?: string | null; issueIds?: string[]; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
  });

  const isOverColumn = isOver || (overId !== undefined && overId !== null && (overId === status || issueIds?.includes(overId) === true));
  const isBlocked = isOverColumn && activeDragStatus !== undefined && activeDragStatus !== null && activeDragStatus !== status;

  return (
    <div
      ref={setNodeRef}
      data-testid={`droppable-column-${status}`}
      className={`flex-1 min-w-0 transition-all ${isBlocked ? 'cursor-not-allowed opacity-60' : isOverColumn ? 'scale-[1.02]' : ''}`}
    >
      {children}
    </div>
  );
}
