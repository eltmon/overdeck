import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import { useDashboardStore } from '../../lib/store';
import { getPipelineIssuePhase, type PipelineIssuePhase } from '../../lib/pipeline-state';
import IssueRow, { type IssueRowPriority } from '../primitives/IssueRow';
import PhaseHeader from '../primitives/PhaseHeader';
import VerbBadge, { type VerbBadgeVariant } from '../primitives/VerbBadge';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { Agent, Issue, CanonicalState } from '../../types';

type MergeTrainOverride = 'enabled' | 'disabled' | null;

export interface IssueCostBreakdown {
  byModel: Record<string, { cost: number; tokens: number }>;
  byStage: Record<string, { cost: number; tokens: number }>;
}

interface ProjectOverviewProps {
  projectName: string;
  /** projects.yaml key for this project — enables the settings panel (PAN-1693). */
  projectKey?: string;
  features: ProjectFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
}

interface BucketedFeature {
  feature: ProjectFeature;
  reviewStatus: ReviewStatusSnapshot | undefined;
  phase: PipelineIssuePhase;
}

const PIPELINE_PHASES: PipelineIssuePhase[] = ['ship', 'review', 'work', 'plan', 'todo'];
const ACTIVE_AGENT_STATUSES = new Set(['active', 'running', 'starting']);
const REVIEW_BLOCKED_STATUSES = new Set(['failed', 'blocked']);
const TEST_BLOCKED_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_BLOCKED_STATUSES = new Set(['failed']);
const VERIFICATION_BLOCKED_STATUSES = new Set(['failed']);

type PipelineClassifierIssue = Pick<Issue, 'state' | 'status' | 'stateType' | 'hasPlan' | 'planningComplete' | 'mergeStatus'>;
type PipelineClassifierAgent = Pick<Agent, 'role' | 'status' | 'hasPendingQuestion' | 'pendingQuestionCount' | 'pendingQuestionPrompt'>;

function hasActiveWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work' && session.presence === 'active') ?? false;
}

function hasWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some(session => session.type === 'work') ?? false;
}

function hasActiveAgentSignal(feature: ProjectFeature): boolean {
  return hasActiveWorkSession(feature) || ACTIVE_AGENT_STATUSES.has(feature.agentStatus ?? '');
}

function reviewStatusForClassifier(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): ReviewStatusSnapshot | undefined {
  if (!feature.readyForMerge) return reviewStatus;
  return {
    ...(reviewStatus ?? { issueId: feature.issueId }),
    readyForMerge: reviewStatus?.readyForMerge ?? true,
  } as ReviewStatusSnapshot;
}

function featureState(feature: ProjectFeature): CanonicalState | undefined {
  const raw = `${feature.status} ${feature.stateLabel}`.toLowerCase();
  if (raw.includes('verifying')) return 'verifying_on_main';
  if (raw.includes('review')) return 'in_review';
  if (raw.includes('progress') || hasActiveAgentSignal(feature)) return 'in_progress';
  if (raw.includes('done') || raw.includes('complete')) return 'done';
  if (raw.includes('cancel')) return 'canceled';
  return feature.status as CanonicalState | undefined;
}

function classifierIssue(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): PipelineClassifierIssue {
  const state = featureState(feature);
  return {
    status: feature.status,
    state,
    stateType: state === 'done' ? 'completed' : state === 'canceled' ? 'canceled' : undefined,
    hasPlan: feature.hasPlanning,
    planningComplete: feature.hasPlanning && !hasWorkSession(feature),
    mergeStatus: reviewStatus?.mergeStatus,
  };
}

function classifierAgent(feature: ProjectFeature): PipelineClassifierAgent | null {
  if (!hasActiveAgentSignal(feature)) return null;
  return {
    role: 'work',
    status: 'running',
  };
}

export function bucketFeaturePhase(
  feature: ProjectFeature,
  reviewStatus: ReviewStatusSnapshot | undefined,
): PipelineIssuePhase {
  const status = reviewStatusForClassifier(feature, reviewStatus);
  return getPipelineIssuePhase(classifierIssue(feature, status), status, classifierAgent(feature));
}

function reviewStatusForFeature(
  feature: ProjectFeature,
  reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>,
) {
  return reviewStatusByIssueId[feature.issueId] ??
    reviewStatusByIssueId[feature.issueId.toUpperCase()] ??
    reviewStatusByIssueId[feature.issueId.toLowerCase()];
}

function isBlockedFeature(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): boolean {
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

/**
 * Project lifetime spend (PAN-1589). `issueCosts` is a GLOBAL map (every issue
 * across all projects, keyed by both `PAN-1` and a lowercased alias). We scope
 * it to this project by the issue prefix(es) of its features, and sum ALL
 * matching issues — including closed/historical ones, not just active features.
 * Counting only the canonical (non-lowercased) keys avoids double-counting the
 * alias entries. Shared by the cockpit Spend metric and the Home cost chip so
 * the two always agree.
 */
export function projectTotalCost(
  issueCosts: Record<string, number>,
  features: { issueId: string }[],
): number {
  const prefixes = new Set(
    features.map(f => f.issueId.split('-')[0]?.toUpperCase()).filter(Boolean),
  );
  if (prefixes.size === 0) return 0;
  let sum = 0;
  for (const [key, value] of Object.entries(issueCosts)) {
    if (key !== key.toUpperCase()) continue; // skip lowercased aliases
    const prefix = key.split('-')[0]?.toUpperCase();
    if (prefix && prefixes.has(prefix)) sum += value;
  }
  return sum;
}

interface ProjectMergeTrainSetting {
  value: MergeTrainOverride;
  effective: boolean;
}

interface MergeTrainQueueItem {
  projectKey?: string;
  issueId?: string;
}

interface MergeTrainQueueGroup {
  projectKey?: string;
  queue?: MergeTrainQueueItem[];
  items?: MergeTrainQueueItem[];
}

interface MergeTrainGeneration {
  projectKey?: string;
  name: string;
  status: string;
}

interface MergeTrainGenerationGroup {
  projectKey?: string;
  generations?: MergeTrainGeneration[];
}

async function fetchJsonOrEmpty<T>(url: string, fallback: T): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) return fallback;
  return res.json() as Promise<T>;
}

function mergeTrainQueueCount(payload: unknown, projectKey: string): number {
  if (!Array.isArray(payload)) return 0;
  let total = 0;
  for (const entry of payload) {
    const group = entry as MergeTrainQueueGroup;
    if (group.projectKey === projectKey) {
      if (Array.isArray(group.queue)) total += group.queue.length;
      else if (Array.isArray(group.items)) total += group.items.length;
      else if ('issueId' in group) total += 1;
      continue;
    }
    const item = entry as MergeTrainQueueItem;
    if (item.projectKey === projectKey) total += 1;
  }
  return total;
}

function mergeTrainGenerationsForProject(payload: unknown, projectKey: string): MergeTrainGeneration[] {
  if (!Array.isArray(payload)) return [];
  const generations: MergeTrainGeneration[] = [];
  for (const entry of payload) {
    const group = entry as MergeTrainGenerationGroup;
    if (group.projectKey === projectKey && Array.isArray(group.generations)) {
      generations.push(...group.generations.filter((gen) => gen.projectKey === undefined || gen.projectKey === projectKey));
      continue;
    }
    const generation = entry as MergeTrainGeneration;
    if (generation.projectKey === projectKey && typeof generation.name === 'string') {
      generations.push(generation);
    }
  }
  return generations;
}

function currentGeneration(generations: MergeTrainGeneration[]): MergeTrainGeneration | null {
  return generations.find((g) => g.status === 'ready') ??
    generations.find((g) => g.status === 'assembling') ??
    generations.find((g) => g.status === 'superseded') ??
    null;
}

function shortGenerationName(name: string): string {
  return name.replace(/^uat\//, '');
}

/** PAN-1693/1695/1696: per-project settings in the cockpit. */
function ProjectSettingsSection({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const { data: autoMergeData } = useQuery({
    queryKey: ['project-auto-merge-default', projectKey],
    queryFn: async (): Promise<{ value: 'auto' | 'hold' | null }> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/auto-merge-default`);
      if (!res.ok) return { value: null };
      return res.json();
    },
    enabled: !!projectKey,
  });
  const { data: mergeTrainData } = useQuery({
    queryKey: ['project-merge-train', projectKey],
    queryFn: async (): Promise<ProjectMergeTrainSetting> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/merge-train`);
      if (!res.ok) return { value: null, effective: false };
      return res.json();
    },
    enabled: !!projectKey,
  });
  const { data: mergeTrainQueues } = useQuery({
    queryKey: ['merge-train-queues'],
    queryFn: () => fetchJsonOrEmpty<unknown[]>('/api/merge-train/queues', []),
    enabled: !!projectKey,
    refetchInterval: 30_000,
  });
  const { data: mergeTrainGenerations } = useQuery({
    queryKey: ['merge-train-generations'],
    queryFn: () => fetchJsonOrEmpty<unknown[]>('/api/merge-train/generations', []),
    enabled: !!projectKey,
    refetchInterval: 30_000,
  });

  const autoMergeValue = autoMergeData?.value ?? null;
  const mergeTrainValue = mergeTrainData?.value ?? null;
  const mergeTrainEffective = mergeTrainData?.effective ?? false;
  const readyFeatureCount = mergeTrainQueueCount(mergeTrainQueues, projectKey);
  const generation = currentGeneration(mergeTrainGenerationsForProject(mergeTrainGenerations, projectKey));

  const autoMergeMutation = useMutation({
    mutationFn: async (next: 'auto' | 'hold' | null) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/auto-merge-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error('Failed to save project setting');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-auto-merge-default', projectKey] }),
  });
  const mergeTrainMutation = useMutation({
    mutationFn: async (next: MergeTrainOverride) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/merge-train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error('Failed to save project setting');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-merge-train', projectKey] });
      queryClient.invalidateQueries({ queryKey: ['merge-train-queues'] });
      queryClient.invalidateQueries({ queryKey: ['merge-train-generations'] });
    },
  });
  const autoMergeOptions: Array<{ v: 'auto' | 'hold' | null; label: string; color: string }> = [
    { v: 'auto', label: '⚡ Auto', color: 'var(--success)' },
    { v: 'hold', label: '🔒 Hold for UAT', color: 'var(--warning)' },
    { v: null, label: 'Global default', color: 'var(--muted-foreground)' },
  ];
  const mergeTrainOptions: Array<{ v: MergeTrainOverride; label: string; color: string }> = [
    { v: 'enabled', label: 'Enabled', color: 'var(--success)' },
    { v: 'disabled', label: 'Disabled', color: 'var(--destructive)' },
    { v: null, label: 'Global default', color: 'var(--muted-foreground)' },
  ];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)' }}>Project settings</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--foreground)' }}>Auto-merge default</span>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {autoMergeOptions.map((o, i) => {
            const active = autoMergeValue === o.v;
            return (
              <button
                key={String(o.v)}
                type="button"
                aria-pressed={active}
                disabled={autoMergeMutation.isPending}
                onClick={() => autoMergeMutation.mutate(o.v)}
                style={{
                  appearance: 'none',
                  border: 0,
                  borderLeft: i === 0 ? 0 : '1px solid var(--border)',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? `color-mix(in srgb, ${o.color} 16%, transparent)` : 'transparent',
                  color: active ? o.color : 'var(--muted-foreground)',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--foreground)' }}>Merge train</span>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {mergeTrainOptions.map((o, i) => {
            const active = mergeTrainValue === o.v;
            return (
              <button
                key={String(o.v)}
                type="button"
                aria-pressed={active}
                disabled={mergeTrainMutation.isPending}
                onClick={() => mergeTrainMutation.mutate(o.v)}
                style={{
                  appearance: 'none',
                  border: 0,
                  borderLeft: i === 0 ? 0 : '1px solid var(--border)',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? `color-mix(in srgb, ${o.color} 16%, transparent)` : 'transparent',
                  color: active ? o.color : 'var(--muted-foreground)',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {mergeTrainValue === null && (
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
            Effective: {mergeTrainEffective ? 'enabled' : 'disabled'}
          </span>
        )}
      </div>
      <a
        href="/awaiting-merge"
        style={{ fontSize: 11, color: 'var(--muted-foreground)', textDecoration: 'none' }}
      >
        Merge train: {readyFeatureCount} ready feature{readyFeatureCount === 1 ? '' : 's'} · {generation ? `${shortGenerationName(generation.name)} ${generation.status}` : 'no active generation'} · Awaiting Merge
      </a>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
        Applies to this project's issues that have no explicit per-issue auto-merge setting.
      </div>
    </div>
  );
}

export function ProjectOverview({
  projectName,
  projectKey,
  features,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
}: ProjectOverviewProps) {
  const reviewStatusByIssueId = useDashboardStore(state => state.reviewStatusByIssueId);

  const totalCost = useMemo(
    () => projectTotalCost(issueCosts, features),
    [features, issueCosts],
  );

  // PAN-1597: recent (rolling 7-day) project spend — far more actionable than
  // the lifetime total. Derive the single project prefix from the features and
  // ask the windowed, project-scoped cost summary for it.
  const projectPrefix = useMemo(() => {
    const prefixes = new Set(
      features.map((f) => f.issueId.split('-')[0]?.toUpperCase()).filter(Boolean),
    );
    return prefixes.size === 1 ? [...prefixes][0]! : null;
  }, [features]);

  const { data: recentCost } = useQuery<{ week?: { totalCost?: number } }>({
    queryKey: ['project-recent-spend', projectPrefix],
    queryFn: async () => {
      const res = await fetch(`/api/costs/summary?project=${encodeURIComponent(projectPrefix!)}`);
      if (!res.ok) throw new Error('Failed to fetch project spend');
      return res.json();
    },
    enabled: !!projectPrefix,
    refetchInterval: 60_000,
  });
  const recentSpend = recentCost?.week?.totalCost ?? null;

  const activeAgentCount = useMemo(
    () => features.filter(hasActiveAgentSignal).length,
    [features],
  );

  const bucketedFeatures = useMemo<BucketedFeature[]>(
    () => features.map(feature => {
      const reviewStatus = reviewStatusForFeature(feature, reviewStatusByIssueId);
      return {
        feature,
        reviewStatus,
        phase: bucketFeaturePhase(feature, reviewStatus),
      };
    }),
    [features, reviewStatusByIssueId],
  );

  const bucketedByPhase = useMemo(() => {
    const byPhase = new Map<PipelineIssuePhase, BucketedFeature[]>();
    for (const phase of PIPELINE_PHASES) byPhase.set(phase, []);
    for (const entry of bucketedFeatures) byPhase.get(entry.phase)?.push(entry);
    return byPhase;
  }, [bucketedFeatures]);

  const metrics = useMemo<HeroMetric[]>(() => {
    const readyToShip = bucketedFeatures.filter(({ phase }) => phase === 'ship').length;
    const stuck = bucketedFeatures.filter((e) => isBlockedFeature(e.feature, e.reviewStatus)).length;

    return [
      { label: 'Active issues', value: features.length, sub: 'in pipeline', tone: 'info' },
      { label: 'Stuck', value: stuck, sub: stuck > 0 ? 'need attention' : 'all clear', tone: stuck > 0 ? 'destructive' : 'muted' },
      { label: 'Agents', value: activeAgentCount, sub: 'running now', tone: 'success' },
      { label: 'Ship-ready', value: readyToShip, sub: 'awaiting merge', tone: 'success' },
      recentSpend != null
        ? { label: 'Spend', value: formatCost(recentSpend), sub: 'last 7 days', tone: 'cost' }
        : { label: 'Spend', value: formatCost(totalCost), sub: 'project total', tone: 'cost' },
    ];
  }, [activeAgentCount, bucketedFeatures, features.length, totalCost, recentSpend]);

  return (
    <section
      aria-label={`${projectName} project overview`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        overflow: 'auto',
      }}
    >
      <HeroBillboard projectName={projectName} metrics={metrics} />

      {projectKey && <ProjectSettingsSection projectKey={projectKey} />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PIPELINE_PHASES.map(phase => {
          const entries = bucketedByPhase.get(phase) ?? [];
          if (entries.length === 0) return null;
          return (
            <PipelineSection
              key={phase}
              phase={phase}
              entries={entries}
              issueCosts={issueCosts}
              issueCostDetails={issueCostDetails}
              onSelectFeature={onSelectFeature}
            />
          );
        })}
      </div>
    </section>
  );
}

type HeroTone = 'info' | 'success' | 'warning' | 'destructive' | 'cost' | 'muted';
interface HeroMetric { label: string; value: ReactNode; sub?: string; tone: HeroTone }
const HERO_TONE_COLOR: Record<HeroTone, string> = {
  info: 'var(--info-foreground)',
  success: 'var(--success-foreground)',
  warning: 'var(--warning-foreground)',
  destructive: 'var(--destructive-foreground)',
  cost: 'var(--signal-cost-foreground)',
  muted: 'var(--foreground)',
};

function HeroBillboard({ projectName, metrics }: { projectName: string; metrics: HeroMetric[] }) {
  // Tight, container-responsive glance row. No outer card and an auto-fill grid
  // (min 132px tiles) so it lays out by the PANE width — tiles never crush to
  // ~100px and truncate their labels the way the fixed 5-column MetricStrip did
  // in the narrow cockpit pane. (PAN-1591 project-cockpit refinement.)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="flex items-baseline gap-2">
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--foreground)' }}>{projectName}</h2>
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>pipeline overview</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8 }}>
        {metrics.map((m) => (
          <div
            key={m.label}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '8px 11px',
              background: 'color-mix(in srgb, white 1.5%, transparent)',
            }}
          >
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>{m.label}</div>
            <div style={{ marginTop: 2, fontSize: 18, fontWeight: 600, fontFamily: '"SF Mono", Consolas, monospace', fontVariantNumeric: 'tabular-nums', color: HERO_TONE_COLOR[m.tone] }}>{m.value}</div>
            {m.sub && <div style={{ marginTop: 1, fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineSection({
  phase,
  entries,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
}: {
  phase: PipelineIssuePhase;
  entries: BucketedFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown> | undefined;
  onSelectFeature: (feature: ProjectFeature) => void;
}) {
  return (
    <section
      aria-label={`${phase} pipeline phase`}
      data-component="command-deck-pipeline-phase"
      data-phase={phase}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 14,
        background: 'var(--card)',
      }}
    >
      <PhaseHeader phase={phase} count={entries.length} variant="command-deck" className="static" />

      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {entries.map(entry => (
          <ProjectIssueRow
            key={entry.feature.issueId}
            entry={entry}
            issueCosts={issueCosts}
            issueCostDetails={issueCostDetails}
            onSelectFeature={onSelectFeature}
            reason={subStatus(entry)}
          />
        ))}
      </div>
    </section>
  );
}

function verbBadgePropsForPhase(entry: BucketedFeature): { variant: Exclude<VerbBadgeVariant, 'STUCK · Nh'> } | { variant: 'STUCK · Nh'; hours: number } {
  if (isBlockedFeature(entry.feature, entry.reviewStatus)) return { variant: 'CHANGES REQUESTED' };
  if (entry.phase === 'ship' && (entry.reviewStatus?.readyForMerge || entry.feature.readyForMerge)) return { variant: 'READY TO MERGE' };
  if (entry.phase === 'ship') return { variant: 'SHIP RUNNING' };
  if (entry.phase === 'review') return { variant: 'REVIEW RUNNING' };
  if (entry.phase === 'work') return { variant: 'WORK RUNNING' };
  if (entry.phase === 'plan') return { variant: 'PLANNING' };
  return { variant: 'QUEUED FOR PLAN' };
}

function priorityForFeature(feature: ProjectFeature): IssueRowPriority {
  if (feature.readyForMerge) return 'high';
  if (feature.agentStatus === 'failed') return 'urgent';
  if (hasActiveAgentSignal(feature)) return 'high';
  return 'medium';
}

function agentForFeature(feature: ProjectFeature): { name: string; sub: string } | null {
  const active = feature.sessions?.find(session => session.presence === 'active') ?? feature.sessions?.[0];
  if (active?.sessionId) {
    return { name: active.sessionId, sub: [active.type, active.status].filter(Boolean).join(' · ') };
  }
  if (feature.agentStatus) return { name: feature.agentStatus, sub: feature.stateLabel };
  return null;
}

function ProjectIssueRow({
  entry,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  reason,
}: {
  entry: BucketedFeature;
  issueCosts: Record<string, number>;
  issueCostDetails: Record<string, IssueCostBreakdown> | undefined;
  onSelectFeature: (feature: ProjectFeature) => void;
  reason?: string;
}) {
  const cost = issueCosts[entry.feature.issueId];
  const costDetails = issueCostDetails?.[entry.feature.issueId];
  const agent = agentForFeature(entry.feature);

  return (
    <IssueRow
      issueId={entry.feature.issueId}
      phase={entry.phase}
      priority={priorityForFeature(entry.feature)}
      title={entry.feature.title}
      project={{ name: entry.feature.projectName }}
      labels={reason ? [<StatusPill key="reason">{reason}</StatusPill>] : []}
      verbBadge={<VerbBadge {...verbBadgePropsForPhase(entry)} />}
      agent={agent ? { name: agent.name, sub: agent.sub } : undefined}
      ledger={cost !== undefined ? { cost: <CostBadge cost={cost} details={costDetails} /> } : undefined}
      variant="command-deck"
      onOpen={() => onSelectFeature(entry.feature)}
    />
  );
}

function CostBadge({ cost, details }: { cost: number; details?: IssueCostBreakdown }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const hasDetails = Boolean(details);

  return (
    <span
      tabIndex={hasDetails ? 0 : undefined}
      onMouseEnter={() => hasDetails && setPopoverOpen(true)}
      onMouseLeave={() => hasDetails && setPopoverOpen(false)}
      onFocus={() => hasDetails && setPopoverOpen(true)}
      onBlur={() => hasDetails && setPopoverOpen(false)}
      style={{
        position: 'relative',
        borderRadius: '999px',
        padding: '2px 6px',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--success)',
        background: 'color-mix(in srgb, var(--success) 12%, transparent)',
        whiteSpace: 'nowrap',
      }}
    >
      {formatCost(cost)}
      {details && popoverOpen && <CostBreakdownPopover details={details} />}
    </span>
  );
}

function CostBreakdownPopover({ details }: { details: IssueCostBreakdown }) {
  const modelRows = sortedCostRows(details.byModel).map(([model, row]) => ({
    key: model,
    label: friendlyModelName(model),
    cost: row.cost,
  }));
  const stageRows = sortedCostRows(details.byStage).map(([stage, row]) => ({
    key: stage,
    label: friendlyStageName(stage),
    cost: row.cost,
  }));

  return (
    <span
      role="tooltip"
      style={{
        position: 'absolute',
        right: 0,
        top: 'calc(100% + 6px)',
        zIndex: 30,
        width: 240,
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 10,
        background: 'var(--popover)',
        color: 'var(--popover-foreground)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <CostBreakdownSection title="Models" rows={modelRows} />
      <CostBreakdownSection title="Stages" rows={stageRows} />
    </span>
  );
}

function CostBreakdownSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; cost: number }>;
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </span>
      {rows.length > 0 ? rows.map(row => (
        <span
          key={row.key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: 11,
            color: 'var(--popover-foreground)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.label}</span>
          <span style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
            {formatCost(row.cost)}
          </span>
        </span>
      )) : (
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>No cost data</span>
      )}
    </span>
  );
}

function sortedCostRows(rows: Record<string, { cost: number; tokens: number }> | undefined) {
  return Object.entries(rows ?? {}).sort(([, a], [, b]) => b.cost - a.cost);
}

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return '$0';
}

function friendlyModelName(model: string): string {
  return model
    .replace('claude-', '')
    .replace(/-20\d{6}$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function friendlyStageName(stage: string): string {
  const labels: Record<string, string> = {
    planning: 'Planning',
    implementation: 'Implementation',
    review: 'Review',
    test: 'Testing',
    testing: 'Testing',
    merge: 'Merge',
    interactive: 'Interactive',
    other: 'Other',
    unknown: 'Other',
  };
  return labels[stage] ?? stage.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        borderRadius: '999px',
        padding: '2px 7px',
        fontSize: 11,
        color: 'var(--muted-foreground)',
        background: 'var(--muted)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </span>
  );
}

function stuckReason(reviewStatus: ReviewStatusSnapshot | undefined): string {
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

function subStatus(entry: BucketedFeature): string | undefined {
  const { reviewStatus, phase } = entry;

  if (isBlockedFeature(entry.feature, reviewStatus)) {
    return stuckReason(reviewStatus);
  }

  if (phase === 'review' && reviewStatus?.reviewSubStatuses) {
    return Object.entries(reviewStatus.reviewSubStatuses)
      .map(([role, status]) => `${role}: ${status}`)
      .join(', ');
  }

  if (phase === 'ship' && reviewStatus?.mergeStep) {
    return reviewStatus.mergeStep;
  }

  if (phase === 'review' && reviewStatus?.verificationCycleCount && reviewStatus.verificationCycleCount > 1) {
    return `Cycle ${reviewStatus.verificationCycleCount}`;
  }

  return undefined;
}
