import { useMemo, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDashboardStore } from '../../lib/store';
import { PHASE_BY_DERIVED_STATE, type PipelineIssuePhase } from '../../lib/pipeline-state';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { CanonicalState, DerivedIssueState } from '../../types';
import {
  type BucketedFeature,
  type IssueCostBreakdown,
  hasActiveAgentSignal,
  hasWorkSession,
  isBlockedFeature,
} from './pipeline-helpers';
import { PipelineSection } from './PipelineSection';
import { ProjectSettingsDisclosure } from './ProjectSettingsDisclosure';

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
  /** PAN-3330 FR-6c: open the New Workspace dialog with this project preselected. */
  onNewWorkspace?: (projectKey: string) => void;
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

function derivedForFeature(
  feature: ProjectFeature,
  derivedByIssueId: Record<string, DerivedIssueState>,
) {
  return derivedByIssueId[feature.issueId] ??
    derivedByIssueId[feature.issueId.toUpperCase()] ??
    derivedByIssueId[feature.issueId.toLowerCase()];
}

const PROJECT_CI_ERROR_LIMIT = 4;

/** The forge says the pull request's checks are failing. */
function isCiBlocked(derived: DerivedIssueState | undefined): boolean {
  return derived?.pr?.checks === 'red';
}

/** The forge says the pull request cannot merge (conflict or draft). */
function isMergeabilityBlocked(derived: DerivedIssueState | undefined): boolean {
  return derived?.pr !== undefined && derived.pr.mergeable === false;
}

function ciErrorsForEntry({ feature, derived }: BucketedFeature): ProjectCiError[] {
  const errors: ProjectCiError[] = [];
  if (isCiBlocked(derived)) {
    errors.push({
      issueId: feature.issueId,
      title: feature.title,
      label: 'Checks',
      summary: `Checks failing on PR #${derived?.pr?.number ?? '—'}`,
      tone: 'bad',
    });
  }
  if (isMergeabilityBlocked(derived)) {
    errors.push({
      issueId: feature.issueId,
      title: feature.title,
      label: 'Not mergeable',
      summary: 'The pull request conflicts with main',
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

export function ProjectOverview({
  projectName,
  projectKey,
  features,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  onOpenCosts,
  onOpenAgents,
  onNewWorkspace,
}: ProjectOverviewProps) {
  const openNewWorkspace = onNewWorkspace ?? ((key: string) => { window.history.pushState({ tab: 'workspace-new' }, '', `/workspaces/new?project=${encodeURIComponent(key)}`); window.dispatchEvent(new PopStateEvent('popstate')); });
  const derivedByIssueId = useDashboardStore(state => state.derivedIssueStateByIssueId);
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
      const derived = derivedForFeature(feature, derivedByIssueId);
      return {
        feature,
        derived,
        phase: bucketFeaturePhase(feature, derived),
      };
    }),
    [features, derivedByIssueId],
  );

  const ciHealth = useMemo<ProjectCiHealth>(() => {
    const failingChecks = bucketedFeatures.filter(({ derived }) => isCiBlocked(derived)).length;
    const mergeBlocked = bucketedFeatures.filter(({ derived }) => isMergeabilityBlocked(derived)).length;
    const shipReadyClear = bucketedFeatures.filter(({ feature, derived }) =>
      derived?.state === 'ready' && !isBlockedFeature(feature, derived),
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
    const stuck = bucketedFeatures.filter((e) => isBlockedFeature(e.feature, e.derived)).length;

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
      <HeroBillboard metrics={metrics} />

      <ProjectCiHealthSection health={ciHealth} />

      {projectKey && (
        <div style={{ display: 'flex' }}>
          <button
            data-testid="project-overview-new-workspace"
            onClick={() => openNewWorkspace(projectKey)}
            title={`New workspace in ${projectName}`}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 2,
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: 12,
              color: 'var(--muted-foreground)',
            }}
          >
            New workspace
          </button>
        </div>
      )}

      {projectKey && <ProjectSettingsDisclosure projectKey={projectKey} />}

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

function HeroBillboard({ metrics }: { metrics: HeroMetric[] }) {
  // Tight, container-responsive glance row. No outer card and an auto-fill grid
  // (min 132px tiles) so it lays out by the PANE width — tiles never crush to
  // ~100px and truncate their labels the way the fixed 5-column MetricStrip did
  // in the narrow cockpit pane. (PAN-1591 project-cockpit refinement.)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* The project name and its rename pencil live on the `# <project>` title
          (PAN-3156); this card keeps only its own label. */}
      <div className="flex items-baseline gap-2">
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
              <div style={{ marginTop: 2, fontSize: 17, fontWeight: 600, fontFamily: 'var(--font-mono), "SF Mono", Consolas, monospace', fontVariantNumeric: 'tabular-nums', color: HERO_TONE_COLOR[m.tone] }}>{m.value}</div>
              {m.sub && <div style={{ marginTop: 1, fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.sub}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatCost(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return '$0';
}
