import type { ReviewStatusSnapshot, SessionNode } from '@overdeck/contracts';
import type { PipelineIssuePhase } from '../../lib/pipeline-state';
import { compactModelName } from '../../lib/model-names';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

export interface BucketedFeature {
  feature: ProjectFeature;
  reviewStatus: ReviewStatusSnapshot | undefined;
  phase: PipelineIssuePhase;
}

export interface PipelineGroup {
  key: string;
  phase: PipelineIssuePhase | 'needs-you';
  title: string;
  subtitle: string;
  entries: BucketedFeature[];
}

export interface PipelineChipSpec {
  key: string;
  label: string;
  textClass: string;
  bgClass: string;
  dotClass: string;
  ringClass: string;
  animate: boolean;
}

export interface IssueCostBreakdown {
  byModel: Record<string, { cost: number; tokens: number }>;
  byStage: Record<string, { cost: number; tokens: number }>;
}

const ACTIVE_AGENT_STATUSES = new Set(['active', 'running', 'starting']);
const REVIEW_BLOCKED_STATUSES = new Set(['failed', 'blocked']);
const TEST_BLOCKED_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_BLOCKED_STATUSES = new Set(['failed']);
const VERIFICATION_BLOCKED_STATUSES = new Set(['failed']);

export function hasActiveWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work' && session.presence === 'active') ?? false;
}

export function hasWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work') ?? false;
}

export function hasActiveAgentSignal(feature: ProjectFeature): boolean {
  return hasActiveWorkSession(feature) || ACTIVE_AGENT_STATUSES.has(feature.agentStatus ?? '');
}

export function isBlockedFeature(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): boolean {
  return Boolean(
    feature.agentStatus === 'failed' ||
      reviewStatus?.stuck ||
      (reviewStatus?.blockerReasons?.length ?? 0) > 0 ||
      REVIEW_BLOCKED_STATUSES.has(reviewStatus?.reviewStatus ?? '') ||
      TEST_BLOCKED_STATUSES.has(reviewStatus?.testStatus ?? '') ||
      MERGE_BLOCKED_STATUSES.has(reviewStatus?.mergeStatus ?? '') ||
      VERIFICATION_BLOCKED_STATUSES.has(reviewStatus?.verificationStatus ?? ''),
  );
}

export function isNeedsYouFeature(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): boolean {
  if (reviewStatus?.readyForMerge || feature.readyForMerge) return true;
  if (feature.sessions?.some(session => session.paused)) return true;
  if (feature.sessions?.some(session => session.type === 'planning' && session.awaitingInput)) return true;
  // Plan proposed but not yet approved: PRD exists, no workspace continue state,
  // and no active planning session still writing the plan.
  if (
    feature.hasPrd &&
    !feature.hasState &&
    !feature.sessions?.some(session => session.type === 'planning')
  ) {
    return true;
  }
  return false;
}

export function stuckReason(reviewStatus: ReviewStatusSnapshot | undefined): string {
  if (reviewStatus?.stuckReason) return reviewStatus.stuckReason;
  if (reviewStatus?.blockerReasons?.[0]) return reviewStatus.blockerReasons[0].summary;
  if (reviewStatus?.reviewStatus === 'blocked') return 'Review blocked';
  if (reviewStatus?.reviewStatus === 'failed') return 'Review failed';
  if (reviewStatus?.testStatus === 'dispatch_failed') return 'Test dispatch failed';
  if (reviewStatus?.testStatus === 'failed') return 'Tests failed';
  if (reviewStatus?.mergeStatus === 'failed') return 'Merge failed';
  if (reviewStatus?.verificationStatus === 'failed') return 'Verification failed';
  return 'Needs attention';
}

export function pipelineChipFor(entry: BucketedFeature): PipelineChipSpec {
  const { feature, reviewStatus, phase } = entry;

  if (isNeedsYouFeature(feature, reviewStatus)) {
    return {
      key: 'waiting',
      label: 'waiting on you',
      textClass: 'text-amber-600',
      bgClass: 'bg-amber-500/14',
      dotClass: 'bg-amber-500',
      ringClass: 'border-amber-500',
      animate: false,
    };
  }

  if (phase === 'ship') {
    return {
      key: 'ship',
      label: 'lining up to ship',
      textClass: 'text-violet-600',
      bgClass: 'bg-violet-500/12',
      dotClass: 'bg-violet-500',
      ringClass: 'border-violet-500',
      animate: false,
    };
  }

  if (phase === 'review') {
    if (reviewStatus?.testStatus === 'testing' || reviewStatus?.verificationStatus === 'running') {
      return {
        key: 'testing',
        label: 'testing',
        textClass: 'text-teal-600',
        bgClass: 'bg-teal-500/12',
        dotClass: 'bg-teal-500',
        ringClass: 'border-teal-500',
        animate: true,
      };
    }
    return {
      key: 'review',
      label: 'in review',
      textClass: 'text-violet-600',
      bgClass: 'bg-violet-500/12',
      dotClass: 'bg-violet-500',
      ringClass: 'border-violet-500',
      animate: reviewStatus?.reviewStatus === 'reviewing',
    };
  }

  if (phase === 'work') {
    return {
      key: 'building',
      label: 'building',
      textClass: 'text-blue-600',
      bgClass: 'bg-blue-500/12',
      dotClass: 'bg-blue-500',
      ringClass: 'border-blue-500',
      animate: hasActiveAgentSignal(feature),
    };
  }

  if (phase === 'plan') {
    return {
      key: 'planning',
      label: 'planning',
      textClass: 'text-teal-600',
      bgClass: 'bg-teal-500/12',
      dotClass: 'bg-teal-500',
      ringClass: 'border-teal-500',
      animate: hasActiveAgentSignal(feature),
    };
  }

  return {
    key: 'queued',
    label: 'queued',
    textClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
    dotClass: 'bg-muted-foreground',
    ringClass: 'border-border',
    animate: false,
  };
}

export function sublineFor(entry: BucketedFeature): string {
  const { feature, reviewStatus, phase } = entry;
  const progress = feature.childCount && feature.childCount > 0
    ? `${feature.completedCount ?? 0} of ${feature.childCount} tasks done`
    : null;

  if (isNeedsYouFeature(feature, reviewStatus)) {
    if (reviewStatus?.readyForMerge || feature.readyForMerge) return 'merge train assembled — held for your review';
    if (feature.sessions?.some(session => session.paused)) return 'waiting on your answer';
    if (phase === 'plan') return 'plan approval pending';
    return progress ?? 'all checks passed';
  }

  if (isBlockedFeature(feature, reviewStatus)) {
    return stuckReason(reviewStatus);
  }

  if (reviewStatus?.testStatus === 'testing') return 'tests running now';
  if (reviewStatus?.reviewStatus === 'reviewing') return 'reviewer checking the finished work';
  if (reviewStatus?.reviewStatus === 'passed') {
    return reviewStatus?.testStatus === 'pending' ? 'review passed · tests next' : (progress ?? 'review passed');
  }
  if (reviewStatus?.verificationStatus === 'running') return 'build check running';
  if (phase === 'work') return progress ?? 'writing code';
  if (phase === 'plan') return 'planning what to build';
  if (phase === 'ship') return 'lining up to ship';
  return progress ?? 'waiting to start';
}

function isSupervisor(session: SessionNode): boolean {
  const id = session.tmuxSession ?? session.sessionId ?? '';
  return id.includes('-supervisor') || session.role === 'supervisor';
}

export function sessionRoleLabel(type: SessionNode['type']): string {
  if (type === 'knowledge') return 'knowledge agent';
  if (type === 'reviewer' || type === 'review') return 'reviewer';
  if (type === 'test') return 'test agent';
  if (type === 'planning') return 'planner';
  return type;
}

interface ModelCount {
  label: string;
  count: number;
}

function modelCounts(
  sessions: readonly SessionNode[],
  labelFor: (session: SessionNode) => string = session => compactModelName(session.model),
): ModelCount[] {
  const map = new Map<string, number>();
  for (const session of sessions) {
    const label = labelFor(session);
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([label, count]) => ({ label, count }));
}

function formatCounts(counts: ModelCount[]): string {
  return counts
    .map(({ label, count }) => (count > 1 ? `${label} ×${count}` : label))
    .join(' + ');
}

export function whoLineFor(entry: BucketedFeature): string | null {
  const sessions = entry.feature.sessions ?? [];
  if (sessions.length === 0) return null;

  const supervisor = sessions.find(isSupervisor);
  const workers = sessions.filter(s => (s.type === 'work' || s.type === 'strike') && !isSupervisor(s));
  const specialists = sessions.filter(s => ['planning', 'knowledge', 'review', 'reviewer', 'test'].includes(s.type) && !isSupervisor(s));

  const parts: string[] = [];
  if (workers.length > 0) {
    parts.push(formatCounts(modelCounts(workers)));
  }
  if (supervisor) {
    parts.push(`${compactModelName(supervisor.model)} supervisor`);
  }
  if (specialists.length > 0) {
    parts.push(formatCounts(modelCounts(specialists, s => `${compactModelName(s.model)} ${sessionRoleLabel(s.type)}`)));
  }
  if (parts.length === 0) return null;

  const active = sessions.some(s => s.presence === 'active');
  const suffix = active ? 'active now' : 'waiting';
  return `${parts.join(' + ')} · ${suffix}`;
}

export function sessionCountFor(feature: ProjectFeature): number {
  return feature.sessions?.length ?? 0;
}

export function formatPipelineCost(cost: number | undefined): string {
  if (cost === undefined || Number.isNaN(cost)) return '—';
  if (cost === 0) return '$0.00';
  return `$${cost.toFixed(2)}`;
}

export function lastActivityAt(entry: BucketedFeature): number {
  const sessionTimes = (entry.feature.sessions ?? [])
    .flatMap(session => [session.startedAt, session.endedAt].filter(Boolean))
    .map(iso => new Date(iso!).getTime())
    .filter(t => !Number.isNaN(t));
  const reviewTime = entry.reviewStatus?.updatedAt ? new Date(entry.reviewStatus.updatedAt).getTime() : NaN;
  const times = [...sessionTimes, ...(Number.isNaN(reviewTime) ? [] : [reviewTime])];
  return times.length > 0 ? Math.max(...times) : 0;
}

export function sortByLastActivity(entries: readonly BucketedFeature[]): BucketedFeature[] {
  return [...entries].sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

export function stageDisplayName(phase: PipelineIssuePhase): { title: string; subtitle: string } {
  switch (phase) {
    case 'ship': return { title: 'Lining up to ship', subtitle: 'ready to merge' };
    case 'review': return { title: 'Being reviewed', subtitle: 'quality checks' };
    case 'work': return { title: 'Being built', subtitle: 'implementation' };
    case 'plan': return { title: 'Planning', subtitle: 'writing the plan' };
    case 'ready': return { title: 'Ready', subtitle: 'queued for pickup' };
    case 'todo': return { title: 'Todo', subtitle: 'not started' };
    case 'verifying': return { title: 'Verifying', subtitle: 'on main' };
    default: return { title: phase, subtitle: '' };
  }
}

export function groupPipelineEntries(entries: readonly BucketedFeature[]): PipelineGroup[] {
  const needsYou = sortByLastActivity(entries.filter(e => isNeedsYouFeature(e.feature, e.reviewStatus)));
  const groups: PipelineGroup[] = [];

  if (needsYou.length > 0) {
    groups.push({
      key: 'needs-you',
      phase: 'needs-you',
      title: 'Needs you',
      subtitle: 'waiting on a human decision',
      entries: needsYou,
    });
  }

  const phaseOrder: PipelineIssuePhase[] = ['ship', 'review', 'work', 'plan', 'ready', 'todo', 'verifying'];
  for (const phase of phaseOrder) {
    const phaseEntries = sortByLastActivity(
      entries.filter(e => e.phase === phase && !isNeedsYouFeature(e.feature, e.reviewStatus)),
    );
    if (phaseEntries.length === 0) continue;
    const { title, subtitle } = stageDisplayName(phase);
    groups.push({ key: phase, phase, title, subtitle, entries: phaseEntries });
  }

  return groups;
}
