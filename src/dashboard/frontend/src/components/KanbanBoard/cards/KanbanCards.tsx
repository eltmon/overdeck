import { useState, useMemo, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { toast } from 'sonner';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ExternalLink, User, Play, Eye, DollarSign, ChevronDown, ChevronRight, Sparkles, FileText, List, ScrollText } from 'lucide-react';
import { useDashboardStore, selectReviewStatus } from '../../../lib/store';
import { Issue, Agent, STATUS_LABELS } from '../../../types';
import { getFriendlyModelName } from '../../../lib/dashboard-utils';
import { parseDifficultyLabel } from '../../../../../../lib/cloister/complexity.js';
import { deriveIssueActionPhase, type PipelinePhase } from '../../../lib/issueActions';
import { cn } from '../../../lib/utils';
import { getIssueWorkAgentMap, isAgentSessionAttachable } from '../../../lib/workAgents';
import { IssueActionMenu, useIssueActions } from '../../IssueActionMenu';
import IssueCardPrimitive from '../../primitives/IssueCard';
import VerbBadge from '../../primitives/VerbBadge';
import { VerifyingOnMainBadge } from '../../VerifyingOnMainBadge';
import { CostBreakdownModal } from '../../CostBreakdownModal';
import type { WorkspaceData } from '../../CommandDeck/ZoneCOverviewTabs/queries';
import { DifficultyBadge, TrackerShadowBadges } from '../badges';
import { avatarGradient, cardAvatarInitials, formatCost, formatRuntime, getCostColor } from '../kanban-utils';
import type { IssueCost, PlanningState } from '../types';

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

// DraggableCard wrapper component
interface DraggableCardWrapperProps {
  issue: Issue;
  children: React.ReactNode;
}

export function DraggableCardWrapper({ issue, children }: DraggableCardWrapperProps) {
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

export function DragOverlayCard({ issue }: DragOverlayCardProps) {
  return (
    <div className="bg-popover rounded-lg p-3 border-l-4 border-l-blue-500 shadow-2xl rotate-2 scale-105 opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">{issue.identifier}</span>
      </div>
      <p className="text-sm text-foreground mt-1 line-clamp-2">{issue.title}</p>
    </div>
  );
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
