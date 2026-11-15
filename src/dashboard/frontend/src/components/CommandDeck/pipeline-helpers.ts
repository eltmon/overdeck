import type { SessionNode } from '@overdeck/contracts';
import type { CanonicalState, DerivedIssueState } from '../../types';
import { PHASE_BY_DERIVED_STATE, type PipelineIssuePhase } from '../../lib/pipeline-state';
import { compactModelName } from '../../lib/model-names';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

export type PipelineBucketPhase = PipelineIssuePhase | 'needs-you' | 'stalled';

export interface BucketedFeature {
  feature: ProjectFeature;
  /** PAN-3917 — the issue's derived state (FR-6). Replaces the review-status row. */
  derived: DerivedIssueState | undefined;
  phase: PipelineBucketPhase;
}

/** PAN-5294 G-D5 — the four Home pipeline lanes, in render order. */
export type PipelineLaneKey = 'building' | 'review' | 'ready' | 'stalled';

export interface PipelineGroup {
  key: PipelineLaneKey;
  title: string;
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

export function hasActiveWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work' && session.presence === 'active') ?? false;
}

export function hasWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work') ?? false;
}

export function hasActiveAgentSignal(feature: ProjectFeature): boolean {
  return hasActiveWorkSession(feature) || ACTIVE_AGENT_STATUSES.has(feature.agentStatus ?? '');
}

const STALLED_INACTIVITY_MS = 14 * 24 * 60 * 60 * 1000;

function hasAdmittedArtifactSignal(feature: ProjectFeature): boolean {
  const details = feature.resourceDetails;
  if (details?.branchAheadOfMain) return true;
  if (details?.conversations && details.conversations.length > 0) return true;

  const totals = feature.taskTotals;
  if (totals) {
    if (totals.inProgress > 0) return true;
    if (totals.closed > 0 && totals.closed < totals.total) return true;
  }
  return false;
}

function featureLastActivity(feature: ProjectFeature): number {
  const sessionTimes = (feature.sessions ?? [])
    .flatMap(session => [session.startedAt, session.endedAt].filter(Boolean))
    .map(iso => new Date(iso!).getTime())
    .filter(t => !Number.isNaN(t));
  const taskUpdated = feature.taskTotals?.lastUpdated
    ? new Date(feature.taskTotals.lastUpdated).getTime()
    : NaN;
  const times = [
    ...sessionTimes,
    ...(Number.isNaN(taskUpdated) ? [] : [taskUpdated]),
  ];
  return times.length > 0 ? Math.max(...times) : 0;
}

function isStaleActivity(feature: ProjectFeature): boolean {
  const last = featureLastActivity(feature);
  if (last === 0) return true;
  return Date.now() - last >= STALLED_INACTIVITY_MS;
}

export function isStalledFeature(feature: ProjectFeature): boolean {
  if (!hasAdmittedArtifactSignal(feature)) return false;
  if (hasActiveAgentSignal(feature)) return false;
  return isStaleActivity(feature);
}

export function isBlockedFeature(feature: ProjectFeature, derived: DerivedIssueState | undefined): boolean {
  return Boolean(
    feature.agentStatus === 'failed' ||
      derived?.attention === 'stuck' ||
      derived?.attention === 'api-error' ||
      derived?.pr?.checks === 'red' ||
      derived?.pr?.mergeable === false,
  );
}

function isPlanApprovalPending(feature: ProjectFeature): boolean {
  return feature.pipelineBucket === 'planned_backlog'
    && feature.hasPrd
    && !feature.hasState
    && !feature.sessions?.some(session => session.type === 'planning');
}

export function isNeedsYouFeature(feature: ProjectFeature, derived: DerivedIssueState | undefined): boolean {
  if (derived?.attention === 'needs-you') return true;
  if (derived?.attention === 'work-not-started') return true;
  if (derived?.attention === 'pr-outside-pipeline') return true;
  if (derived?.state === 'ready') return true;
  if (feature.sessions?.some(session => session.type === 'planning' && session.awaitingInput)) return true;
  // The membership resolver distinguishes a real planned backlog from terminal
  // PRD residue and active work whose workspace continue state is unavailable.
  return isPlanApprovalPending(feature);
}

export function stuckReason(derived: DerivedIssueState | undefined): string {
  if (derived?.attention === 'api-error') return 'Provider errors — the agent cannot make a call';
  if (derived?.pr?.checks === 'red') return 'Checks failing on the pull request';
  if (derived?.pr?.mergeable === false) return 'Pull request conflicts with main';
  return 'Needs attention';
}

export function pipelineChipFor(entry: BucketedFeature): PipelineChipSpec {
  const { feature, derived, phase } = entry;

  // Amber = a human must act; blue = a machine is working; purple = specialist
  // verb; red = broken. One colored signal per row (style guide §restraint).
  if (isNeedsYouFeature(feature, derived)) {
    return {
      key: 'waiting',
      label: 'waiting on you',
      textClass: 'text-warning-foreground',
      bgClass: 'bg-warning/[0.08]',
      dotClass: 'bg-warning',
      ringClass: 'border-warning/[0.32]',
      animate: false,
    };
  }

  if (isBlockedFeature(feature, derived)) {
    return {
      key: 'blocked',
      label: 'blocked',
      textClass: 'text-destructive',
      bgClass: 'bg-destructive/[0.08]',
      dotClass: 'bg-destructive',
      ringClass: 'border-destructive/[0.32]',
      animate: false,
    };
  }

  if (phase === 'stalled') {
    return {
      key: 'stalled',
      label: 'stalled — has work, no live agent',
      textClass: 'text-warning-foreground',
      bgClass: 'bg-warning/[0.08]',
      dotClass: 'bg-warning',
      ringClass: 'border-warning/[0.32]',
      animate: false,
    };
  }

  if (phase === 'ship') {
    return {
      key: 'ship',
      label: derived?.state === 'merged' ? 'merged' : 'lining up to ship',
      textClass: 'text-signal-review',
      bgClass: 'bg-signal-review/[0.08]',
      dotClass: 'bg-signal-review',
      ringClass: 'border-signal-review/[0.32]',
      animate: false,
    };
  }

  if (phase === 'review') {
    return {
      key: 'review',
      label: derived?.state === 'changes-requested' ? 'changes requested' : 'in review',
      textClass: 'text-signal-review',
      bgClass: 'bg-signal-review/[0.08]',
      dotClass: 'bg-signal-review',
      ringClass: 'border-signal-review/[0.32]',
      animate: derived?.state === 'in-review',
    };
  }

  if (phase === 'work') {
    return {
      key: 'building',
      label: 'building',
      textClass: 'text-info',
      bgClass: 'bg-info/[0.08]',
      dotClass: 'bg-info',
      ringClass: 'border-info/[0.32]',
      animate: hasActiveAgentSignal(feature),
    };
  }

  if (phase === 'plan') {
    return {
      key: 'planning',
      label: 'planning',
      textClass: 'text-info',
      bgClass: 'bg-info/[0.08]',
      dotClass: 'bg-info',
      ringClass: 'border-info/[0.32]',
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
  const { feature, derived, phase } = entry;
  const progress = feature.childCount && feature.childCount > 0
    ? `${feature.completedCount ?? 0} of ${feature.childCount} tasks done`
    : null;

  if (isNeedsYouFeature(feature, derived)) {
    if (derived?.attention === 'pr-outside-pipeline') return `review never started — ${derived.prOutsidePipeline?.fix ?? 'run pan review request'}`;
    if (derived?.attention === 'work-not-started') {
      return `work agent not started — ${derived.workStart?.error ?? 'run pan start'}`;
    }
    if (derived?.state === 'ready') return 'approved and green — held for your merge';
    if (feature.sessions?.some(session => session.type === 'planning' && session.awaitingInput)) {
      return 'waiting on your answer';
    }
    if (isPlanApprovalPending(feature)) return 'plan approval pending';
    return progress ?? 'waiting on your decision';
  }

  if (isBlockedFeature(feature, derived)) {
    return stuckReason(derived);
  }

  if (phase === 'stalled') {
    return 'work artifacts present but no live agent';
  }

  if (derived?.state === 'changes-requested') return 'reviewer asked for changes';
  if (derived?.state === 'in-review') {
    return derived.pr?.checks === 'pending' ? 'in review · checks running' : 'reviewer checking the finished work';
  }
  if (derived?.state === 'merged') return 'merged';
  if (derived?.workStart?.status === 'retrying' && derived.workStart.held) return 'work agent start held while the Deacon is frozen';
  if (derived?.workStart?.status === 'retrying') return 'work agent start retrying';
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

export function lastActivityAt(entry: BucketedFeature): number {
  return featureLastActivity(entry.feature);
}

export function sortByLastActivity(entries: readonly BucketedFeature[]): BucketedFeature[] {
  return [...entries].sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

const LANE_TITLES: Record<PipelineLaneKey, string> = {
  building: 'Building',
  review: 'In review',
  ready: 'Ready to merge',
  stalled: 'Stalled',
};

/**
 * PAN-5294 G-D5 — the lane an entry belongs to, or null when Home does not
 * list it (todo, queued for pickup, merged, closed). Stalled claims first, so
 * a stalled entry appears in no other lane.
 */
export function homeLaneFor(entry: BucketedFeature): PipelineLaneKey | null {
  if (entry.phase === 'stalled' || isStalledFeature(entry.feature)) return 'stalled';
  if (entry.derived?.state === 'ready') return 'ready';
  if (entry.phase === 'plan' || entry.phase === 'work') return 'building';
  if (entry.phase === 'review') return 'review';
  return null;
}

/**
 * PAN-5294 G-D5 — Building, In review and Ready to merge always render (even
 * at 0); Stalled renders only when it has entries and comes last.
 */
export function groupPipelineEntries(entries: readonly BucketedFeature[]): PipelineGroup[] {
  const byLane: Record<PipelineLaneKey, BucketedFeature[]> = { building: [], review: [], ready: [], stalled: [] };
  for (const entry of entries) {
    const lane = homeLaneFor(entry);
    if (!lane) continue;
    byLane[lane].push(lane === 'stalled' ? { ...entry, phase: 'stalled' } : entry);
  }

  const order: PipelineLaneKey[] = ['building', 'review', 'ready'];
  if (byLane.stalled.length > 0) order.push('stalled');
  return order.map(key => ({ key, title: LANE_TITLES[key], entries: sortByLastActivity(byLane[key]) }));
}

export interface HomeStageTag {
  key: 'needs-you' | 'blocked' | 'stalled' | 'planning' | 'building' | 'changes-requested' | 'in-review' | 'ready' | 'queued';
  label: string;
  /** Badge formula classes: one colored signal per row (style guide). */
  className: string;
}

const MUTED_TAG = 'badge-bg-muted badge-border-muted text-muted-foreground';
const LIVE_TAG = 'badge-bg-state-live badge-border-state-live text-state-live';

/**
 * PAN-5294 G-D6 — the Home row tag. `needsYou` comes from the same
 * needs-you list as the Needs-you fact, so the tag and the fact agree.
 */
export function homeStageTag(entry: BucketedFeature, needsYou: boolean): HomeStageTag {
  const { feature, derived, phase } = entry;
  if (needsYou) {
    return { key: 'needs-you', label: 'needs you', className: 'badge-bg-state-needs-you badge-border-state-needs-you text-state-needs-you' };
  }
  if (isBlockedFeature(feature, derived)) {
    return { key: 'blocked', label: 'blocked', className: 'badge-bg-destructive badge-border-destructive text-destructive' };
  }
  const lane = homeLaneFor(entry);
  if (lane === 'stalled') return { key: 'stalled', label: 'stalled', className: MUTED_TAG };
  if (lane === 'ready') {
    return { key: 'ready', label: 'ready', className: 'badge-bg-state-done badge-border-state-done text-state-done' };
  }
  if (phase === 'plan') return { key: 'planning', label: 'planning', className: LIVE_TAG };
  if (phase === 'work') return { key: 'building', label: 'building', className: LIVE_TAG };
  if (phase === 'review') {
    return derived?.state === 'changes-requested'
      ? { key: 'changes-requested', label: 'changes requested', className: MUTED_TAG }
      : { key: 'in-review', label: 'in review', className: MUTED_TAG };
  }
  return { key: 'queued', label: 'queued', className: MUTED_TAG };
}

const CHECKS_WORD: Partial<Record<string, string>> = { green: 'green', pending: 'running', red: 'failing' };

/**
 * PAN-5294 G-D7 — the Home row "who" cell: the pull request and its checks for
 * In review / Ready to merge rows, else the agent's model and item progress.
 */
export function homeWhoFor(entry: BucketedFeature): string {
  const { feature, derived } = entry;
  const lane = homeLaneFor(entry);
  if ((lane === 'review' || lane === 'ready') && derived?.pr) {
    const word = CHECKS_WORD[derived.pr.checks ?? ''];
    return word ? `PR #${derived.pr.number} · checks ${word}` : `PR #${derived.pr.number}`;
  }

  const sessions = feature.sessions ?? [];
  if (sessions.length === 0) return 'no agent';
  const session = sessions.find(s => s.presence === 'active') ?? sessions[0];
  const model = compactModelName(session.model);
  const totals = feature.taskTotals;
  if (totals && totals.total > 0) return `${model} · ${totals.closed} of ${totals.total} items`;
  if (feature.childCount && feature.childCount > 0) {
    return `${model} · ${feature.completedCount ?? 0} of ${feature.childCount} items`;
  }
  return model;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * PAN-5294 G-D7 — the Home row age: time since last activity. Unknown or
 * non-positive → '—'; under an hour → minutes; under 48 hours → hours; else days.
 */
export function formatAge(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} m`;
  if (ms < 48 * HOUR_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  return `${Math.floor(ms / (24 * HOUR_MS))} d`;
}

/**
 * PAN-3917: the lane comes from the derived issue state. When the server has
 * not derived one yet, the tracker's own state (an owner, never a record)
 * places the row so the tree does not collapse every feature into Todo.
 */
function featureState(feature: ProjectFeature): CanonicalState | undefined {
  const raw = `${feature.status} ${feature.stateLabel}`.toLowerCase();
  if (raw.includes('close-out')) return 'done';
  if (raw.includes('review')) return 'in_review';
  if (raw.includes('progress') || hasActiveAgentSignal(feature)) return 'in_progress';
  if (raw.includes('done') || raw.includes('complete')) return 'done';
  if (raw.includes('cancel')) return 'canceled';
  return feature.status as CanonicalState | undefined;
}

function trackerPhase(feature: ProjectFeature): PipelineIssuePhase {
  switch (featureState(feature)) {
    case 'done':
    case 'canceled':
      return 'ship';
    case 'in_review':
      return 'review';
    case 'in_progress':
      return 'work';
    default:
      return feature.hasPlanning && !hasWorkSession(feature) ? 'plan' : 'todo';
  }
}

export function bucketFeaturePhase(
  feature: ProjectFeature,
  derived: DerivedIssueState | undefined,
): PipelineIssuePhase {
  return derived ? PHASE_BY_DERIVED_STATE[derived.state] : trackerPhase(feature);
}
