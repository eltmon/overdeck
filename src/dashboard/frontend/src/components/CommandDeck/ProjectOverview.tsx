import { useMemo, useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewStatusSnapshot } from '@overdeck/contracts';
import { useDashboardStore } from '../../lib/store';
import { getPipelineIssuePhase, type PipelineIssuePhase } from '../../lib/pipeline-state';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { Agent, Issue, CanonicalState } from '../../types';
import {
  type BucketedFeature,
  type IssueCostBreakdown,
  hasActiveAgentSignal,
  hasWorkSession,
  isBlockedFeature,
} from './pipeline-helpers';
import { PipelineSection } from './PipelineSection';

export type { IssueCostBreakdown };

interface ProjectOverviewProps {
  projectName: string;
  /** projects.yaml key for this project — enables the settings panel (PAN-1693). */
  projectKey?: string;
  features: ProjectFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature: (feature: ProjectFeature) => void;
  onOpenCosts?: () => void;
  onOpenAgents?: () => void;
}

interface ProjectCiHealth {
  failingChecks: number;
  mergeBlocked: number;
  shipReadyClear: number;
  workRunning: number;
  errors: ProjectCiError[];
  hiddenErrorCount: number;
}

interface ProjectCiError {
  issueId: string;
  title: string;
  label: string;
  summary: string;
  details?: string;
  tone: 'bad' | 'warn';
}

type PipelineClassifierIssue = Pick<Issue, 'state' | 'status' | 'stateType' | 'hasPlan' | 'planningComplete' | 'mergeStatus' | 'labels'>;
type PipelineClassifierAgent = Pick<Agent, 'role' | 'status' | 'hasPendingQuestion' | 'pendingQuestionCount' | 'pendingQuestionPrompt'>;

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
    labels: [],
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

function hasBlockerType(reviewStatus: ReviewStatusSnapshot | undefined, types: Set<string>): boolean {
  return (reviewStatus?.blockerReasons ?? []).some((reason) => types.has(reason.type));
}

const CI_BLOCKER_TYPES = new Set(['failing_checks']);
const MERGEABILITY_BLOCKER_TYPES = new Set(['merge_conflict', 'not_mergeable', 'draft_pr']);
const PROJECT_CI_ERROR_LIMIT = 4;

function isCiBlocked(reviewStatus: ReviewStatusSnapshot | undefined): boolean {
  return Boolean(
    hasBlockerType(reviewStatus, CI_BLOCKER_TYPES) ||
      TEST_BLOCKED_STATUSES.has(reviewStatus?.testStatus ?? '') ||
      VERIFICATION_BLOCKED_STATUSES.has(reviewStatus?.verificationStatus ?? ''),
  );
}

function isMergeabilityBlocked(reviewStatus: ReviewStatusSnapshot | undefined): boolean {
  return Boolean(
    hasBlockerType(reviewStatus, MERGEABILITY_BLOCKER_TYPES) ||
      MERGE_BLOCKED_STATUSES.has(reviewStatus?.mergeStatus ?? ''),
  );
}

function ciErrorLabel(type: string): string {
  switch (type) {
    case 'failing_checks': return 'Checks';
    case 'merge_conflict': return 'Merge conflict';
    case 'not_mergeable': return 'Not mergeable';
    case 'draft_pr': return 'Draft PR';
    case 'test_status': return 'Test gate';
    case 'verification_status': return 'Verification';
    case 'merge_status': return 'Merge';
    default: return 'Blocker';
  }
}

function ciErrorsForEntry({ feature, reviewStatus }: BucketedFeature): ProjectCiError[] {
  const errors: ProjectCiError[] = [];
  for (const reason of reviewStatus?.blockerReasons ?? []) {
    if (!CI_BLOCKER_TYPES.has(reason.type) && !MERGEABILITY_BLOCKER_TYPES.has(reason.type)) continue;
    errors.push({
      issueId: feature.issueId,
      title: feature.title,
      label: ciErrorLabel(reason.type),
      summary: reason.summary,
      details: reason.details,
      tone: CI_BLOCKER_TYPES.has(reason.type) ? 'bad' : 'warn',
    });
  }
  if (errors.length > 0) return errors;

  if (TEST_BLOCKED_STATUSES.has(reviewStatus?.testStatus ?? '')) {
    errors.push({
      issueId: feature.issueId,
      title: feature.title,
      label: ciErrorLabel('test_status'),
      summary: reviewStatus?.testStatus === 'dispatch_failed' ? 'Test dispatch failed' : 'Test failed',
      tone: 'bad',
    });
  }
  if (VERIFICATION_BLOCKED_STATUSES.has(reviewStatus?.verificationStatus ?? '')) {
    errors.push({
      issueId: feature.issueId,
      title: feature.title,
      label: ciErrorLabel('verification_status'),
      summary: 'Verification failed',
      details: reviewStatus?.verificationNotes,
      tone: 'bad',
    });
  }
  if (MERGE_BLOCKED_STATUSES.has(reviewStatus?.mergeStatus ?? '')) {
    errors.push({
      issueId: feature.issueId,
      title: feature.title,
      label: ciErrorLabel('merge_status'),
      summary: 'Merge failed',
      details: reviewStatus?.mergeNotes,
      tone: 'warn',
    });
  }
  return errors;
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

/** PAN-1693/1695: per-project settings in the cockpit — currently the auto-merge default. */
function ProjectSettingsSection({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['project-auto-merge-default', projectKey],
    queryFn: async (): Promise<{ value: 'auto' | 'hold' | null }> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/auto-merge-default`);
      if (!res.ok) return { value: null };
      return res.json();
    },
    enabled: !!projectKey,
  });
  const value = data?.value ?? null;
  const { data: swarmData } = useQuery({ queryKey: ['project-swarm-policy', projectKey], queryFn: async () => (await fetch(`/api/projects/${encodeURIComponent(projectKey)}/swarm-policy`)).json() as Promise<{ configured: { mode?: 'off' | 'auto' | 'always' } | null }> });
  const swarmMutation = useMutation({ mutationFn: async (mode: 'off' | 'auto' | 'always' | null) => { const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/swarm-policy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: mode ? { mode } : null }) }); if (!res.ok) throw new Error('Failed to save swarm policy'); }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-swarm-policy', projectKey] }) });
  const mutation = useMutation({
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
  const options: Array<{ v: 'auto' | 'hold' | null; label: string; color: string }> = [
    { v: 'auto', label: '⚡ Auto', color: 'var(--success)' },
    { v: 'hold', label: '🔒 Hold for UAT', color: 'var(--warning)' },
    { v: null, label: 'Global default', color: 'var(--muted-foreground)' },
  ];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)' }}>Project settings</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--foreground)' }}>Auto-merge default</span>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {options.map((o, i) => {
            const active = value === o.v;
            return (
              <button
                key={String(o.v)}
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(o.v)}
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
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
        Applies to this project's issues that have no explicit per-issue auto-merge setting.
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-3"><span className="text-[13px] text-foreground">Automatic swarming</span><select aria-label="Project swarm policy" className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" value={swarmData?.configured?.mode ?? ''} onChange={e => swarmMutation.mutate((e.target.value || null) as any)}><option value="">Inherit global</option><option value="off">Off</option><option value="auto">Auto</option><option value="always">Always</option></select><span className="text-[11px] text-muted-foreground">Future dispatches only</span></div>
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
  onOpenCosts,
  onOpenAgents,
}: ProjectOverviewProps) {
  const reviewStatusByIssueId = useDashboardStore(state => state.reviewStatusByIssueId);
  const pipelineRef = useRef<HTMLDivElement>(null);

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

  const ciHealth = useMemo<ProjectCiHealth>(() => {
    const failingChecks = bucketedFeatures.filter(({ reviewStatus }) => isCiBlocked(reviewStatus)).length;
    const mergeBlocked = bucketedFeatures.filter(({ reviewStatus }) => isMergeabilityBlocked(reviewStatus)).length;
    const shipReadyClear = bucketedFeatures.filter(({ feature, phase, reviewStatus }) =>
      phase === 'ship' && (feature.readyForMerge || reviewStatus?.readyForMerge) && !isBlockedFeature(feature, reviewStatus),
    ).length;
    const workRunning = bucketedFeatures.filter(({ feature }) => hasActiveAgentSignal(feature)).length;
    const allErrors = bucketedFeatures.flatMap(ciErrorsForEntry);
    return {
      failingChecks,
      mergeBlocked,
      shipReadyClear,
      workRunning,
      errors: allErrors.slice(0, PROJECT_CI_ERROR_LIMIT),
      hiddenErrorCount: Math.max(0, allErrors.length - PROJECT_CI_ERROR_LIMIT),
    };
  }, [bucketedFeatures]);

  const metrics = useMemo<HeroMetric[]>(() => {
    const readyToShip = bucketedFeatures.filter(({ phase }) => phase === 'ship').length;
    const stuck = bucketedFeatures.filter((e) => isBlockedFeature(e.feature, e.reviewStatus)).length;

    return [
      { label: 'Active issues', value: features.length, sub: 'in pipeline', tone: 'info', onClick: () => pipelineRef.current?.scrollIntoView({ behavior: 'smooth' }) },
      { label: 'Stuck', value: stuck, sub: stuck > 0 ? 'need attention' : 'all clear', tone: stuck > 0 ? 'destructive' : 'muted' },
      { label: 'Agents', value: activeAgentCount, sub: 'running now', tone: 'success', onClick: onOpenAgents },
      { label: 'Ship-ready', value: readyToShip, sub: 'awaiting merge', tone: 'success' },
      recentSpend != null
        ? { label: 'Spend', value: formatCost(recentSpend), sub: 'last 7 days', tone: 'cost', onClick: onOpenCosts }
        : { label: 'Spend', value: formatCost(totalCost), sub: 'project total', tone: 'cost', onClick: onOpenCosts },
    ];
  }, [activeAgentCount, bucketedFeatures, features.length, totalCost, recentSpend, onOpenCosts, onOpenAgents]);

  return (
    <section
      aria-label={`${projectName} project overview`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        overflow: 'auto',
      }}
    >
      <HeroBillboard projectName={projectName} metrics={metrics} />

      <ProjectCiHealthSection health={ciHealth} />

      {projectKey && (
        <ProjectDisclosure
          title="Project settings"
          summary="Auto-merge default and project-level merge policy"
          badges={['collapsed']}
        >
          <ProjectSettingsSection projectKey={projectKey} />
        </ProjectDisclosure>
      )}

      <div ref={pipelineRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PipelineSection
          entries={bucketedFeatures}
          issueCosts={issueCosts}
          issueCostDetails={issueCostDetails}
          onSelectFeature={onSelectFeature}
        />
      </div>
    </section>
  );
}

function ProjectCiHealthSection({ health }: { health: ProjectCiHealth }) {
  const needsAttention = health.failingChecks > 0 || health.mergeBlocked > 0;
  const statusLabel = needsAttention ? 'Needs attention' : 'Clear';
  return (
    <section
      aria-label="Current CI health"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '999px',
                background: needsAttention ? 'var(--warning)' : 'var(--success)',
                flex: '0 0 auto',
              }}
            />
            Current CI health
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: 'var(--muted-foreground)' }}>
            {health.failingChecks} failing checks · {health.mergeBlocked} merge blocked · {health.shipReadyClear} ship-ready clear
          </div>
        </div>
        <span
          style={{
            flex: '0 0 auto',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '4px 9px',
            fontSize: 12,
            fontWeight: 700,
            color: needsAttention ? 'var(--warning)' : 'var(--success)',
            background: needsAttention
              ? 'color-mix(in srgb, var(--warning) 12%, transparent)'
              : 'color-mix(in srgb, var(--success) 12%, transparent)',
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, borderTop: '1px solid var(--border)', padding: 10, background: 'var(--background)' }}>
        <HealthTile label="Required checks" value={`${health.failingChecks} failing`} tone={health.failingChecks > 0 ? 'bad' : 'good'} />
        <HealthTile label="Mergeability" value={`${health.mergeBlocked} blocked`} tone={health.mergeBlocked > 0 ? 'warn' : 'good'} />
        <HealthTile label="Ship-ready" value={`${health.shipReadyClear} clear`} tone="good" />
        <HealthTile label="Work agents" value={`${health.workRunning} running`} tone={health.workRunning > 0 ? 'good' : 'neutral'} />
      </div>
      {health.errors.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '9px 12px 11px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--foreground)' }}>Blocking details</div>
          {health.errors.map((error) => (
            <div
              key={`${error.issueId}-${error.label}-${error.summary}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '8px minmax(0, 1fr)',
                gap: 8,
                alignItems: 'start',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  marginTop: 5,
                  borderRadius: 999,
                  background: error.tone === 'bad' ? 'var(--destructive)' : 'var(--warning)',
                }}
              />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 7 }}>
                  <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 750, color: 'var(--foreground)' }}>Issue {error.issueId}</span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 650, color: 'var(--muted-foreground)' }}>{error.label}</span>
                </div>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--foreground)' }} title={error.summary}>
                  Problem: {error.summary}
                </div>
                {error.details && (
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: 'var(--muted-foreground)' }} title={error.details}>
                    {error.details}
                  </div>
                )}
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, color: 'var(--muted-foreground)' }} title={error.title}>
                  Feature: {error.title}
                </div>
              </div>
            </div>
          ))}
          {health.hiddenErrorCount > 0 && (
            <div style={{ paddingLeft: 16, fontSize: 10, color: 'var(--muted-foreground)' }}>
              +{health.hiddenErrorCount} more blocker{health.hiddenErrorCount === 1 ? '' : 's'}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HealthTile({ label, value, tone }: { label: string; value: string; tone: 'bad' | 'warn' | 'good' | 'neutral' }) {
  const color = tone === 'bad'
    ? 'var(--destructive)'
    : tone === 'warn'
      ? 'var(--warning)'
      : tone === 'good'
        ? 'var(--success)'
        : 'var(--foreground)';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 8px', background: 'var(--card)' }}>
      <div style={{ fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ProjectDisclosure({
  title,
  summary,
  badges,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  badges?: string[];
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 10,
          padding: '11px 12px',
          listStyle: 'none',
        }}
      >
        <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{title}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted-foreground)' }}>{summary}</span>
        </span>
        {badges && badges.length > 0 && (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {badges.map((badge) => (
              <span
                key={badge}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '2px 7px',
                  background: 'var(--secondary)',
                  color: 'var(--foreground)',
                  fontSize: 11,
                  fontWeight: 650,
                  whiteSpace: 'nowrap',
                }}
              >
                {badge}
              </span>
            ))}
          </span>
        )}
      </summary>
      <div style={{ borderTop: '1px solid var(--border)', padding: 12, background: 'var(--background)' }}>
        {children}
      </div>
    </details>
  );
}

type HeroTone = 'info' | 'success' | 'warning' | 'destructive' | 'cost' | 'muted';
interface HeroMetric { label: string; value: ReactNode; sub?: string; tone: HeroTone; onClick?: () => void; }
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
        {metrics.map((m) => {
          const clickable = Boolean(m.onClick);
          return (
            <div
              key={m.label}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={m.onClick}
              className={clickable ? 'cursor-pointer transition-colors hover:bg-accent/60' : undefined}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '7px 9px',
                background: 'color-mix(in srgb, white 1.5%, transparent)',
              }}
            >
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground)' }}>{m.label}</div>
              <div style={{ marginTop: 2, fontSize: 17, fontWeight: 600, fontFamily: '"SF Mono", Consolas, monospace', fontVariantNumeric: 'tabular-nums', color: HERO_TONE_COLOR[m.tone] }}>{m.value}</div>
              {m.sub && <div style={{ marginTop: 1, fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.sub}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TEST_BLOCKED_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_BLOCKED_STATUSES = new Set(['failed']);
const VERIFICATION_BLOCKED_STATUSES = new Set(['failed']);

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return '$0';
}
