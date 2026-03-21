import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  defaultDropAnimationSideEffects,
  DropAnimation,
} from '@dnd-kit/core';
import {
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { Issue, Agent, LinearProject, STATUS_ORDER, STATUS_LABELS, CanonicalState } from '../types';
import { getFriendlyModelName } from './inspector/utils';
import { ExternalLink, User, Tag, Play, Eye, MessageCircle, X, Loader2, Filter, FileText, Github, List, CheckCircle, DollarSign, RotateCcw, CheckCheck, HelpCircle, Trash2, Cloud, Monitor, AlertTriangle, Undo, Check, ChevronDown, ChevronRight, GitMerge, Sparkles, Ban, XCircle, AlertCircle } from 'lucide-react';
import { PlanDialog } from './PlanDialog';
import { parseDifficultyLabel, ComplexityLevel } from '../../../../lib/cloister/complexity.js';
import { SpecialistAgent } from './SpecialistAgentCard';
import { useConfirm, useAlert } from './DialogProvider';


// Difficulty badge colors
const DIFFICULTY_COLORS: Record<ComplexityLevel, string> = {
  trivial: 'bg-green-900/50 text-green-400',
  simple: 'bg-green-900/50 text-green-400',
  medium: 'bg-yellow-900/50 text-yellow-400',
  complex: 'bg-orange-900/50 text-orange-400',
  expert: 'bg-red-900/50 text-red-400',
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

// Agent type icons for badges
const AGENT_ICONS: Record<string, string> = {
  work: '🤖',
  review: '👁️',
  test: '🧪',
  merge: '🔀'
};

// Agent attribution badge component
function AgentBadge({
  type,
  name,
  isConflict
}: {
  type: 'work' | 'review' | 'test' | 'merge';
  name: string;
  isConflict: boolean;
}) {
  const icon = AGENT_ICONS[type];
  const conflictClass = isConflict ? 'animate-[pulse_2s_ease-in-out_infinite]' : '';

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-blue-400 ${conflictClass}`}>
      <span>{icon}</span>
      <span>{name}</span>
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

// Format cost for display
function formatCost(cost: number): string {
  if (cost >= 100) {
    return `$${cost.toFixed(0)}`;
  } else if (cost >= 10) {
    return `$${cost.toFixed(1)}`;
  } else if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  } else if (cost > 0) {
    return `$${cost.toFixed(2)}`;
  }
  return '';
}

// Get cost badge color based on amount
function getLabelStyle(label: string): string {
  const l = label.toLowerCase();
  if (l === 'bug') return 'bg-red-900/40 text-red-400 border border-red-500/30';
  if (l === 'security') return 'bg-red-900/40 text-red-300 border border-red-500/30';
  if (l === 'enhancement') return 'bg-blue-900/40 text-blue-400 border border-blue-500/30';
  if (l === 'improvement') return 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/30';
  if (l === 'planning' || l === 'in-planning') return 'bg-purple-900/40 text-purple-400 border border-purple-500/30';
  if (l === 'in-progress') return 'bg-blue-900/40 text-blue-400 border border-blue-500/30';
  if (l === 'in-review') return 'bg-amber-900/40 text-amber-400 border border-amber-500/30';
  return 'bg-gray-800/60 text-gray-400 border border-gray-600/30';
}

function getCostColor(cost: number): string {
  if (cost >= 50) return 'bg-red-900/50 text-red-400';
  if (cost >= 20) return 'bg-orange-900/50 text-orange-400';
  if (cost >= 5) return 'bg-yellow-900/50 text-yellow-400';
  return 'bg-green-900/50 text-green-400';
}

async function fetchIssues(cycle: string = 'current', includeCompleted: boolean = false): Promise<Issue[]> {
  const params = new URLSearchParams();
  params.set('cycle', cycle);
  if (includeCompleted) params.set('includeCompleted', 'true');
  const res = await fetch(`/api/issues?${params}`);
  if (!res.ok) throw new Error('Failed to fetch issues');
  return res.json();
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchSpecialists(): Promise<SpecialistAgent[]> {
  const res = await fetch('/api/specialists');
  if (!res.ok) throw new Error('Failed to fetch specialists');
  const data = await res.json();
  return data.specialists ?? data;
}

function groupByStatus(issues: Issue[], showClosedOut: boolean = false): Record<string, Issue[]> {
  const grouped: Record<string, Issue[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    canceled: [],
  };

  for (const issue of issues) {
    // Skip closed-out issues unless explicitly included
    if (!showClosedOut && issue.labels?.some(l => l.toLowerCase() === 'closed-out')) {
      continue;
    }
    // Use targetCanonicalState if available (explicit column from drag-drop)
    // Otherwise fall back to shadowStatus mapping, then tracker status
    let status: string;
    if (issue.targetCanonicalState) {
      // Explicit canonical state from drag-drop - use directly
      status = issue.targetCanonicalState;
    } else if (issue.shadowStatus) {
      // Legacy shadow status mapping
      status = issue.shadowStatus === 'closed' ? 'done' :
               issue.shadowStatus === 'in_progress' ? (STATUS_LABELS[issue.status] || 'in_progress') :
               STATUS_LABELS[issue.status] || 'backlog';
    } else if (issue.derivedStatus) {
      // Derived status from child stories (Rally Features)
      status = issue.derivedStatus === 'closed' ? 'done' :
               issue.derivedStatus === 'in_progress' ? 'in_progress' :
               STATUS_LABELS[issue.status] || 'backlog';
    } else {
      status = STATUS_LABELS[issue.status] || 'backlog';
    }
    // Skip canceled issues - they're shown in a separate filter view, not kanban
    if (status === 'canceled') {
      continue;
    }

    if (grouped[status]) {
      grouped[status].push(issue);
    } else {
      grouped.backlog.push(issue);
    }
  }

  return grouped;
}

/**
 * Group issues by their labels for list view.
 * Issues with multiple labels appear in each label group.
 * Issues with no labels go into an 'Uncategorized' group.
 */
export function groupByLabels(issues: Issue[]): Record<string, Issue[]> {
  const grouped: Record<string, Issue[]> = {};
  const uncategorized: Issue[] = [];

  for (const issue of issues) {
    const labels = issue.labels || [];

    if (labels.length === 0) {
      uncategorized.push(issue);
    } else {
      for (const label of labels) {
        if (!grouped[label]) {
          grouped[label] = [];
        }
        grouped[label].push(issue);
      }
    }
  }

  // Add uncategorized group if there are any
  if (uncategorized.length > 0) {
    grouped['Uncategorized'] = uncategorized;
  }

  // Sort groups by label name
  const sorted: Record<string, Issue[]> = {};
  Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .forEach(key => {
      sorted[key] = grouped[key];
    });

  return sorted;
}

/**
 * Group issues by project for the backlog list view.
 */
function groupByProject(issues: Issue[]): { name: string; color?: string; issues: Issue[] }[] {
  const projectMap = new Map<string, { name: string; color?: string; issues: Issue[] }>();
  const noProject: Issue[] = [];

  for (const issue of issues) {
    if (issue.project) {
      const existing = projectMap.get(issue.project.id);
      if (existing) {
        existing.issues.push(issue);
      } else {
        projectMap.set(issue.project.id, {
          name: issue.project.name,
          color: issue.project.color,
          issues: [issue],
        });
      }
    } else {
      noProject.push(issue);
    }
  }

  const groups = Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  if (noProject.length > 0) {
    groups.push({ name: 'No Project', issues: noProject });
  }
  return groups;
}

/**
 * Group canceled issues by their specific cancellation type.
 * Groups: Canceled, Duplicate, Won't Do
 */
export function groupByCanceledType(issues: Issue[]): { name: string; issues: Issue[] }[] {
  const groups: Record<string, Issue[]> = {
    'Canceled': [],
    'Duplicate': [],
    "Won't Do": [],
    'Other': [],
  };

  for (const issue of issues) {
    const status = issue.status?.toLowerCase() || '';
    if (status === 'canceled' || status === 'cancelled') {
      groups['Canceled'].push(issue);
    } else if (status === 'duplicate') {
      groups['Duplicate'].push(issue);
    } else if (status === "won't do" || status === 'wontfix') {
      groups["Won't Do"].push(issue);
    } else {
      groups['Other'].push(issue);
    }
  }

  // Return non-empty groups in a consistent order
  const result: { name: string; issues: Issue[] }[] = [];
  if (groups['Canceled'].length > 0) result.push({ name: 'Canceled', issues: groups['Canceled'] });
  if (groups['Duplicate'].length > 0) result.push({ name: 'Duplicate', issues: groups['Duplicate'] });
  if (groups["Won't Do"].length > 0) result.push({ name: "Won't Do", issues: groups["Won't Do"] });
  if (groups['Other'].length > 0) result.push({ name: 'Other', issues: groups['Other'] });

  return result;
}

/**
 * Organize issues in a column into hierarchical groups.
 * Features (PortfolioItem) become parent groups; Stories/Defects with
 * a matching parentRef nest underneath. Orphans display normally.
 */
interface HierarchyGroup {
  type: 'feature' | 'orphan';
  feature?: Issue;       // The parent Feature issue (if type='feature')
  children: Issue[];     // Child stories/defects (if type='feature'), or [single issue] for orphans
}

function buildHierarchy(issues: Issue[]): HierarchyGroup[] {
  // Separate features from non-features
  const features: Issue[] = [];
  const nonFeatures: Issue[] = [];

  for (const issue of issues) {
    if (issue.artifactType?.includes('PortfolioItem')) {
      features.push(issue);
    } else {
      nonFeatures.push(issue);
    }
  }

  // If no features, return all as orphans (no grouping needed)
  if (features.length === 0) {
    return issues.map(issue => ({ type: 'orphan', children: [issue] }));
  }

  // Build a map from Feature identifier → Feature issue
  const featureMap = new Map<string, Issue>();
  for (const f of features) {
    featureMap.set(f.identifier, f);
  }

  // Group children by their parentRef
  const childrenByParent = new Map<string, Issue[]>();
  const orphans: Issue[] = [];

  for (const issue of nonFeatures) {
    if (issue.parentRef && featureMap.has(issue.parentRef)) {
      const group = childrenByParent.get(issue.parentRef) || [];
      group.push(issue);
      childrenByParent.set(issue.parentRef, group);
    } else {
      orphans.push(issue);
    }
  }

  // Build the result: feature groups first, then orphans
  const groups: HierarchyGroup[] = [];

  for (const feature of features) {
    const children = childrenByParent.get(feature.identifier) || [];
    groups.push({ type: 'feature', feature, children });
  }

  for (const orphan of orphans) {
    groups.push({ type: 'orphan', children: [orphan] });
  }

  return groups;
}

// Tracker vs Shadow state badges — shows when Rally state differs from Panopticon shadow state
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
        className="w-2 h-2 rounded-full bg-purple-500 shrink-0"
        title={`Rally: ${trackerState} → Pan: ${shadowLabel}`}
      />
    );
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300">
        <ExternalLink className="w-2.5 h-2.5" />
        {trackerState}
      </span>
      <span className="text-content-muted">→</span>
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300">
        <Eye className="w-2.5 h-2.5" />
        {shadowLabel}
      </span>
    </div>
  );
}

// Feature card — rich card for Rally Features with progress and expand/collapse
function FeatureCard({
  feature,
  childCount,
  isExpanded,
  onToggle,
}: {
  feature: Issue;
  childCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const completed = feature.completedChildCount ?? 0;
  const inProgress = feature.inProgressChildCount ?? 0;
  const total = feature.totalChildCount ?? childCount;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Check if derived status differs from raw Rally state
  const hasDerivedDiff = feature.derivedStatus && feature.rawTrackerState &&
    ((feature.derivedStatus === 'in_progress' && feature.rawTrackerState !== 'Developing') ||
     (feature.derivedStatus === 'closed' && feature.rawTrackerState !== 'Done'));

  return (
    <div className="bg-surface-overlay rounded-lg border-l-4 border-l-indigo-500 overflow-hidden">
      <div
        onClick={onToggle}
        className="flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-indigo-900/20 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
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
              className="text-xs font-medium text-indigo-300 hover:text-indigo-200 flex items-center gap-1"
            >
              <span>{feature.identifier}</span>
              <ExternalLink className="w-2.5 h-2.5 opacity-50" />
            </a>
            {hasDerivedDiff && (
              <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/50 text-amber-400">
                derived
              </span>
            )}
            <TrackerShadowBadges issue={feature} />
          </div>
          <p className="text-sm text-content-body mt-1 line-clamp-1">{feature.title}</p>

          {/* Progress bar and summary */}
          {total > 0 && (
            <div className="mt-2">
              <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-content-muted">
                  {completed}/{total} done{inProgress > 0 ? `, ${inProgress} active` : ''}
                </span>
                <span className="text-xs text-indigo-400">
                  {childCount} in column
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact child card — slim inline card for stories under a Feature
function CompactChildCard({
  issue,
  agents,
}: {
  issue: Issue;
  agents: Agent[];
}) {
  const canonical = STATUS_LABELS[issue.status] || 'backlog';
  const dotColor = canonical === 'done' ? 'bg-green-400' :
                   canonical === 'in_progress' ? 'bg-yellow-400' :
                   canonical === 'in_review' ? 'bg-pink-400' :
                   'bg-gray-500';

  const issueIdLower = issue.identifier.toLowerCase();
  const hasAgent = agents.some(
    a => a.issueId?.toLowerCase() === issueIdLower && a.status !== 'dead'
  );

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-overlay/50 transition-colors group">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-content-subtle hover:text-blue-400 shrink-0"
      >
        {issue.identifier}
      </a>
      <span className="text-xs text-content-body truncate flex-1">{issue.title}</span>
      <TrackerShadowBadges issue={issue} compact />
      {hasAgent && (
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" title="Agent running" />
      )}
    </div>
  );
}

// List view row — compact row for list view grouped by labels
export function ListIssueRow({
  issue,
  agents,
  specialists,
  issueCosts,
  selectedIssue,
  onSelectIssue,
  onPlan,
}: {
  issue: Issue;
  agents: Agent[];
  specialists: SpecialistAgent[];
  issueCosts: Record<string, IssueCost>;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onPlan: (issue: Issue) => void;
}) {
  const isSelected = selectedIssue === issue.id;
  const canonical = STATUS_LABELS[issue.status] || 'backlog';

  // Status indicator color
  const statusColor = canonical === 'done' ? 'bg-green-400' :
                      canonical === 'in_review' ? 'bg-pink-400' :
                      canonical === 'in_progress' ? 'bg-yellow-400' :
                      canonical === 'todo' ? 'bg-blue-400' :
                      'bg-gray-500';

  // Get cost for this issue
  const cost = issueCosts[issue.identifier.toLowerCase()];

  // Check for running agents
  const issueIdLower = issue.identifier.toLowerCase();
  const activeAgent = agents.find(
    a => a.issueId?.toLowerCase() === issueIdLower && a.status !== 'dead'
  );
  const isRunning = !!activeAgent;

  // Check for specialists
  const issueSpecialists = specialists.filter(
    s => s.currentIssue?.toLowerCase() === issueIdLower
  );

  // Parse difficulty from labels
  const difficulty = parseDifficultyLabel(issue.labels || []);

  return (
    <div
      onClick={() => onSelectIssue(isSelected ? null : issue.id)}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-surface-overlay/50 transition-colors cursor-pointer ${
        isSelected ? 'bg-surface-overlay' : ''
      }`}
    >
      {/* Status indicator */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={canonical} />

      {/* Issue identifier */}
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-content-subtle hover:text-blue-400 shrink-0 font-mono"
      >
        {issue.identifier}
      </a>

      {/* Title - dimmed/strikethrough for canceled issues */}
      <span className={`text-sm truncate flex-1 min-w-0 ${
        canonical === 'canceled'
          ? 'text-content-muted line-through'
          : 'text-content-body'
      }`}>{issue.title}</span>

      {/* Priority indicator */}
      {issue.priority === 1 && <span className="text-xs text-red-400 font-medium shrink-0">Urgent</span>}
      {issue.priority === 2 && <span className="text-xs text-orange-400 font-medium shrink-0">High</span>}

      {/* Difficulty badge */}
      {difficulty && (
        <DifficultyBadge level={difficulty} />
      )}

      {/* Cost */}
      {cost && cost.totalCost > 0 && (
        <span className={`text-xs px-1.5 py-0.5 rounded ${getCostColor(cost.totalCost)}`}>
          {formatCost(cost.totalCost)}
        </span>
      )}

      {/* Assignee */}
      {issue.assignee && (
        <span className="text-xs text-content-subtle flex items-center gap-1 shrink-0">
          <User className="w-3 h-3" />
          {issue.assignee.name.split(' ')[0]}
        </span>
      )}

      {/* Running agent indicator */}
      {isRunning && (
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" title="Agent running" />
      )}

      {/* Specialist indicators */}
      {issueSpecialists.map(s => (
        <span key={s.name} className="text-xs text-blue-400 shrink-0" title={`${s.displayName} specialist`}>
          {s.name === 'review-agent' ? '👁️' : s.name === 'test-agent' ? '🧪' : s.name === 'merge-agent' ? '🔀' : '🤖'}
        </span>
      ))}

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Plan/Start button for backlog/todo items */}
        {!isRunning && (canonical === 'backlog' || canonical === 'todo') && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlan(issue);
            }}
            className="p-1 text-content-subtle hover:text-blue-400 transition-colors"
            title="Plan issue"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}

        {/* View button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelectIssue(issue.id);
          }}
          className="p-1 text-content-subtle hover:text-content transition-colors"
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
          className="p-1 text-content-subtle hover:text-content transition-colors"
          title="Open in tracker"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

const COLUMN_COLORS: Record<string, string> = {
  backlog: 'border-divider-strong',
  todo: 'border-blue-600',
  in_progress: 'border-yellow-500',
  in_review: 'border-pink-500',
  done: 'border-green-500',
};

const COLUMN_TITLES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

interface KanbanBoardProps {
  selectedIssue?: string | null;
  onSelectIssue?: (issueId: string | null) => void;
}

type CycleFilter = 'current' | 'all' | 'backlog' | 'canceled';

// Undo history entry
interface UndoEntry {
  issueId: string;
  fromStatus: CanonicalState;
  toStatus: CanonicalState;
  timestamp: number;
}

export function KanbanBoard({ selectedIssue: externalSelectedIssue, onSelectIssue: externalOnSelectIssue }: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const [internalSelectedIssue, setInternalSelectedIssue] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set()); // Empty = all projects
  const [planDialogIssue, setPlanDialogIssue] = useState<Issue | null>(null); // Lifted dialog state
  const [beadsDialogIssue, setBeadsDialogIssue] = useState<Issue | null>(null); // Beads viewer
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>('current'); // Default to current cycle
  const [includeCompleted, setIncludeCompleted] = useState(false);

  // DnD state
  const [activeDragIssue, setActiveDragIssue] = useState<Issue | null>(null);
  const [activeDragStatus, setActiveDragStatus] = useState<CanonicalState | null>(null);

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

  const { data: issues, isLoading: issuesLoading, error: issuesError } = useQuery({
    queryKey: ['issues', cycleFilter, includeCompleted],
    queryFn: () => fetchIssues(cycleFilter, includeCompleted),
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const { data: specialists = [] } = useQuery({
    queryKey: ['specialists'],
    queryFn: fetchSpecialists,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // DnD sensors
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
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

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragIssue(null);
    setActiveDragStatus(null);

    if (!over) return;

    const issueId = active.id as string;
    const targetStatus = over.id as CanonicalState;

    const issue = issues?.find(i => i.id === issueId);
    if (!issue) return;

    const currentStatus = STATUS_LABELS[issue.status] as CanonicalState;

    // No change
    if (currentStatus === targetStatus) return;

    // Check for active agents
    const issueIdLower = issue.identifier.toLowerCase();
    const hasActiveAgent = agents.some(
      a => a.issueId?.toLowerCase() === issueIdLower && a.status !== 'dead'
    );

    if (hasActiveAgent) {
      setAgentWarningDialog({ open: true, issue, targetStatus });
      return;
    }

    // Check if moving to done
    if (targetStatus === 'done') {
      setSyncPromptDialog({ open: true, issue });
      return;
    }

    // Proceed with move
    showUndoNotification(issue.identifier, currentStatus, targetStatus);
    moveStatusMutation.mutate({ issueId: issue.identifier, targetStatus });
  }, [issues, agents, moveStatusMutation, showUndoNotification]);

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

  // Drop animation config
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
  const { data: issueCosts = {} } = useQuery({
    queryKey: ['issueCosts'],
    queryFn: fetchIssueCosts,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });

  // Extract unique projects from issues
  const projects = useMemo(() => {
    if (!issues) return [];
    const projectMap = new Map<string, LinearProject>();
    for (const issue of issues) {
      if (issue.project && !projectMap.has(issue.project.id)) {
        projectMap.set(issue.project.id, issue.project);
      }
    }
    return Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  // Filter issues by selected projects
  const filteredIssues = useMemo(() => {
    if (!issues) return [];
    if (selectedProjects.size === 0) return issues; // Show all if none selected
    return issues.filter(issue => issue.project && selectedProjects.has(issue.project.id));
  }, [issues, selectedProjects]);

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

  if (issuesLoading) {
    return (
      <div className="space-y-4">
        {/* Skeleton filter bar */}
        <div className="flex items-center gap-2 animate-pulse">
          <div className="w-4 h-4 bg-surface-overlay rounded" />
          <div className="w-16 h-4 bg-surface-overlay rounded" />
          <div className="w-24 h-6 bg-surface-overlay rounded" />
          <div className="w-20 h-6 bg-surface-overlay rounded" />
          <div className="w-28 h-6 bg-surface-overlay rounded" />
        </div>

        {/* Skeleton columns */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUS_ORDER.filter(s => s !== 'backlog').map((status) => (
            <div key={status} className="flex-shrink-0 w-80">
              <div className={`border-t-4 ${COLUMN_COLORS[status]} bg-surface-raised rounded-lg`}>
                <div className="px-4 py-3 border-b border-divider">
                  <div className="flex items-center justify-between">
                    <div className="h-5 bg-surface-overlay rounded w-24 animate-pulse" />
                    <div className="h-4 bg-surface-overlay rounded w-6 animate-pulse" />
                  </div>
                </div>
                <div className="p-2 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-surface-overlay rounded-lg p-3 border-l-4 border-l-divider-strong animate-pulse">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 bg-surface-emphasis rounded-full" />
                        <div className="h-4 bg-surface-emphasis rounded w-16" />
                      </div>
                      <div className="h-4 bg-surface-emphasis rounded w-full mb-1" />
                      <div className="h-4 bg-surface-emphasis rounded w-3/4" />
                      <div className="flex gap-2 mt-3">
                        <div className="h-5 bg-surface-emphasis rounded w-16" />
                        <div className="h-5 bg-surface-emphasis rounded w-12" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (issuesError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error loading issues: {(issuesError as Error).message}</div>
      </div>
    );
  }

  const grouped = groupByStatus(filteredIssues, includeCompleted);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Cycle filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-content-subtle" />
          <span className="text-sm text-content-subtle">Cycle:</span>
          <div className="flex rounded-lg overflow-hidden border border-divider-strong">
            {(['current', 'all', 'backlog', 'canceled'] as CycleFilter[]).map((cycle) => (
              <button
                key={cycle}
                onClick={() => setCycleFilter(cycle)}
                className={`px-3 py-1 text-xs transition-colors ${
                  cycleFilter === cycle
                    ? 'bg-blue-600 text-content'
                    : 'bg-surface-raised text-content-subtle hover:text-content hover:bg-surface-overlay'
                }`}
              >
                {cycle === 'current' ? 'Current' : cycle === 'all' ? 'All' : cycle === 'backlog' ? 'Backlog' : 'Canceled'}
              </button>
            ))}
          </div>
        </div>

        {/* Include completed toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
            className="w-4 h-4 rounded border-divider-strong bg-surface-raised text-blue-600 focus:ring-blue-500 focus:ring-offset-surface"
          />
          <span className="text-sm text-content-subtle">Include closed-out</span>
        </label>

        {/* Refresh button */}
        <button
          onClick={async () => {
            try {
              await fetch('/api/trackers/refresh', { method: 'POST' });
              queryClient.invalidateQueries({ queryKey: ['issues'] });
            } catch (e) {
              console.error('Refresh failed:', e);
            }
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs text-content-subtle hover:text-content bg-surface-raised hover:bg-surface-overlay rounded transition-colors"
          title="Force refresh all trackers"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Issue count */}
        <span className="text-sm text-content-muted">
          {issues?.length || 0} issues
        </span>

        {/* Project filter */}
        {projects.length > 1 && (
          <>
            <div className="w-px h-6 bg-surface-overlay" />
            <span className="text-sm text-content-subtle">Projects:</span>
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => toggleProject(project.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                  selectedProjects.size === 0 || selectedProjects.has(project.id)
                    ? 'bg-surface-overlay text-content'
                    : 'bg-surface-raised text-content-muted hover:text-content-body'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: project.color || '#6b7280' }}
                />
                {project.name}
              </button>
            ))}
            {selectedProjects.size > 0 && (
              <button
                onClick={() => setSelectedProjects(new Set())}
                className="text-xs text-content-subtle hover:text-content"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* All Issues - List View (grouped by labels) */}
      {cycleFilter === 'all' ? (
        <div className="space-y-6 overflow-y-auto pb-4">
          {Object.entries(groupedByLabels).map(([label, labelIssues]) => (
            <div key={label} className="bg-surface-raised rounded-lg">
              <div className="px-4 py-3 border-b border-divider">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-blue-400" />
                  <h3 className="font-semibold text-content">{label}</h3>
                  <span className="text-sm text-content-subtle">({labelIssues.length})</span>
                </div>
              </div>
              <div className="divide-y divide-divider">
                {labelIssues.map((issue) => (
                  <ListIssueRow
                    key={issue.id}
                    issue={issue}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={setPlanDialogIssue}
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
            <div key={group.name} className="bg-surface-raised rounded-lg">
              <div className="px-4 py-3 border-b border-divider">
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: group.color || '#6b7280' }}
                  />
                  <h3 className="font-semibold text-content">{group.name}</h3>
                  <span className="text-sm text-content-subtle">({group.issues.length})</span>
                </div>
              </div>
              <div className="divide-y divide-divider">
                {group.issues.map((issue) => (
                  <ListIssueRow
                    key={issue.id}
                    issue={issue}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={setPlanDialogIssue}
                  />
                ))}
              </div>
            </div>
          ))}
          {groupedByProject.length === 0 && (
            <div className="text-center py-12 text-content-subtle">
              No backlog items
            </div>
          )}
        </div>
      ) : cycleFilter === 'canceled' ? (
        /* Canceled - List View (grouped by cancellation type) */
        <div className="space-y-6 overflow-y-auto pb-4">
          {groupedByCanceledType.map((group) => (
            <div key={group.name} className="bg-surface-raised rounded-lg">
              <div className="px-4 py-3 border-b border-divider">
                <div className="flex items-center gap-2">
                  <X className="w-4 h-4 text-red-400" />
                  <h3 className="font-semibold text-content">{group.name}</h3>
                  <span className="text-sm text-content-subtle">({group.issues.length})</span>
                </div>
              </div>
              <div className="divide-y divide-divider">
                {group.issues.map((issue) => (
                  <ListIssueRow
                    key={issue.id}
                    issue={issue}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={setPlanDialogIssue}
                  />
                ))}
              </div>
            </div>
          ))}
          {groupedByCanceledType.length === 0 && (
            <div className="text-center py-12 text-content-subtle">
              No canceled issues
            </div>
          )}
        </div>
      ) : (
        /* Kanban columns with DnD (current view - 4 columns, no backlog) */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STATUS_ORDER.filter(s => s !== 'backlog').map((status) => (
              <DroppableColumn key={status} status={status}>
                <div className={`border-t-4 ${COLUMN_COLORS[status]} bg-pan-panel-left rounded-lg transition-colors ${activeDragStatus && activeDragStatus !== status ? 'bg-pan-panel-left/80' : ''}`}>
                  <div className="px-4 py-3 border-b border-pan-border bg-pan-panel-left">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-content">{COLUMN_TITLES[status]}</h3>
                      <span className="text-sm text-content-subtle">{grouped[status].length}</span>
                    </div>
                  </div>
                  <ColumnContent
                    issues={grouped[status]}
                    agents={agents}
                    specialists={specialists}
                    issueCosts={issueCosts}
                    selectedIssue={selectedIssue}
                    onSelectIssue={onSelectIssue}
                    onPlan={setPlanDialogIssue}
                    onViewBeads={setBeadsDialogIssue}
                  />
                </div>
              </DroppableColumn>
            ))}
          </div>

          {/* Drag Overlay - Ghost card following cursor */}
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
          onClose={() => setPlanDialogIssue(null)}
          onComplete={() => {
            setPlanDialogIssue(null);
            queryClient.invalidateQueries({ queryKey: ['issues'] });
          }}
        />
      )}

      {/* Beads Dialog - view tasks for issue */}
      {beadsDialogIssue && (
        <BeadsDialog
          issue={beadsDialogIssue}
          onClose={() => setBeadsDialogIssue(null)}
        />
      )}
    </div>
  );
}

// ColumnContent — renders issues with Rally hierarchy grouping
function ColumnContent({
  issues,
  agents,
  specialists,
  issueCosts,
  selectedIssue,
  onSelectIssue,
  onPlan,
  onViewBeads,
}: {
  issues: Issue[];
  agents: Agent[];
  specialists: SpecialistAgent[];
  issueCosts: Record<string, IssueCost>;
  selectedIssue: string | null | undefined;
  onSelectIssue: (id: string | null) => void;
  onPlan: (issue: Issue) => void;
  onViewBeads: (issue: Issue) => void;
}) {
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

  // Check if any Rally issues with hierarchy exist
  const hasRallyHierarchy = issues.some(i => i.artifactType?.includes('PortfolioItem'));
  const hierarchy = hasRallyHierarchy ? buildHierarchy(issues) : null;

  const renderIssueCard = (issue: Issue) => {
    const issueIdLower = issue.identifier.toLowerCase();
    const workAgent = agents.find(
      (a) => a.issueId?.toLowerCase() === issueIdLower && a.type === 'agent' && a.agentPhase !== 'planning'
    );
    const planningAgent = agents.find(
      (a) => a.issueId?.toLowerCase() === issueIdLower && a.agentPhase === 'planning' && a.status !== 'stopped'
    );
    const issueSpecialists = specialists.filter(
      (s) => s.currentIssue?.toLowerCase() === issueIdLower
    );

    return (
      <DraggableCardWrapper key={issue.id} issue={issue}>
        <IssueCard
          issue={issue}
          workAgent={workAgent}
          planningAgent={planningAgent}
          specialists={issueSpecialists}
          cost={issueCosts[issue.identifier.toLowerCase()]}
          isSelected={selectedIssue === issue.identifier}
          onSelect={() => onSelectIssue(
            selectedIssue === issue.identifier ? null : issue.identifier
          )}
          onPlan={() => onPlan(issue)}
          onViewBeads={(i) => onViewBeads(i)}
        />
      </DraggableCardWrapper>
    );
  };

  if (issues.length === 0) {
    return (
      <div className="p-2 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
        <div className="text-center text-content-muted py-8 text-sm">
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
          <div key={`feature-${feature.id}`} className="space-y-1">
            <FeatureCard
              feature={feature}
              childCount={group.children.length}
              isExpanded={isExpanded}
              onToggle={() => toggleFeature(feature.identifier)}
            />
            {isExpanded && (
              <div className="ml-3 border-l-2 border-indigo-700/30 pl-1">
                {group.children.map(child => (
                  <CompactChildCard
                    key={child.id}
                    issue={child}
                    agents={agents}
                  />
                ))}
                {group.children.length === 0 && (
                  <div className="text-xs text-content-muted py-2 pl-2">
                    No stories in this column
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// DroppableColumn component
function DroppableColumn({ status, children }: { status: CanonicalState; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[200px] transition-all ${isOver ? 'scale-[1.02]' : ''}`}
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  });

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
    <div className="bg-surface-overlay rounded-lg p-3 border-l-4 border-l-blue-500 shadow-2xl rotate-2 scale-105 opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-content-subtle text-sm">{issue.identifier}</span>
      </div>
      <p className="text-sm text-content mt-1 line-clamp-2">{issue.title}</p>
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
      <div className="relative bg-surface-raised rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-amber-900/50 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-content mb-2">
              Active Agent Warning
            </h3>
            <p className="text-content-body text-sm mb-4">
              <strong>{issue.identifier}</strong> has an active agent working on it.
              Moving this issue may disrupt the agent's work.
            </p>
            <p className="text-content-subtle text-xs mb-6">
              Are you sure you want to proceed?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-content-subtle hover:text-content transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-content rounded-lg transition-colors text-sm"
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
      <div className="relative bg-surface-raised rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-green-900/50 rounded-lg">
            <Check className="w-6 h-6 text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-content mb-2">
              Move to Done
            </h3>
            <p className="text-content-body text-sm mb-4">
              You're moving <strong>{issue.identifier}</strong> to Done.
            </p>

            {/* Cleanup options */}
            <div className="space-y-2 mb-4 p-3 bg-surface-overlay/50 rounded-lg">
              <label className="flex items-center gap-2 text-sm text-content-body cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanupWorkspace}
                  onChange={(e) => setCleanupWorkspace(e.target.checked)}
                  className="rounded border-divider-strong bg-surface-overlay text-green-500 focus:ring-green-500"
                />
                Clean up workspace
              </label>
              <label className="flex items-center gap-2 text-sm text-content-body cursor-pointer">
                <input
                  type="checkbox"
                  checked={stopAgents}
                  onChange={(e) => setStopAgents(e.target.checked)}
                  className="rounded border-divider-strong bg-surface-overlay text-green-500 focus:ring-green-500"
                />
                Stop running agents
              </label>
            </div>

            <p className="text-content-subtle text-xs mb-4">
              Sync status change to {trackerName}?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => onSync(false, { cleanupWorkspace, stopAgents })}
                className="px-4 py-2 text-content-subtle hover:text-content transition-colors text-sm"
              >
                Shadow Only
              </button>
              <button
                onClick={() => onSync(true, { cleanupWorkspace, stopAgents })}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-content rounded-lg transition-colors text-sm"
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
      <div className="bg-surface-raised border border-divider rounded-lg shadow-xl px-4 py-3 flex items-center gap-4">
        <span className="text-sm text-content-body">Issue moved</span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <Undo className="w-4 h-4" />
          Undo
        </button>
        <button
          onClick={onClose}
          className="text-content-muted hover:text-content-subtle"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// Simple Beads Dialog component
function BeadsDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['beads', issue.identifier],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/beads`);
      if (!res.ok) throw new Error('Failed to fetch tasks');
      return res.json();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-raised rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[70vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-green-400" />
            <h2 className="font-semibold text-content">Tasks: {issue.identifier}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-content-subtle hover:text-content hover:bg-surface-overlay rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-content-subtle">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading tasks...
            </div>
          )}

          {error && (
            <div className="text-red-400 text-center py-8">
              Failed to load tasks
            </div>
          )}

          {data && data.tasks?.length === 0 && (
            <div className="text-content-muted text-center py-8">
              No tasks created yet
            </div>
          )}

          {data && data.tasks?.length > 0 && (
            <div className="space-y-2">
              {data.tasks.map((task: any) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-lg ${
                    task.status === 'closed' ? 'bg-green-900/20' :
                    task.status === 'in_progress' ? 'bg-blue-900/20' :
                    'bg-surface-overlay/50'
                  }`}
                >
                  <div className={`mt-0.5 ${
                    task.status === 'closed' ? 'text-green-400' :
                    task.status === 'in_progress' ? 'text-blue-400' :
                    'text-content-subtle'
                  }`}>
                    {task.status === 'closed' ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : task.status === 'in_progress' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <div className="w-4 h-4 border-2 border-current rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-content">{task.title}</div>
                    <div className="text-xs text-content-muted mt-1">
                      {task.id} · {task.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-divider text-xs text-content-muted">
          {data?.count || 0} task{data?.count !== 1 ? 's' : ''} · Beads
        </div>
      </div>
    </div>
  );
}

interface IssueCardProps {
  issue: Issue;
  workAgent?: Agent;
  planningAgent?: Agent;
  specialists?: SpecialistAgent[];
  cost?: IssueCost;
  isSelected: boolean;
  onSelect: () => void;
  onPlan: () => void; // Lifted to parent to survive re-renders
  onViewBeads?: (issue: Issue) => void;
}

function IssueCard({ issue, workAgent, planningAgent, specialists = [], cost, isSelected, onSelect, onPlan, onViewBeads }: IssueCardProps) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const showAlert = useAlert();

  // Determine which agent is relevant based on issue status
  const activeAgent = workAgent;
  const isRunning = activeAgent && activeAgent.status !== 'dead' && activeAgent.status !== 'stopped';
  const isPlanningActive = planningAgent && planningAgent.status !== 'stopped';

  // For display in terminal viewer and INPUT badge, prefer work agent, fall back to planning agent
  const agent = activeAgent || planningAgent;

  // Check if issue has "Review Ready" label (agent completed work)
  // Don't show on terminal states — "ready for review" is meaningless once done/canceled
  const canonical = STATUS_LABELS[issue.status] || 'backlog';
  const isTerminal = canonical === 'done' || canonical === 'canceled';
  const isReviewReady = !isTerminal && (issue.labels?.some(
    (label) => typeof label === 'string' && label.toLowerCase() === 'review ready'
  ) ?? false);

  const priorityColors: Record<number, string> = {
    0: 'border-l-gray-500',
    1: 'border-l-red-500',
    2: 'border-l-orange-500',
    3: 'border-l-yellow-500',
    4: 'border-l-blue-500',
  };

  // Kill agent mutation
  const killMutation = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to kill agent');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  // Send message mutation
  const [messageInput, setMessageInput] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);

  const sendMessageMutation = useMutation({
    mutationFn: async ({ agentId, message }: { agentId: string; message: string }) => {
      const res = await fetch(`/api/agents/${agentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      return res.json();
    },
    onSuccess: () => {
      setMessageInput('');
      setShowMessageInput(false);
    },
  });

  const handleKill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (agent && await confirm({ title: 'Kill Agent', message: `Kill agent ${agent.id}?`, variant: 'destructive', confirmLabel: 'Kill' })) {
      killMutation.mutate(agent.id);
    }
  };

  const handleWatch = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  };

  const handleTell = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMessageInput(!showMessageInput);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (agent && messageInput.trim()) {
      sendMessageMutation.mutate({ agentId: agent.id, message: messageInput.trim() });
    }
  };

  const startAgentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.identifier }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start agent');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
    onError: (err: Error) => {
      showAlert({ message: `Failed to start agent: ${err.message}`, variant: 'error' });
    },
  });

  const [confirmingStart, setConfirmingStart] = useState(false);
  const confirmingStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStartAgent = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmingStart) {
      // Second click — confirmed
      setConfirmingStart(false);
      if (confirmingStartTimer.current) clearTimeout(confirmingStartTimer.current);
      startAgentMutation.mutate();
    } else {
      // First click — show inline confirm, auto-reset after 3s
      setConfirmingStart(true);
      confirmingStartTimer.current = setTimeout(() => setConfirmingStart(false), 3000);
    }
  };

  const handlePlan = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPlan();
  };

  // Deep wipe mutation - completely resets issue state
  const deepWipeMutation = useMutation({
    mutationFn: async (options: { deleteWorkspace: boolean }) => {
      const res = await fetch(`/api/issues/${issue.identifier}/deep-wipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteWorkspace: options.deleteWorkspace }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Deep wipe failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      console.log('Deep wipe completed:', data.cleanupLog);
    },
  });

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg p-3 border border-pan-border border-l-4 cursor-pointer transition-all ${priorityColors[issue.priority] || 'border-l-gray-500'} ${
        isSelected
          ? 'ring-2 ring-blue-500'
          : 'hover:border-pan-border/80'
      } ${isRunning ? 'bg-blue-900/20' : 'bg-pan-panel-right'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Project color indicator */}
            {issue.project && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: issue.project.color || '#6b7280' }}
                title={issue.project.name}
              />
            )}
            {isRunning && (
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-content hover:text-blue-400 flex items-center gap-1"
            >
              {issue.source === 'github' && (
                <span title="GitHub Issue">
                  <Github className="w-3 h-3 text-content-subtle" />
                </span>
              )}
              <span className="text-content-subtle">{issue.identifier}</span>
              <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
            {/* Agent attribution badges */}
            {(() => {
              const badges = [];
              // Conflict detection: multiple agents working on same issue
              const hasConflict = (!!workAgent && specialists.length > 0) ||
                                  specialists.length > 1;

              if (workAgent) {
                badges.push({
                  type: 'work' as const,
                  name: 'work' // Don't show issue ID - it's already displayed in the card header
                });
              }
              for (const spec of specialists) {
                const specType = spec.name.replace('-agent', '') as 'review' | 'test' | 'merge';
                badges.push({ type: specType, name: specType });
              }

              return badges.map((b, i) => (
                <AgentBadge key={i} type={b.type} name={b.name} isConflict={hasConflict} />
              ));
            })()}
            {/* Planning badge - clickable to watch the active planning session */}
            {planningAgent && planningAgent.status !== 'stopped' && (
              <button
                onClick={(e) => { e.stopPropagation(); onPlan(); }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-900/50 text-purple-300 animate-pulse hover:bg-purple-800/60 transition-colors cursor-pointer"
                title="Click to watch planning session"
              >
                <Sparkles className="w-3 h-3" />
                Planning
              </button>
            )}
            {/* Model badge - shows which model the active agent is using */}
            {activeAgent && activeAgent.model && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium bg-surface-emphasis text-content-body"
                title={`Model: ${activeAgent.model}`}
              >
                {getFriendlyModelName(activeAgent.model)}
              </span>
            )}
            {/* Workspace location badge - shows for any agent with a workspace */}
            {(workAgent?.workspaceLocation || planningAgent?.workspaceLocation) && (
              <span
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  (workAgent?.workspaceLocation || planningAgent?.workspaceLocation) === 'remote'
                    ? 'bg-cyan-900/50 text-cyan-400'
                    : 'bg-gray-800/60 text-gray-400 border border-gray-600/30'
                }`}
                title={(workAgent?.workspaceLocation || planningAgent?.workspaceLocation) === 'remote' ? 'Running on remote VM (Fly.io)' : 'Running locally'}
              >
                {(workAgent?.workspaceLocation || planningAgent?.workspaceLocation) === 'remote' ? (
                  <Cloud className="w-3 h-3" />
                ) : (
                  <Monitor className="w-3 h-3" />
                )}
                {(workAgent?.workspaceLocation || planningAgent?.workspaceLocation) === 'remote' ? 'Fly.io' : 'Local'}
              </span>
            )}
            {/* Review Ready badge - prominent indicator that agent completed work */}
            {isReviewReady && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-600 text-content animate-pulse"
                title="Agent completed work - ready for human review"
              >
                <CheckCheck className="w-3 h-3" />
                Ready
              </span>
            )}
            {/* Awaiting Input badge - agent is waiting for user response */}
            {!isTerminal && agent?.hasPendingQuestion && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onPlan();
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-600 text-content animate-pulse cursor-pointer hover:bg-amber-500"
                title={`Agent is waiting for user input - click to respond (${agent.pendingQuestionCount || 1} question${(agent.pendingQuestionCount || 1) > 1 ? 's' : ''})`}
              >
                <HelpCircle className="w-3 h-3" />
                Input
              </span>
            )}
            {/* Lifecycle resolution badges (PAN-309) */}
            {!isTerminal && agent?.resolution === 'done' && !agent?.hasPendingQuestion && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-green-700 text-content"
                title="Agent evidence shows work is complete — waiting for agent to call pan work done"
              >
                <CheckCircle className="w-3 h-3" />
                Done
              </span>
            )}
            {!isTerminal && agent?.resolution === 'stuck' && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-700 text-content animate-pulse"
                title={`Agent appears stuck — no clear progress signal after ${agent.resolutionCount || 0} check(s). Consider sending a message.`}
              >
                <XCircle className="w-3 h-3" />
                Stuck
              </span>
            )}
            {!isTerminal && agent?.resolution === 'needs_input' && !agent?.hasPendingQuestion && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-700 text-content animate-pulse"
                title="Agent stopped because it needs human input or hit a blocker"
              >
                <AlertCircle className="w-3 h-3" />
                Blocked
              </span>
            )}
            {/* Tracker vs Shadow state badges */}
            {issue.source === 'rally' && <TrackerShadowBadges issue={issue} />}
            {/* Difficulty badge */}
            {(() => {
              const difficulty = parseDifficultyLabel(issue.labels || []);
              return difficulty ? <DifficultyBadge level={difficulty} /> : null;
            })()}
            {/* Merged badge — prominent indicator for verified merges on Done cards */}
            {(issue.mergeStatus === 'merged' || issue.labels?.some(l => l.toLowerCase() === 'merged')) && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold bg-green-900/60 text-green-300 border border-green-500/40 uppercase tracking-wide"
                title="Branch verified merged into main"
              >
                <GitMerge className="w-3 h-3" />
                Merged
              </span>
            )}
            {/* Needs close-out badge - amber indicator for reopened issues needing review */}
            {issue.labels?.some(l => l.toLowerCase() === 'needs-close-out') && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/60 text-amber-400 border border-amber-600/40"
                title="Reopened for close-out review — verify this work is complete, then click Close Out"
              >
                <AlertTriangle className="w-3 h-3" />
                Needs Review
              </span>
            )}
            {/* Cost badge */}
            {cost && cost.totalCost > 0 && (
              <span
                className={`ml-auto px-1.5 py-0.5 rounded text-xs font-medium ${getCostColor(cost.totalCost)}`}
                title={`${(cost.tokenCount / 1000000).toFixed(2)}M tokens${cost.model ? ` • ${cost.model.replace('claude-', '').replace(/-20[0-9]{6}$/, '')}` : ''}${cost.durationMinutes ? ` • ${Math.round(cost.durationMinutes)}min` : ''}`}
              >
                <DollarSign className="w-3 h-3 inline -mt-0.5" />
                {formatCost(cost.totalCost).slice(1)}
              </span>
            )}
          </div>
          <p className="text-sm text-content-body mt-1 line-clamp-2">{issue.title}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {issue.assignee && (
          <span className="inline-flex items-center gap-1 text-xs text-content-subtle">
            <User className="w-3 h-3" />
            {issue.assignee.name.split(' ')[0]}
          </span>
        )}
        {(issue.labels || [])
          .filter((label) => typeof label === 'string' && !['review ready', 'needs-close-out', 'merged', 'closed-out'].includes(label.toLowerCase()))
          .slice(0, 2)
          .map((label) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium ${getLabelStyle(label)}`}
            >
              {label}
            </span>
          ))}
      </div>

      {/* Action buttons for running agents */}
      {isRunning && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-divider-strong">
          <button
            onClick={handleWatch}
            className={`flex items-center gap-1 text-xs transition-colors ${
              isSelected ? 'text-blue-400' : 'text-content-subtle hover:text-content'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            Watch
          </button>
          <button
            onClick={() => onViewBeads && onViewBeads(issue)}
            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
            title="View tasks for this issue"
          >
            <List className="w-3.5 h-3.5" />
            Tasks
          </button>
          <button
            onClick={handleTell}
            className={`flex items-center gap-1 text-xs transition-colors ${
              showMessageInput ? 'text-blue-400' : 'text-content-subtle hover:text-content'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Tell
          </button>
          <button
            onClick={handleKill}
            disabled={killMutation.isPending}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors ml-auto"
          >
            {killMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            Kill
          </button>
        </div>
      )}

      {/* Message input for Tell */}
      {showMessageInput && agent && (
        <form onSubmit={handleSendMessage} className="mt-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-surface-raised text-content text-sm px-3 py-1.5 rounded border border-divider-strong focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!messageInput.trim() || sendMessageMutation.isPending}
              className="px-3 py-1.5 bg-blue-600 text-content text-sm rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendMessageMutation.isPending ? '...' : 'Send'}
            </button>
          </div>
        </form>
      )}

      {/* Start/Plan buttons for backlog/todo items without running agent */}
      {!isRunning && (STATUS_LABELS[issue.status] === 'backlog' || STATUS_LABELS[issue.status] === 'todo') && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-divider-strong flex-wrap">
          {isPlanningActive ? (
            <button
              onClick={handlePlan}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors animate-pulse"
            >
              <Eye className="w-3.5 h-3.5" />
              Watch Planning
            </button>
          ) : (
            <button
              onClick={handlePlan}
              className={`flex items-center gap-1 text-xs transition-colors ${issue.labels?.some(l => l.toLowerCase() === 'planned') ? 'text-content-muted hover:text-content-subtle' : 'text-purple-400 hover:text-purple-300'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              {issue.labels?.some(l => l.toLowerCase() === 'planned') ? 'Re-plan' : 'Plan'}
            </button>
          )}
          {issue.labels?.some(l => l.toLowerCase() === 'planned') && (
            <>
              <button
                onClick={() => onViewBeads && onViewBeads(issue)}
                className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                title="View tasks for this issue"
              >
                <List className="w-3.5 h-3.5" />
                Tasks
              </button>
              <button
                onClick={handleStartAgent}
                disabled={startAgentMutation.isPending}
                className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-50 ${confirmingStart ? 'text-amber-400 font-medium' : 'text-blue-400 hover:text-blue-300'}`}
                title="Start implementation agent"
              >
                {startAgentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {startAgentMutation.isPending ? 'Starting...' : confirmingStart ? 'Click to confirm' : 'Start Agent'}
              </button>
            </>
          )}
          {STATUS_LABELS[issue.status] === 'todo' && <BacklogButton issue={issue} />}
          {STATUS_LABELS[issue.status] === 'backlog' && <TodoButton issue={issue} />}
          <CancelButton issue={issue} />
          <DeepWipeButton issue={issue} deepWipeMutation={deepWipeMutation} />
        </div>
      )}

      {/* In Progress items without running agent */}
      {!isRunning && STATUS_LABELS[issue.status] === 'in_progress' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-divider-strong flex-wrap">
          {isPlanningActive ? (
            <button
              onClick={handlePlan}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors animate-pulse"
            >
              <Eye className="w-3.5 h-3.5" />
              Watch Planning
            </button>
          ) : (
            <button
              onClick={handlePlan}
              className={`flex items-center gap-1 text-xs transition-colors ${issue.labels?.some(l => l.toLowerCase() === 'planned') ? 'text-content-muted hover:text-content-subtle' : 'text-purple-400 hover:text-purple-300'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              {issue.labels?.some(l => l.toLowerCase() === 'planned') ? 'Re-plan' : 'Plan'}
            </button>
          )}
          <button
            onClick={() => onViewBeads && onViewBeads(issue)}
            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
            title="View tasks for this issue"
          >
            <List className="w-3.5 h-3.5" />
            Tasks
          </button>
          <button
            onClick={handleStartAgent}
            disabled={startAgentMutation.isPending}
            className={`flex items-center gap-1 text-xs transition-colors disabled:opacity-50 ${confirmingStart ? 'text-amber-400 font-medium' : 'text-blue-400 hover:text-blue-300'}`}
          >
            {startAgentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {startAgentMutation.isPending ? 'Starting...' : confirmingStart ? 'Click to confirm' : 'Resume Agent'}
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (await confirm({ title: 'Reset Issue', message: `Reset ${issue.identifier}?\n\nThis will:\n• Kill any running agents (local and remote)\n• Move the issue back to To Do in Linear\n• Keep the workspace for reference`, variant: 'destructive', confirmLabel: 'Reset' })) {
                // Call the reset endpoint
                fetch(`/api/issues/${issue.identifier}/reset`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                }).then(async () => {
                  await queryClient.refetchQueries({ queryKey: ['issues'] });
                  await queryClient.refetchQueries({ queryKey: ['agents'] });
                }).catch(err => console.error('Reset failed:', err));
              }
            }}
            className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
            title="Reset to To Do - kills agents, resets Linear status"
          >
            <Undo className="w-3.5 h-3.5" />
            Reset
          </button>
          <CancelButton issue={issue} />
          <DeepWipeButton issue={issue} deepWipeMutation={deepWipeMutation} />
        </div>
      )}

      {/* In Review items - Reset Pipeline + Reopen + Deep Wipe */}
      {!isRunning && STATUS_LABELS[issue.status] === 'in_review' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-divider-strong flex-wrap">
          <ResetPipelineButton issue={issue} />
          <ReopenSection issue={issue} inline />
          <CancelButton issue={issue} />
          <DeepWipeButton issue={issue} deepWipeMutation={deepWipeMutation} />
        </div>
      )}

      {/* Done items - Reopen + Close Out + Deep Wipe */}
      {!isRunning && STATUS_LABELS[issue.status] === 'done' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-green-600/30 flex-wrap">
          <ReopenSection issue={issue} inline />
          <CloseOutSection issue={issue} />
          <DeepWipeButton issue={issue} deepWipeMutation={deepWipeMutation} />
        </div>
      )}

    </div>
  );
}

// Reset pipeline button - resets review/test/merge state and optionally re-dispatches
function ResetPipelineButton({ issue }: { issue: Issue }) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        if (await confirm({
          title: 'Reset & Re-run Pipeline',
          message: `Reset review/test pipeline for ${issue.identifier}?\n\nThis will:\n• Clear review, test, and merge status\n• Reset circuit breaker counters\n• Remove queued specialist tasks\n• Re-dispatch to review specialist`,
          confirmLabel: 'Reset & Re-run',
        })) {
          setIsPending(true);
          try {
            const res = await fetch(`/api/workspaces/${issue.identifier}/reset-review`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rerun: true }),
            });
            if (!res.ok) {
              const err = await res.json();
              console.error('Pipeline reset failed:', err);
            }
            await queryClient.refetchQueries({ queryKey: ['issues'] });
            await queryClient.refetchQueries({ queryKey: ['review-status'] });
          } catch (err) {
            console.error('Pipeline reset error:', err);
          } finally {
            setIsPending(false);
          }
        }
      }}
      disabled={isPending}
      className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
      title="Reset pipeline state and re-run review & test"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
      {isPending ? 'Resetting...' : 'Reset Pipeline'}
    </button>
  );
}

// Deep wipe button - available from any issue state
function DeepWipeButton({ issue, deepWipeMutation }: { issue: Issue; deepWipeMutation: any }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        if (await confirm({ title: 'Deep Wipe', message: `Deep wipe ${issue.identifier}? This will clean up ALL state:\n\n• Kill agents\n• Delete agent state\n• Delete workspace & branches\n• Reset issue to Todo/Open\n\nThis is irreversible.`, variant: 'destructive', confirmLabel: 'Wipe Everything' })) {
          deepWipeMutation.mutate({ deleteWorkspace: true });
        }
      }}
      disabled={deepWipeMutation.isPending}
      className="flex items-center gap-1 text-xs text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50 ml-auto"
      title="Deep wipe: delete workspace, branches, agent state — start completely fresh"
    >
      {deepWipeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      {deepWipeMutation.isPending ? 'Wiping...' : 'Wipe'}
    </button>
  );
}

// Cancel button - stop agents, move to Canceled, optionally wipe workspace
function CancelButton({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        // First confirm the cancel
        if (!await confirm({
          title: 'Cancel Issue',
          message: `Cancel ${issue.identifier}?\n\nThis will:\n• Stop any running agents\n• Clean up agent & review state\n• Move issue to Canceled on tracker`,
          variant: 'destructive',
          confirmLabel: 'Cancel Issue',
        })) return;

        // Then ask about workspace cleanup
        const wipeWorkspace = await confirm({
          title: 'Delete Workspace?',
          message: `Also delete the workspace and branches for ${issue.identifier}?\n\nThis removes the git worktree, local & remote feature branches, and all workspace files.\n\nChoose "Keep" to preserve the code for reference.`,
          confirmLabel: 'Delete Workspace',
          cancelLabel: 'Keep Workspace',
          variant: 'destructive',
        });

        setIsPending(true);
        try {
          const res = await fetch(`/api/issues/${issue.identifier}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wipeWorkspace }),
          });
          if (!res.ok) throw new Error('Cancel failed');
          await queryClient.refetchQueries({ queryKey: ['issues'] });
          await queryClient.refetchQueries({ queryKey: ['agents'] });
        } catch (err) {
          console.error('Cancel failed:', err);
        } finally {
          setIsPending(false);
        }
      }}
      disabled={isPending}
      className="flex items-center gap-1 text-xs text-orange-400/70 hover:text-orange-400 transition-colors disabled:opacity-50"
      title="Cancel issue — stop agents, move to Canceled on tracker"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
      {isPending ? 'Canceling...' : 'Cancel'}
    </button>
  );
}

// Move to Backlog button for Todo items
function BacklogButton({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        setIsPending(true);
        try {
          await fetch(`/api/issues/${issue.identifier}/move-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'backlog' }),
          });
          await queryClient.refetchQueries({ queryKey: ['issues'] });
        } catch (err) {
          console.error('Move to backlog failed:', err);
        } finally {
          setIsPending(false);
        }
      }}
      disabled={isPending}
      className="flex items-center gap-1 text-xs text-content-muted hover:text-content-subtle transition-colors disabled:opacity-50"
      title="Move to Backlog"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />}
      Backlog
    </button>
  );
}

// Move to Todo button for Backlog items
function TodoButton({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        setIsPending(true);
        try {
          await fetch(`/api/issues/${issue.identifier}/move-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'todo' }),
          });
          await queryClient.refetchQueries({ queryKey: ['issues'] });
        } catch (err) {
          console.error('Move to todo failed:', err);
        } finally {
          setIsPending(false);
        }
      }}
      disabled={isPending}
      className="flex items-center gap-1 text-xs text-content-muted hover:text-content-subtle transition-colors disabled:opacity-50"
      title="Move to Todo"
    >
      {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
      Todo
    </button>
  );
}

// Reopen section for Done/In Review items
function ReopenSection({ issue, inline }: { issue: Issue; inline?: boolean }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reopen issue');
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['issues'] });
    },
  });

  const handleReopen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: 'Reopen Issue', message: `Reopen ${issue.identifier} for re-work?\n\nThis will move it back to In Progress.`, confirmLabel: 'Reopen' })) {
      reopenMutation.mutate();
    }
  };

  const content = (
    <>
      <button
        onClick={handleReopen}
        disabled={reopenMutation.isPending}
        className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-50"
      >
        {reopenMutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RotateCcw className="w-3.5 h-3.5" />
        )}
        {reopenMutation.isPending ? 'Reopening...' : 'Reopen'}
      </button>
      {reopenMutation.isError && (
        <span className="text-xs text-red-400">{(reopenMutation.error as Error).message}</span>
      )}
    </>
  );

  if (inline) return content;

  return (
    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-green-600/30">
      {content}
    </div>
  );
}

// Close-out section for Done items
function CloseOutSection({ issue }: { issue: Issue }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const closeOutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/issues/${issue.identifier}/close-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Close-out failed');
      }
      return data;
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['issues'] });
    },
  });

  const handleCloseOut = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: 'Close Out Issue', message: `Close out ${issue.identifier}?\n\nThis will:\n• Verify branch is merged\n• Archive workspace artifacts\n• Clean up agent state\n• Close issue on tracker\n• Apply closed-out label`, variant: 'destructive', confirmLabel: 'Close Out' })) {
      closeOutMutation.mutate();
    }
  };

  return (
    <>
      <button
        onClick={handleCloseOut}
        disabled={closeOutMutation.isPending}
        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
      >
        {closeOutMutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <CheckCheck className="w-3.5 h-3.5" />
        )}
        {closeOutMutation.isPending ? 'Closing out...' : 'Close Out'}
      </button>
      {closeOutMutation.isError && (
        <span className="text-xs text-red-400">{(closeOutMutation.error as Error).message}</span>
      )}
    </>
  );
}
