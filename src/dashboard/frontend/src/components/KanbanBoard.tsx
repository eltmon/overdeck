import { useState, useMemo, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDashboardStore, selectAgents, selectIssuesByCycle, selectReviewStatus } from '../lib/store';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  defaultDropAnimationSideEffects,
  type DropAnimation,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { Issue, Agent, LinearProject, STATUS_ORDER, STATUS_LABELS, CanonicalState } from '../types';
import { getFriendlyModelName } from '../lib/dashboard-utils';
import { ExternalLink, User, Tag, Play, Eye, X, Filter, FileText, List, DollarSign, RotateCcw, AlertTriangle, Undo, Check, ChevronDown, ChevronRight, Sparkles, XCircle, ScrollText, Pause } from 'lucide-react';
import { PlanDialog } from './PlanDialog';
import { BeadsTasksPanel } from './BeadsTasksPanel';
import { parseDifficultyLabel, ComplexityLevel } from '../../../../lib/cloister/complexity.js';
// PAN-1048 — SpecialistAgent type retired; specialist-style indicators now
// derive directly from role-tagged AgentSnapshots (review / test / ship).
import { CostBreakdownModal } from './CostBreakdownModal';
import { VBriefDialog } from './vbrief/VBriefDialog';
import { deriveIssueActionPhase, type PipelinePhase } from '../lib/issueActions';
import { refreshDashboardState } from '../lib/refresh-dashboard-state';
import { cn } from '../lib/utils';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { getIssueWorkAgentMap, isAgentSessionAttachable } from '../lib/workAgents';
import { useBulkSelection } from '../hooks/useBulkSelection';
import { BulkActionBar } from './BulkActionBar';
import { BulkAgentWarningDialog } from './BulkAgentWarningDialog';
import { BulkCloseOutProgress, type BulkCloseResult } from './BulkCloseOutProgress';
import { useWorkspaceStackHealthQuery, type WorkspaceData } from './CommandDeck/ZoneCOverviewTabs/queries';
import { IssueActionMenu, useIssueActions } from './IssueActionMenu';
import IssueCardPrimitive from './primitives/IssueCard';
import VerbBadge from './primitives/VerbBadge';
import { VerifyingOnMainBadge } from './VerifyingOnMainBadge';
import {
  COLUMN_COLORS,
  COLUMN_TITLES,
  applyReviewStateToIssue,
  avatarGradient,
  buildHierarchy,
  cardAvatarInitials,
  formatCost,
  formatRuntime,
  generateMockRallyData,
  getCostColor,
  groupByCanceledType,
  groupByLabels,
  groupByProject,
  groupByStatus,
} from './KanbanBoard/kanban-utils';

export {
  applyReviewStateToIssue,
  getPipelineCallToAction,
  groupByCanceledType,
  groupByLabels,
  groupByStatus,
  shouldShowAgentDoneBadge,
  shouldShowReviewReadyBadge,
} from './KanbanBoard/kanban-utils';


// Difficulty badge colors
const DIFFICULTY_COLORS: Record<ComplexityLevel, string> = {
  trivial: 'badge-bg-success text-success-foreground',
  simple: 'badge-bg-success text-success-foreground',
  medium: 'badge-bg-warning text-warning-foreground',
  complex: 'badge-bg-warning text-warning-foreground',
  expert: 'badge-bg-destructive text-destructive-foreground',
};

// Difficulty badge component
function DifficultyBadge({ level }: { level: ComplexityLevel }) {
  const color = DIFFICULTY_COLORS[level];
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {level}
    </span>
  );
}

// Cost data for an issue
export interface IssueCost {
  issueId: string;
  totalCost: number;
  tokenCount: number;
  sessionCount: number;
  model?: string;
  durationMinutes?: number;
}

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

// Tracker vs Shadow state badges — shows when Rally state differs from Overdeck shadow state
function TrackerShadowBadges({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  const trackerState = issue.rawTrackerState || issue.shadowTrackerStatus;
  const shadowState = issue.shadowStatus || issue.targetCanonicalState;

  // Only show when states diverge
  if (!trackerState || !shadowState) return null;

  // Map shadow canonical states to display names
  const shadowLabel = shadowState === 'in_progress' ? 'In Progress' :
                      shadowState === 'closed' ? 'Done' :
                      shadowState === 'done' ? 'Done' :
                      shadowState === 'in_review' ? 'In Review' :
                      shadowState;

  // Check if they're actually different
  const trackerLower = trackerState.toLowerCase().replace(/[-_\s]/g, '');
  const shadowLower = shadowLabel.toLowerCase().replace(/[-_\s]/g, '');
  if (trackerLower === shadowLower) return null;

  if (compact) {
    return (
      <span
        className="w-2 h-2 rounded-full badge-bg-signal-review shrink-0"
        title={`Rally: ${trackerState} → Pan: ${shadowLabel}`}
      />
    );
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-foreground">
        <ExternalLink className="w-2.5 h-2.5" />
        {trackerState}
      </span>
      <span className="text-muted-foreground">→</span>
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded badge-bg-signal-review text-signal-review-foreground">
        <Eye className="w-2.5 h-2.5" />
        {shadowLabel}
      </span>
    </div>
  );
}

// Feature card — rich card for Rally Features with progress and expand/collapse
// Children (user stories) render INSIDE the card
export function FeatureCard({
  feature,
  childCount,
  isExpanded,
  onToggle,
  isSelected,
  onSelect,
  onPlan,
  onViewBeads,
  onViewVBrief,
  planningState: planningStateProp,
  children,
}: {
  feature: Issue;
  childCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  isSelected?: boolean;
  onSelect?: () => void;
  onPlan?: () => void;
  onViewBeads?: () => void;
  onViewVBrief?: () => void;
  planningState?: PlanningState;
  children?: React.ReactNode;
}) {
  const completed = feature.completedChildCount ?? 0;
  const inProgress = feature.inProgressChildCount ?? 0;
  const total = feature.totalChildCount ?? childCount;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Check if derived status differs from raw Rally state
  const hasDerivedDiff = feature.derivedStatus && feature.rawTrackerState &&
    ((feature.derivedStatus === 'in_progress' && feature.rawTrackerState !== 'Developing') ||
     (feature.derivedStatus === 'closed' && feature.rawTrackerState !== 'Done'));

  const hasPlan = planningStateProp?.hasPlan ?? feature.hasPlan ?? false;
  const hasBeads = planningStateProp?.hasBeads ?? feature.hasBeads ?? false;
  const planLabelExists = hasPlan || feature.labels?.some(l => l.toLowerCase() === 'planned');

  return (
    <IssueCardPrimitive
      issueId={feature.identifier}
      priority={feature.priority}
      selected={isSelected}
      onClick={onSelect}
      className="rounded-lg bg-popover hover:translate-y-0"
    >
      <div
        className="relative flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-1 shrink-0 mt-0.5" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-primary/70" />
          ) : (
            <ChevronRight className="w-4 h-4 text-primary/70" />
          )}
          {childCount > 0 && (
            <span className="text-[10px] font-medium text-primary/60 min-w-[1rem] text-center">
              {childCount}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0" onClick={onSelect}>
          <div className="flex items-center gap-2 flex-wrap">
            {feature.project && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: feature.project.color || '#6b7280' }}
              />
            )}
            <a
              href={feature.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1"
            >
              <span>{feature.identifier}</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-50" />
            </a>
            {hasDerivedDiff && (
              <span className="px-1.5 py-0.5 rounded text-xs font-medium badge-bg-warning text-warning-foreground">
                derived
              </span>
            )}
            <TrackerShadowBadges issue={feature} />
          </div>
          <p className="text-sm text-foreground mt-1 line-clamp-2">{feature.title}</p>

          {/* Progress bar and summary */}
          {total > 0 && (
            <div className="mt-2">
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                {completed}/{total} done{inProgress > 0 ? `, ${inProgress} active` : ''}
              </span>
            </div>
          )}

          {/* Action bar for features — Plan, vBRIEF, Tasks; NO Start Agent */}
          <div className="mt-2 flex items-center gap-2 flex-wrap rounded-xl border border-border/70 bg-card/80 px-2.5 py-2">
            {STATUS_LABELS[feature.status] !== 'done' && STATUS_LABELS[feature.status] !== 'canceled' && (
              <button
                data-testid={`action-plan-${feature.identifier}`}
                onClick={(e) => { e.stopPropagation(); onPlan && onPlan(); }}
                className={`flex items-center gap-1 text-xs transition-colors ${
                  planLabelExists
                    ? 'text-success hover:text-success/80'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title={planLabelExists ? 'See plan / continue planning' : 'Plan'}
              >
                <FileText className="w-3.5 h-3.5" />
                {planLabelExists ? 'See Plan' : 'Plan'}
              </button>
            )}
            {(hasBeads || (hasPlan && !hasBeads)) && (
              <button
                data-testid={`action-tasks-${feature.identifier}`}
                onClick={(e) => { e.stopPropagation(); onViewBeads && onViewBeads(); }}
                className="flex items-center gap-1 text-xs text-success hover:text-success/80 transition-colors"
                title="Tasks"
              >
                <List className="w-3.5 h-3.5" />
                Tasks
              </button>
            )}
            {hasPlan && (
              <button
                data-testid={`action-vbrief-${feature.identifier}`}
                onClick={(e) => { e.stopPropagation(); onViewVBrief && onViewVBrief(); }}
                className="flex items-center gap-1 text-xs text-success hover:text-success/80 transition-colors"
                title="vBRIEF"
              >
                <ScrollText className="w-3.5 h-3.5" />
                vBRIEF
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Child stories rendered inside the card */}
      {isExpanded && children && (
        <div className="relative border-t border-border/50 bg-card/50">
          {children}
        </div>
      )}
    </IssueCardPrimitive>
  );
}

// Compact child card — slim inline card for stories under a Feature
export function CompactChildCard({
  issue,
  agents,
  isSelected,
  onSelect,
}: {
  issue: Issue;
  agents: Agent[];
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const canonical = STATUS_LABELS[issue.status] || 'backlog';
  const dotColor = canonical === 'done' ? 'bg-success' :
                   canonical === 'verifying_on_main' ? 'bg-info' :
                   canonical === 'in_progress' ? 'bg-warning' :
                   canonical === 'in_review' ? 'bg-signal-review' :
                   'bg-muted-foreground';

  const issueIdLower = issue.identifier.toLowerCase();
  const hasAgent = agents.some(
    a => a.issueId?.toLowerCase() === issueIdLower && isAgentSessionAttachable(a)
  );

  return (
    <IssueCardPrimitive
      issueId={issue.identifier}
      priority={issue.priority}
      selected={isSelected}
      runningCard={hasAgent}
      onClick={onSelect}
      className="rounded-none border-0 bg-transparent shadow-none hover:translate-y-0 hover:bg-popover/50"
    >
      <div className="relative flex items-center gap-2 px-3 py-1.5 transition-colors">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <a
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-medium text-primary/70 hover:text-primary shrink-0"
        >
          {issue.identifier}
        </a>
        <span className="text-xs text-foreground truncate flex-1">{issue.title}</span>
        <TrackerShadowBadges issue={issue} compact />
        {hasAgent && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" title="Agent running" />
        )}
      </div>
    </IssueCardPrimitive>
  );
}

// List view row — compact row for list view grouped by labels
export function ListIssueRow({
  issue,
  issueWorkAgentsById,
  agents,
  specialists,
  issueCosts,
  costsLoading,
  selectedIssue,
  onSelectIssue,
  onPlan,
  isBulkSelected,
  onBulkToggle,
}: {
  issue: Issue;
  issueWorkAgentsById?: Map<string, Agent[]>;
  agents: Agent[];
  /** PAN-1048 — role-tagged agents (review / test / ship) for the visible cycle. */
  specialists: Agent[];
  issueCosts: Record<string, IssueCost>;
  costsLoading?: boolean;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onPlan: (issue: Issue, autoStart?: boolean) => void;
  isBulkSelected?: boolean;
  onBulkToggle?: () => void;
}) {
  const isSelected = selectedIssue === issue.identifier;
  const canonical = STATUS_LABELS[issue.status] || 'backlog';
  const rowRef = useRef<HTMLDivElement>(null);

  // Auto-scroll into view when selected via search
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  // Status indicator color
  const statusColor = canonical === 'done' ? 'bg-success' :
                      canonical === 'verifying_on_main' ? 'bg-info' :
                      canonical === 'in_review' ? 'bg-signal-review' :
                      canonical === 'in_progress' ? 'bg-warning' :
                      canonical === 'todo' ? 'bg-primary' :
                      'bg-muted-foreground';

  // Get cost for this issue
  const cost = issueCosts[issue.identifier.toLowerCase()];

  // Check for running agents (exclude planning agents — they don't block the plan button)
  const issueIdLower = issue.identifier.toLowerCase();
  const workAgents = useMemo(() => {
    if (issueWorkAgentsById) {
      return issueWorkAgentsById.get(issueIdLower) ?? [];
    }
    return getIssueWorkAgentMap(agents).get(issueIdLower) ?? [];
  }, [agents, issueWorkAgentsById, issueIdLower]);
  // PAN-1048: standby = work agent that finished its run but kept its tmux session
  // alive for review/UAT response. Replaces the legacy agentPhase === 'review-response'
  // signal — agentPhase no longer exists after the role primitive hard cut.
  const standbyAgent = workAgents.find(
    (workAgent) =>
      workAgent.status === 'stopped' &&
      (workAgent.role ?? 'work') === 'work' &&
      !!workAgent.lifecycle?.hasLiveTmuxSession,
  );
  const isRunning = workAgents.some(isAgentSessionAttachable) || !!standbyAgent;
  const hasMultipleWorkAgents = workAgents.length > 1;

  // Check for specialists — PAN-1048 — role-tagged agents whose issueId matches.
  const issueSpecialists = specialists.filter(
    (s) => s.issueId?.toLowerCase() === issueIdLower && s.status !== 'stopped'
  );

  // Parse difficulty from labels
  const difficulty = parseDifficultyLabel(issue.labels || []);

  return (
    <IssueCardPrimitive
      ref={rowRef}
      testId={`list-issue-card-${issue.identifier}`}
      issueId={issue.identifier}
      priority={issue.priority}
      selected={isSelected}
      bulkSelected={isBulkSelected}
      runningCard={isRunning}
      onClick={() => onSelectIssue(isSelected ? null : issue.identifier)}
      className="rounded-none border-0 border-b border-border/60 bg-transparent shadow-none hover:translate-y-0 hover:bg-popover/50"
    >
      <div className="relative flex items-center gap-3 px-4 py-3 transition-colors">
        {/* Bulk selection checkbox */}
        {onBulkToggle && (
          <input
            type="checkbox"
            checked={isBulkSelected || false}
            onChange={(e) => {
              e.stopPropagation();
              onBulkToggle();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer shrink-0"
            aria-label={`Select ${issue.identifier}`}
            data-testid={`card-select-${issue.identifier}`}
          />
        )}
        {/* Status indicator */}
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={canonical} />

        {/* Issue identifier — clicking selects the card, use ExternalLink icon to open in tracker */}
        <span className="text-xs text-muted-foreground shrink-0 font-mono">
          {issue.identifier}
        </span>

        {/* Title - dimmed/strikethrough for canceled issues */}
        <span className={`text-sm truncate flex-1 min-w-0 ${
          canonical === 'canceled'
            ? 'text-muted-foreground line-through'
            : 'text-foreground'
        }`}>{issue.title}</span>

        {/* Priority indicator */}
        {issue.priority === 1 && <span className="text-xs text-destructive-foreground font-medium shrink-0">Urgent</span>}
        {issue.priority === 2 && <span className="text-xs text-warning-foreground font-medium shrink-0">High</span>}

        {/* Difficulty badge */}
        {difficulty && (
          <DifficultyBadge level={difficulty} />
        )}

        {/* Cost */}
        {costsLoading && !cost && (
          <span className="w-10 h-4 bg-popover rounded animate-pulse shrink-0" />
        )}
        {cost && cost.totalCost > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${getCostColor(cost.totalCost)}`}>
            {formatCost(cost.totalCost)}
          </span>
        )}

        {/* Assignee */}
        {issue.assignee && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            <User className="w-3 h-3" />
            {issue.assignee.name.split(' ')[0]}
          </span>
        )}

        {/* Running agent indicator */}
        {isRunning && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" title="Agent running" />
        )}
        {hasMultipleWorkAgents && (
          <span className="rounded-full border border-border/70 bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
            {workAgents.length} slots
          </span>
        )}

        {/* Specialist indicators — PAN-1048 keyed on role primitive */}
        {issueSpecialists.map((s) => (
          <span key={s.id} className="text-xs text-primary shrink-0" title={`${s.role} agent`}>
            {s.role === 'review' ? '👁️' : s.role === 'test' ? '🧪' : s.role === 'ship' ? '🔀' : '🤖'}
          </span>
        ))}

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Plan/Start button for backlog/todo, plus in_progress issues with no running
              agent (e.g. PAN-977 hit the empty-spawn bug and needs re-planning). */}
          {!isRunning && (canonical === 'backlog' || canonical === 'todo' || canonical === 'in_progress') && (
            <div className="inline-flex items-center rounded border border-border/70 overflow-hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlan(issue);
                }}
                className="p-1 text-muted-foreground hover:text-primary transition-colors"
                title={canonical === 'in_progress' ? 'Re-plan issue' : 'Plan issue'}
                data-testid={`list-plan-${issue.identifier}`}
              >
                <Play className="w-3.5 h-3.5" />
              </button>
              {canonical !== 'in_progress' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlan(issue, true);
                  }}
                  className="p-1 text-primary hover:text-primary/80 border-l border-border/70 transition-colors"
                  title="Auto-plan issue"
                  data-testid={`list-auto-plan-${issue.identifier}`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* View button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectIssue(issue.identifier);
            }}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="View details"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          {/* External link */}
          <a
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Open in tracker"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </IssueCardPrimitive>
  );
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

type CycleFilter = 'current' | 'all' | 'backlog' | 'canceled';

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

  const [activeDragIssue, setActiveDragIssue] = useState<Issue | null>(null);
  const [activeDragStatus, setActiveDragStatus] = useState<CanonicalState | null>(null);
  const [activeOverId, setActiveOverId] = useState<string | null>(null);
  const [columnOrderOverrides, setColumnOrderOverrides] = useState<Record<string, string[]>>({});

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

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

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const issueId = active.id as string;
    const issue = issues?.find(i => i.id === issueId);
    if (issue) {
      setActiveDragIssue(issue);
      setActiveDragStatus(STATUS_LABELS[issue.status] as CanonicalState);
    }
  }, [issues]);

  // Handle drag over
  const handleDragOver = useCallback((event: DragOverEvent) => {
    setActiveOverId((event.over?.id as string) ?? null);
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const activeIssue = active.data.current?.issue as Issue | undefined;
    const overIssue = issues.find((issue) => issue.id === over?.id || issue.identifier === over?.id);

    if (activeIssue && overIssue && activeIssue.id !== overIssue.id) {
      const activeStatus = STATUS_LABELS[activeIssue.status] as CanonicalState | undefined;
      const overStatus = STATUS_LABELS[overIssue.status] as CanonicalState | undefined;
      if (activeStatus && activeStatus === overStatus) {
        setColumnOrderOverrides((prev) => {
          const sourceOrder = prev[activeStatus] ?? issues
            .filter((issue) => STATUS_LABELS[issue.status] === activeStatus)
            .map((issue) => issue.identifier);
          const nextOrder = sourceOrder.filter((id) => id !== activeIssue.identifier);
          const overIndex = nextOrder.indexOf(overIssue.identifier);
          if (overIndex === -1) return prev;
          nextOrder.splice(overIndex, 0, activeIssue.identifier);
          return { ...prev, [activeStatus]: nextOrder };
        });
      }
    }

    setActiveDragIssue(null);
    setActiveDragStatus(null);
    setActiveOverId(null);
  }, [issues]);

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

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

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
      <div className="flex flex-col gap-2">
        {/* Row 1: Cycle + controls */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Cycle:</span>
            <div className="flex rounded-lg overflow-hidden border border-border">
              {(['current', 'all', 'backlog', 'canceled'] as CycleFilter[]).map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setCycleFilter(cycle)}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    cycleFilter === cycle
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-foreground/70 hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {cycle === 'current' ? 'Current' : cycle === 'all' ? 'All' : cycle === 'backlog' ? 'Backlog' : 'Canceled'}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(e) => setIncludeCompleted(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-ring focus:ring-offset-surface"
            />
            <span className="text-sm font-medium text-muted-foreground">Include closed-out</span>
          </label>

          <button
            onClick={async () => {
              try {
                await fetch('/api/trackers/refresh', { method: 'POST' });
                await refreshDashboardState(queryClient);
              } catch (e) {
                console.error('Refresh failed:', e);
              }
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-background border border-border hover:bg-accent rounded-lg transition-colors"
            title="Force refresh all trackers"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <span className="text-sm text-muted-foreground">
            {issues?.length || 0} issues
          </span>

          {/* Expand/Collapse all Rally features — only visible when Rally hierarchy exists */}
          {hasAnyRallyHierarchy && cycleFilter === 'current' && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={allExpanded ? collapseAllFeatures : expandAllFeatures}
                className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-background border border-border hover:bg-accent rounded-lg transition-colors"
                title={allExpanded ? 'Collapse all features' : 'Expand all features'}
              >
                {allExpanded ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>{allExpanded ? 'Collapse' : 'Expand'} all</span>
              </button>
            </div>
          )}
        </div>

        {/* Row 2: Project filter */}
        {projects.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">Projects:</span>
            {projects.map((project) => {
              const isExplicitlySelected = selectedProjects.has(project.id);
              return (
                <button
                  key={project.id}
                  onClick={() => toggleProject(project.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                    isExplicitlySelected
                      ? 'bg-accent text-foreground border-foreground/20'
                      : selectedProjects.size === 0
                        ? 'bg-card text-foreground/70 border-foreground/15 hover:bg-accent hover:text-foreground hover:border-foreground/25'
                        : 'bg-card text-muted-foreground border-foreground/10 hover:border-foreground/20 hover:text-foreground opacity-50'
                  }`}
                  title={isExplicitlySelected ? `Remove ${project.name} filter` : `Filter to ${project.name}`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color || '#6b7280' }}
                  />
                  {project.name}
                </button>
              );
            })}
            {selectedProjects.size > 0 && (
              <button
                onClick={() => setSelectedProjects(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

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

// ColumnContent — renders issues with Rally hierarchy grouping
function ColumnContent({
  issues,
  issueWorkAgentsById,
  agents,
  specialists,
  issueCosts,
  costsLoading,
  selectedIssue,
  onSelectIssue,
  onOpenIssue,
  onPlan,
  onViewBeads,
  onViewVBrief,
  collapsedFeatures,
  onToggleFeature,
  bulkSelectedIds,
  onBulkToggle,
  planningStateById,
  workspaceByIssueId,
}: {
  issues: Issue[];
  issueWorkAgentsById: Map<string, Agent[]>;
  agents: Agent[];
  /** PAN-1048 — role-tagged agents (review / test / ship). */
  specialists: Agent[];
  issueCosts: Record<string, IssueCost>;
  costsLoading?: boolean;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onOpenIssue: (id: string) => void;
  onPlan: (issue: Issue, autoStart?: boolean) => void;
  onViewBeads: (issue: Issue) => void;
  onViewVBrief?: (issue: Issue) => void;
  collapsedFeatures: Set<string>;
  onToggleFeature: (featureId: string) => void;
  bulkSelectedIds?: Set<string>;
  onBulkToggle?: (issueId: string) => void;
  planningStateById?: Record<string, PlanningState>;
  workspaceByIssueId?: Record<string, WorkspaceData>;
}) {
  // Check if any Rally issues with hierarchy exist
  const hasRallyHierarchy = issues.some(i => i.artifactType?.includes('PortfolioItem'));
  const hierarchy = hasRallyHierarchy ? buildHierarchy(issues) : null;

  const renderIssueCard = (issue: Issue) => {
    const issueIdLower = issue.identifier.toLowerCase();
    const workAgents = issueWorkAgentsById.get(issueIdLower) ?? [];
    const workAgent = workAgents[0];
    const planningAgent = agents.find(
      (a) => a.issueId?.toLowerCase() === issueIdLower && a.id?.startsWith('planning-')
    );
    const issueSpecialists = specialists.filter(
      (s) => s.issueId?.toLowerCase() === issueIdLower && s.status !== 'stopped'
    );

    return (
      <DraggableCardWrapper key={issue.id} issue={issue}>
        <IssueCard
          issue={issue}
        workAgent={workAgent}
        workAgents={workAgents}
        planningAgent={planningAgent}
        specialists={issueSpecialists}
        cost={issueCosts[issue.identifier.toLowerCase()]}
        costsLoading={costsLoading}
        isSelected={selectedIssue === issue.identifier}
        onSelect={() => onOpenIssue(issue.identifier)}
        onPlan={(autoStart) => onPlan(issue, autoStart)}
        onViewBeads={(i) => onViewBeads(i)}
        onViewVBrief={onViewVBrief ? (i) => onViewVBrief(i) : undefined}
        isBulkSelected={bulkSelectedIds?.has(issue.identifier)}
        onBulkToggle={onBulkToggle ? () => onBulkToggle(issue.identifier) : undefined}
        planningState={planningStateById?.[issue.identifier]}
          workspace={workspaceByIssueId?.[issue.identifier.toUpperCase()]}
        />
      </DraggableCardWrapper>
    );
  };

  if (issues.length === 0) {
    return (
      <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
        <div className="text-center text-muted-foreground py-8 text-sm">
          No issues
        </div>
      </div>
    );
  }

  // Flat rendering (no hierarchy)
  if (!hierarchy) {
    return (
      <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
        {issues.map(renderIssueCard)}
      </div>
    );
  }

  // Hierarchical rendering with Feature groups
  return (
    <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
      {hierarchy.map((group) => {
        if (group.type === 'orphan') {
          return renderIssueCard(group.children[0]);
        }

        // Feature group
        const feature = group.feature!;
        const isExpanded = !collapsedFeatures.has(feature.identifier);

        return (
          <FeatureCard
            key={`feature-${feature.id}`}
            feature={feature}
            childCount={group.children.length}
            isExpanded={isExpanded}
            onToggle={() => onToggleFeature(feature.identifier)}
            isSelected={selectedIssue === feature.identifier}
            onSelect={() => onSelectIssue(
              selectedIssue === feature.identifier ? null : feature.identifier
            )}
            onPlan={() => onPlan(feature)}
            onViewBeads={() => onViewBeads(feature)}
            onViewVBrief={onViewVBrief ? () => onViewVBrief(feature) : undefined}
            planningState={planningStateById?.[feature.identifier]}
          >
            {group.children.map(child => (
              <CompactChildCard
                key={child.id}
                issue={child}
                agents={agents}
                isSelected={selectedIssue === child.identifier}
                onSelect={() => onSelectIssue(
                  selectedIssue === child.identifier ? null : child.identifier
                )}
              />
            ))}
          </FeatureCard>
        );
      })}
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

// DraggableCard wrapper component
interface DraggableCardWrapperProps {
  issue: Issue;
  children: React.ReactNode;
}

function DraggableCardWrapper({ issue, children }: DraggableCardWrapperProps) {
  const { attributes, listeners, setNodeRef: setDraggableNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: issue.id,
    data: { issue },
  });
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }, [setDraggableNodeRef, setDroppableNodeRef]);

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`${isDragging ? 'opacity-30' : 'opacity-100'} cursor-grab active:cursor-grabbing`}
    >
      {children}
    </div>
  );
}

// DragOverlayCard component for ghost card
interface DragOverlayCardProps {
  issue: Issue;
}

function DragOverlayCard({ issue }: DragOverlayCardProps) {
  return (
    <div className="bg-popover rounded-lg p-3 border-l-4 border-l-blue-500 shadow-2xl rotate-2 scale-105 opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">{issue.identifier}</span>
      </div>
      <p className="text-sm text-foreground mt-1 line-clamp-2">{issue.title}</p>
    </div>
  );
}

// Agent Warning Dialog
interface AgentWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  issue: Issue | null;
}

function AgentWarningDialog({ isOpen, onClose, onConfirm, issue }: AgentWarningDialogProps) {
  if (!isOpen || !issue) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 badge-bg-warning rounded-lg">
            <AlertTriangle className="w-6 h-6 text-warning-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Active Agent Warning
            </h3>
            <p className="text-foreground text-sm mb-4">
              <strong>{issue.identifier}</strong> has an active agent working on it.
              Moving this issue may disrupt the agent's work.
            </p>
            <p className="text-muted-foreground text-xs mb-6">
              Are you sure you want to proceed?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 bg-warning hover:bg-warning/90 text-foreground rounded-lg transition-colors text-sm"
              >
                Move Anyway
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sync Prompt Dialog
interface SyncPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSync: (syncToTracker: boolean, options?: { cleanupWorkspace?: boolean; stopAgents?: boolean }) => void;
  issue: Issue | null;
}

function SyncPromptDialog({ isOpen, onClose, onSync, issue }: SyncPromptDialogProps) {
  const [cleanupWorkspace, setCleanupWorkspace] = useState(false);
  const [stopAgents, setStopAgents] = useState(false);

  if (!isOpen || !issue) return null;

  // Determine tracker type from issue source
  const trackerName = issue.source === 'github' ? 'GitHub' : 'Linear';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 badge-bg-success rounded-lg">
            <Check className="w-6 h-6 text-success-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Move to Done
            </h3>
            <p className="text-foreground text-sm mb-4">
              You're moving <strong>{issue.identifier}</strong> to Done.
            </p>

            {/* Cleanup options */}
            <div className="space-y-2 mb-4 p-3 bg-popover/50 rounded-lg">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanupWorkspace}
                  onChange={(e) => setCleanupWorkspace(e.target.checked)}
                  className="rounded border-border bg-popover text-success focus:ring-ring"
                />
                Clean up workspace
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={stopAgents}
                  onChange={(e) => setStopAgents(e.target.checked)}
                  className="rounded border-border bg-popover text-success focus:ring-ring"
                />
                Stop running agents
              </label>
            </div>

            <p className="text-muted-foreground text-xs mb-4">
              Sync status change to {trackerName}?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => onSync(false, { cleanupWorkspace, stopAgents })}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                Shadow Only
              </button>
              <button
                onClick={() => onSync(true, { cleanupWorkspace, stopAgents })}
                className="px-4 py-2 bg-success hover:bg-success/90 text-foreground rounded-lg transition-colors text-sm"
              >
                Sync to {trackerName}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Undo Toast component
interface UndoToastProps {
  isVisible: boolean;
  onUndo: () => void;
  onClose: () => void;
}

function UndoToast({ isVisible, onUndo, onClose }: UndoToastProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl px-4 py-3 flex items-center gap-4">
        <span className="text-sm text-foreground">Issue moved</span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <Undo className="w-4 h-4" />
          Undo
        </button>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Simple Beads Dialog component
function BeadsDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-success-foreground" />
            <h2 className="font-semibold text-foreground">Tasks: {issue.identifier}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BeadsTasksPanel with list/graph toggle */}
        <div className="flex-1 overflow-hidden">
          <BeadsTasksPanel issueId={issue.identifier} />
        </div>
      </div>
    </div>
  );
}

/** Diverged badge with Unstick button — shown when main diverged during git push */
export function DivergedBadge({ issueIdentifier, stuckReason, stuckDetails }: { issueIdentifier: string; stuckReason?: string | null; stuckDetails?: string | null }) {
  const [unstickError, setUnstickError] = useState<string | null>(null);

  // Parse SHA details stored by pushApproveMain when MainDivergedError was thrown
  let shaInfo = '';
  if (stuckDetails) {
    try {
      const d = JSON.parse(stuckDetails) as Record<string, unknown>;
      const local = typeof d.localSha === 'string' ? d.localSha.slice(0, 7) : null;
      const remote = typeof d.remoteSha === 'string' ? d.remoteSha.slice(0, 7) : null;
      if (local && remote) shaInfo = ` (local: ${local}, remote: ${remote})`;
      else if (remote) shaInfo = ` (remote: ${remote})`;
    } catch { /* ignore malformed details */ }
  }

  const titleText = stuckReason
    ? `Push blocked: ${stuckReason}${shaInfo}. Run: git reset --hard origin/main, then click Unstick to retry.`
    : `Push blocked due to divergence from origin/main${shaInfo}. Run: git reset --hard origin/main, then click Unstick to retry.`;

  return (
    <span className="flex flex-col gap-0.5">
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-900/70 text-red-300 border border-red-500/60"
        title={titleText}
      >
        <XCircle className="w-3 h-3" />
        Diverged
        <button
          className="ml-1 underline text-red-200 hover:text-foreground text-xs leading-none"
          onClick={async (e) => {
            e.stopPropagation();
            setUnstickError(null);
            try {
              const res = await fetch(`/api/workspaces/${encodeURIComponent(issueIdentifier)}/unstick`, { method: 'POST' });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setUnstickError(body.error ?? res.statusText);
              } else {
                // Optimistic update: mirror what the server resets so the badge
                // disappears immediately without waiting for the WS round-trip.
                // Server sets: stuck=false, reviewStatus/testStatus/mergeStatus='pending', readyForMerge=false.
                const state = useDashboardStore.getState();
                const upperKey = issueIdentifier.toUpperCase();
                const current = state.reviewStatusByIssueId[upperKey]
                  ?? state.reviewStatusByIssueId[issueIdentifier];
                if (current) {
                  const key = state.reviewStatusByIssueId[upperKey] ? upperKey : issueIdentifier;
                  // Optimistic update: clear stuck fields and reset lifecycle.
                  // Recovery requires `git reset --hard origin/main`, making prior results invalid.
                  // The WS status_changed event from the server will reconcile the full state.
                  useDashboardStore.setState((s) => ({
                    reviewStatusByIssueId: {
                      ...s.reviewStatusByIssueId,
                      [key]: {
                        ...current,
                        stuck: undefined,
                        stuckReason: undefined,
                        stuckDetails: undefined,
                        reviewStatus: 'pending',
                        testStatus: 'pending',
                        mergeStatus: 'pending',
                        readyForMerge: false,
                      },
                    },
                  }));
                }
              }
            } catch (err: unknown) {
              setUnstickError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Unstick
        </button>
      </span>
      {unstickError && (
        <span className="text-xs text-red-400 px-1" title={unstickError}>
          Unstick failed: {unstickError}
        </span>
      )}
    </span>
  );
}

/**
 * PAN-794: Review-infrastructure breaker badge.
 *
 * Shown when the deacon trips the circuit breaker after repeated
 * parallel-review re-dispatch failures. Clicking Retry calls the unstick
 * endpoint, which skips the git-safe-state check for this reason and opens a
 * fresh recovery cycle.
 */
export function ReviewInfraStuckBadge({ issueIdentifier, retries, recoveryStartedAt }: { issueIdentifier: string; retries: number; recoveryStartedAt?: string }) {
  const [unstickError, setUnstickError] = useState<string | null>(null);

  const recoveryAge = recoveryStartedAt
    ? Math.floor((Date.now() - new Date(recoveryStartedAt).getTime()) / 60_000)
    : undefined;
  const recoveryAgeLabel = recoveryAge != null
    ? recoveryAge >= 60 ? `${Math.floor(recoveryAge / 60)}h ${recoveryAge % 60}m` : `${recoveryAge}m`
    : undefined;

  const titleText =
    `Review infrastructure failed after ${retries} retries (spawn/dispatch issue). ` +
    (recoveryAgeLabel ? `Recovery cycle running for ${recoveryAgeLabel}. ` : '') +
    `Parallel review is paused — click Retry to open a fresh recovery cycle.`;

  return (
    <span className="flex flex-col gap-0.5">
      <span
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/70 text-amber-200 border border-amber-500/60"
        title={titleText}
      >
        <XCircle className="w-3 h-3" />
        Review stuck{recoveryAgeLabel && <span className="text-amber-400/80 ml-0.5">({recoveryAgeLabel})</span>}
        <button
          className="ml-1 underline text-amber-100 hover:text-foreground text-xs leading-none"
          onClick={async (e) => {
            e.stopPropagation();
            setUnstickError(null);
            try {
              const res = await fetch(`/api/workspaces/${encodeURIComponent(issueIdentifier)}/unstick`, { method: 'POST' });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setUnstickError(body.error ?? res.statusText);
              } else {
                const state = useDashboardStore.getState();
                const upperKey = issueIdentifier.toUpperCase();
                const current = state.reviewStatusByIssueId[upperKey]
                  ?? state.reviewStatusByIssueId[issueIdentifier];
                if (current) {
                  const key = state.reviewStatusByIssueId[upperKey] ? upperKey : issueIdentifier;
                  useDashboardStore.setState((s) => ({
                    reviewStatusByIssueId: {
                      ...s.reviewStatusByIssueId,
                      [key]: {
                        ...current,
                        stuck: undefined,
                        stuckReason: undefined,
                        stuckDetails: undefined,
                        reviewStatus: 'pending',
                        testStatus: 'pending',
                        mergeStatus: 'pending',
                        readyForMerge: false,
                        reviewRetryCount: 0,
                        recoveryStartedAt: undefined,
                      },
                    },
                  }));
                }
              }
            } catch (err: unknown) {
              setUnstickError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Retry
        </button>
      </span>
      {unstickError && (
        <span className="text-xs text-red-400 px-1" title={unstickError}>
          Retry failed: {unstickError}
        </span>
      )}
    </span>
  );
}

/**
 * Per-issue "Pause Deacon" toggle. When activated, Deacon patrol skips this
 * issue entirely on every cycle until the operator clicks Resume. Distinct
 * from stuck/unstick — pause is an explicit human opt-out, not a failure
 * recovery path. Rendered prominently on every IssueCard.
 */
export function DeaconIgnoreButton({
  issueIdentifier,
  ignored,
  reason,
}: {
  issueIdentifier: string;
  ignored: boolean;
  reason?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = !ignored;
      const res = await fetch(`/api/workspaces/${encodeURIComponent(issueIdentifier)}/deacon-ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignored: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? res.statusText);
      } else {
        const state = useDashboardStore.getState();
        const upperKey = issueIdentifier.toUpperCase();
        const currentKey = state.reviewStatusByIssueId[upperKey] ? upperKey : issueIdentifier;
        const current = state.reviewStatusByIssueId[currentKey];
        if (current) {
          useDashboardStore.setState((s) => ({
            reviewStatusByIssueId: {
              ...s.reviewStatusByIssueId,
              [currentKey]: {
                ...current,
                deaconIgnored: next || undefined,
                deaconIgnoredAt: next ? new Date().toISOString() : undefined,
                deaconIgnoredReason: next ? current.deaconIgnoredReason : undefined,
              },
            },
          }));
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (ignored) {
    return (
      <span className="flex flex-col gap-0.5">
        <button
          onClick={toggle}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold uppercase tracking-wide bg-purple-900/70 text-purple-100 border border-purple-400/60 hover:bg-purple-800/80 disabled:opacity-60"
          title={reason ? `Deacon paused: ${reason} — click to resume` : 'Deacon paused — click to resume patrol for this issue'}
          data-testid={`card-pause-deacon-${issueIdentifier}`}
        >
          <Pause className="w-3 h-3" />
          Deacon Paused
          <span className="underline ml-1">Resume</span>
        </button>
        {error && <span className="text-xs text-red-400 px-1" title={error}>Failed: {error}</span>}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-0.5">
      <button
        onClick={toggle}
        disabled={busy}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-popover text-muted-foreground border border-white/10 hover:bg-purple-900/40 hover:text-purple-100 hover:border-purple-500/50 disabled:opacity-60"
        title="Tell Deacon to stop patrolling this issue (no re-dispatch, no pokes, no auto-completion)"
        data-testid={`card-pause-deacon-${issueIdentifier}`}
      >
        <Pause className="w-3 h-3" />
        Pause Deacon
      </button>
      {error && <span className="text-xs text-red-400 px-1" title={error}>Failed: {error}</span>}
    </span>
  );
}

interface PlanningState {
  hasPlan: boolean;
  hasBeads: boolean;
  planningComplete: boolean;
}

interface IssueCardProps {
  issue: Issue;
  workAgent?: Agent;
  workAgents?: Agent[];
  planningAgent?: Agent;
  /** PAN-1048 — role-tagged agents (review / test / ship) for this issue. */
  specialists?: Agent[];
  cost?: IssueCost;
  costsLoading?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onPlan: (autoStart?: boolean) => void; // Lifted to parent to survive re-renders
  onViewBeads?: (issue: Issue) => void;
  onViewVBrief?: (issue: Issue) => void;
  isBulkSelected?: boolean;
  onBulkToggle?: () => void;
  planningState?: PlanningState;
  workspace?: WorkspaceData;
}

const CARD_VERB_BY_PHASE: Partial<Record<PipelinePhase, 'WORK RUNNING' | 'REVIEW RUNNING' | 'SHIP RUNNING' | 'PLANNING' | 'INPUT' | 'READY TO MERGE' | 'MERGED' | 'CHANGES REQUESTED' | 'QUEUED FOR PLAN'>> = {
  QUEUED_FOR_PLAN: 'QUEUED FOR PLAN',
  PLANNING: 'PLANNING',
  WORK_RUNNING: 'WORK RUNNING',
  INPUT: 'INPUT',
  REVIEW_RUNNING: 'REVIEW RUNNING',
  SHIP_RUNNING: 'SHIP RUNNING',
  CHANGES_REQUESTED: 'CHANGES REQUESTED',
  STUCK: 'CHANGES REQUESTED',
  READY_TO_MERGE: 'READY TO MERGE',
  MERGED: 'MERGED',
};

export function IssueCard({ issue, workAgent, workAgents = [], planningAgent, specialists = [], cost, isSelected, onSelect, isBulkSelected, onBulkToggle, planningState, workspace: workspaceProp }: IssueCardProps) {
  const [showCostModal, setShowCostModal] = useState(false);
  const [actionOpenSignal, setActionOpenSignal] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const stackHealth = workspaceProp?.stackHealth;
  const isStackUnhealthy = stackHealth?.healthy === false;
  const issueActions = useIssueActions(issue.identifier);
  const hasEnabledIssueAction = issueActions.all.some((view) => view.enabled);

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isSelected]);

  const reviewStatus = useDashboardStore(selectReviewStatus(issue.identifier || ''));
  const isMerged = reviewStatus?.mergeStatus === 'merged' || issue.mergeStatus === 'merged' || issue.labels?.some(l => l.toLowerCase() === 'merged');
  const isClosedNotMerged = reviewStatus?.mergeStatus === 'failed' || issue.mergeStatus === 'failed';
  const isReadyToMerge = !isMerged && !isClosedNotMerged && reviewStatus?.readyForMerge === true;
  const issueWorkAgents = workAgents.length > 0 ? workAgents : (workAgent ? [workAgent] : []);
  const activeAgent = issueWorkAgents.find(isAgentSessionAttachable) ?? issueWorkAgents[0] ?? planningAgent;
  const isRunning = issueWorkAgents.some(isAgentSessionAttachable);
  const canonical = issue.state ?? STATUS_LABELS[issue.status] ?? 'backlog';
  const issueActionPhase = deriveIssueActionPhase({
    reviewStatus,
    agent: activeAgent,
    workspace: { exists: !!(workspaceProp?.path || issue.workspacePath) },
    hasPlan: planningState?.hasPlan ?? issue.hasPlan ?? false,
    hasBeads: planningState?.hasBeads ?? issue.hasBeads ?? false,
    issueCanonicalState: canonical,
    isMerged,
  });
  const isPipelineStuck = issueActionPhase === 'STUCK';
  const pinActionRow = isRunning || issueActionPhase === 'STUCK' || issueActionPhase === 'INPUT' || issueActionPhase === 'READY_TO_MERGE';
  const cardVerb = CARD_VERB_BY_PHASE[issueActionPhase];
  const cardVerbBadge =
    canonical === 'verifying_on_main' ? <VerifyingOnMainBadge compact /> :
    cardVerb ? <VerbBadge variant={cardVerb} /> :
    null;
  const beadProgressColor =
    isReadyToMerge || isMerged || canonical === 'done' ? 'var(--success)' :
    canonical === 'in_review' ? 'var(--warning)' :
    canonical === 'in_progress' ? 'var(--info)' :
    canonical === 'todo' ? 'var(--signal-review)' :
    'var(--muted-foreground)';
  const reviewSpecialists = specialists.filter((s) => s.role === 'review' && s.status !== 'stopped');

  // PAN-1779: surface the pause gate on the card — paused agents are
  // deliberately parked (amber = a human must act), never generic "stopped".
  const pausedAgent = [...issueWorkAgents, ...(planningAgent ? [planningAgent] : [])]
    .find((a) => (a as { paused?: boolean }).paused === true);
  const pausedReason = pausedAgent ? (pausedAgent as { pausedReason?: string }).pausedReason : undefined;
  const handleUnpause = useCallback(async (event: ReactMouseEvent) => {
    event.stopPropagation();
    if (!pausedAgent) return;
    try {
      const res = await fetch(`/api/agents/${pausedAgent.id}/unpause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to unpause agent');
      toast.success(`${issue.identifier} unpaused — deacon resumes it on the next patrol`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unpause agent');
    }
  }, [pausedAgent, issue.identifier]);

  const agentSubText = activeAgent
    ? (reviewSpecialists.length > 0 && activeAgent.role === 'review'
      ? `${reviewSpecialists.length} reviewers · ${getFriendlyModelName(activeAgent.model)}`
      : issue.beadCounts
        ? `${getFriendlyModelName(activeAgent.model)} · bead ${issue.beadCounts.completed}/${issue.beadCounts.total}`
        : getFriendlyModelName(activeAgent.model))
    : '';
  const trackerRef = issue.source === 'github'
    ? `GitHub ${issue.identifier}`
    : issue.source === 'linear'
      ? `Linear ${issue.identifier}`
      : issue.identifier;

  return (
    <IssueCardPrimitive
      ref={cardRef}
      testId={`issue-card-${issue.identifier}`}
      issueId={issue.identifier}
      priority={issue.priority}
      selected={isSelected}
      bulkSelected={isBulkSelected}
      stuckCard={isStackUnhealthy || isPipelineStuck}
      pausedCard={!!pausedAgent}
      mergeReadyCard={isReadyToMerge}
      runningCard={isRunning}
      unhealthyCard={isStackUnhealthy}
      sessionLostCard={false}
      onClick={onSelect}
      onContextMenu={(event) => {
        if (!hasEnabledIssueAction) return;
        event.preventDefault();
        event.stopPropagation();
        setActionOpenSignal((value) => value + 1);
      }}
    >
      <div className="relative" style={{ padding: '12px 12px 10px' }}>
        {/* Hover overlays */}
        {onBulkToggle && (
          <div className={`absolute top-2 left-2 transition-opacity z-10 ${isBulkSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <input
              type="checkbox"
              checked={isBulkSelected || false}
              onChange={(event) => {
                event.stopPropagation();
                onBulkToggle();
              }}
              onClick={(event) => event.stopPropagation()}
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-border text-primary focus:ring-primary"
              aria-label={`Select ${issue.identifier}`}
            />
          </div>
        )}
        {cost && cost.totalCost > 0 && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); setShowCostModal(true); }}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${getCostColor(cost.totalCost)}`}
              data-testid={`card-cost-${issue.identifier}`}
            >
              <DollarSign className="h-3 w-3" />
              {formatCost(cost.totalCost).slice(1)}
            </button>
          </div>
        )}

        {/* Row 1: project mark + ID + verb badge */}
        <div className="flex items-center gap-2 mb-1.5">
          {issue.project ? (
            <div className="flex items-center gap-[5px]">
              <span
                className="block rounded-[2px]"
                style={{ width: 8, height: 8, backgroundColor: issue.project.color }}
              />
              <span className="font-mono text-[10px] text-muted-foreground">{issue.identifier}</span>
            </div>
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground">{issue.identifier}</span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {pausedAgent && (
              <>
                <span
                  data-testid={`card-paused-${issue.identifier}`}
                  className="inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[10px] font-medium badge-border-warning badge-bg-warning text-warning-foreground"
                  title={pausedReason ? `Paused: ${pausedReason}` : 'Agent is paused'}
                >
                  ⏸ Paused
                </span>
                <button
                  type="button"
                  data-testid={`card-unpause-${issue.identifier}`}
                  onClick={handleUnpause}
                  className="inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[10px] font-medium badge-border-warning badge-bg-warning text-warning-foreground hover:bg-warning/20"
                  title={pausedReason ? `Unpause — paused: ${pausedReason}` : 'Unpause this agent'}
                >
                  ▶ Unpause
                </button>
              </>
            )}
            {cardVerbBadge}
          </span>
        </div>

        {/* Title */}
        <h3
          className="text-[13px] leading-[1.35] text-foreground mb-2"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {issue.title}
        </h3>

        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2.5">
            {issue.labels.map((label) => (
              <span
                key={label}
                className="text-[10px] font-medium px-[6px] py-px rounded-sm"
                style={{
                  background: 'rgb(255 255 255 / 5%)',
                  border: '1px solid var(--border)',
                  color: 'var(--muted-foreground)',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Bead progress */}
        {issue.beadCounts && (
          <div className="flex items-center gap-2 mt-2" data-component="bead-progress" data-progress={issue.beadCounts.completed}>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
              Beads {issue.beadCounts.completed}/{issue.beadCounts.total}
            </span>
            <div
              className="flex-1 h-[3px] rounded-[2px] overflow-hidden"
              style={{ background: 'var(--accent)' }}
            >
              <div
                className="h-full rounded-[2px]"
                style={{
                  width: `${(issue.beadCounts.completed / issue.beadCounts.total) * 100}%`,
                  background: beadProgressColor,
                }}
              />
            </div>
          </div>
        )}

        {/* Foot */}
        <div className="flex items-center gap-2 pt-2 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex flex-col min-w-0 gap-0.5 flex-1">
            {activeAgent ? (
              <>
                <span className="font-mono text-[10px] text-foreground truncate">{activeAgent.id}</span>
                <span className="font-mono text-[9px] text-muted-foreground truncate">{agentSubText}</span>
              </>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground italic" style={{ fontFamily: '"DM Sans", sans-serif' }}>
                  no agent
                </span>
                <span className="font-mono text-[9px] text-muted-foreground truncate">{trackerRef}</span>
              </>
            )}
          </div>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
            {activeAgent ? formatRuntime(activeAgent.startedAt) : '—'}
          </span>
          <span
            className="w-[18px] h-[18px] rounded-full grid place-items-center text-[9px] font-semibold text-white border border-border shrink-0"
            style={{
              background: avatarGradient(activeAgent?.id ?? issue.identifier),
            }}
          >
            {cardAvatarInitials(activeAgent?.id ?? issue.identifier)}
          </span>
        </div>

        <div
          data-component="board-card-action-row"
          data-visible-mode={pinActionRow ? 'pinned' : 'hover'}
          className={cn(
            'mt-2 flex items-center gap-1 border-t border-border pt-2 transition-opacity',
            !pinActionRow && '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <IssueActionMenu issueId={issue.identifier} mode="hybrid" className="flex w-full items-center gap-1" openSignal={actionOpenSignal} />
        </div>

        <CostBreakdownModal
          issueId={issue.identifier}
          isOpen={showCostModal}
          onClose={() => setShowCostModal(false)}
        />
      </div>
    </IssueCardPrimitive>
  );
}
