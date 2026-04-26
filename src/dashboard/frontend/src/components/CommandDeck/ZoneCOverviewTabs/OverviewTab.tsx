/**
 * OverviewTab — the killer issue-selected default view.
 *
 * Stacks (from top):
 *   1. Status billboard       (stage + cost + acceptance progress + last activity)
 *   2. Reviewer summary       (5-col grid, only when review sessions exist)
 *   3. Test summary           (placeholder until verification gate exposes results)
 *   4. PR summary             (placeholder — endpoint lands in pan-9yn5)
 *   5. Cost breakdown sparkline
 *   6. Recent activity feed   (issue-scoped, capped at 20 events)
 *   7. Quick links            (chips that switch tabs)
 *
 * This component keeps the data dependencies tight: planning + activity + costs
 * are shared via {usePlanningQuery, useActivityQuery, useIssueCostsQuery} so
 * sibling tabs reuse the cached responses.
 */

import { useMemo } from 'react';
import { LiveCounter } from '../LiveCounter';
import { ActivitySparkline } from '../ActivitySparkline';
import { RoundCard, type RoundData, type RoundVerdict } from '../RoundCard';
import {
  useActivityQuery,
  useIssueCostsQuery,
  usePlanningQuery,
  type ActivitySection,
  type ReviewerRoundMetadata,
} from './queries';
import type { OverviewTab as OverviewTabKey } from '../ZoneCOverview';

interface OverviewTabProps {
  issueId: string;
  onSwitchTab?: (tab: OverviewTabKey) => void;
}

const REVIEWER_ROLES: readonly string[] = [
  'correctness',
  'security',
  'performance',
  'requirements',
  'synthesis',
];

function ReviewerRoleLabel({ role }: { role: string }) {
  return (
    <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: 12 }}>
      {role}
    </span>
  );
}

function findLatestRoundData(
  metadata: ReviewerRoundMetadata | undefined,
): RoundData | null {
  if (!metadata || metadata.roundCount === 0) return null;
  const latest = metadata.history.find((r) => r.round === metadata.latestRound);
  if (!latest) return null;
  let verdict: RoundVerdict;
  switch (latest.status) {
    case 'passed':
    case 'approved':
      verdict = 'passed';
      break;
    case 'failed':
    case 'blocked':
      verdict = 'failed';
      break;
    case 'running':
    case 'active':
      verdict = 'running';
      break;
    default:
      verdict = 'pending';
  }
  return {
    round: latest.round,
    verdict,
    findings: latest.findings,
    duration: latest.durationSec ?? null,
    cost: latest.cost ?? null,
  };
}

function lastActivityLabel(sections: readonly ActivitySection[]): string {
  let latest = 0;
  for (const s of sections) {
    const t = Date.parse(s.startedAt);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  if (!latest) return 'no activity yet';
  const ageMs = Date.now() - latest;
  if (ageMs < 60_000) return `last activity ${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `last activity ${Math.round(ageMs / 60_000)}m ago`;
  return `last activity ${Math.round(ageMs / 3_600_000)}h ago`;
}

function deriveStageFromSections(sections: readonly ActivitySection[]): string {
  const active = [...sections].reverse().find((s) => s.status === 'active' || s.status === 'running');
  const target = active ?? sections[sections.length - 1];
  if (!target) return 'idle';
  if (target.role) return target.role;
  return target.type;
}

function Section({
  title,
  children,
  rightSlot,
}: {
  title: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--card)',
        border: '1px solid var(--mc-border, var(--border))',
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--mc-text-muted, var(--muted-foreground))',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        <span>{title}</span>
        {rightSlot}
      </header>
      {children}
    </section>
  );
}

export function OverviewTab({ issueId, onSwitchTab }: OverviewTabProps) {
  const planning = usePlanningQuery(issueId);
  const activity = useActivityQuery(issueId);
  const costs = useIssueCostsQuery(issueId);

  const sections = activity.data?.sections ?? [];
  const stage = deriveStageFromSections(sections);
  const totalCost = costs.data?.totalCost ?? activity.data?.totalCost ?? 0;
  const lastLabel = lastActivityLabel(sections);

  const sparklineEvents = useMemo(
    () =>
      sections
        .map((s) => ({
          ts: Date.parse(s.startedAt),
          category: (
            {
              planning: 'info' as const,
              work: 'info' as const,
              review: 'review' as const,
              reviewer: 'review' as const,
              test: 'success' as const,
              merge: 'success' as const,
              legacy: 'warning' as const,
            } as const
          )[s.type as string] ?? 'info',
        }))
        .filter((e) => !Number.isNaN(e.ts))
        .map((e) => ({ timestamp: e.ts, category: e.category })),
    [sections],
  );

  const reviewerSections = useMemo(
    () => sections.filter((s) => s.type === 'review'),
    [sections],
  );

  const recentEvents = useMemo(() => sections.slice(-20).reverse(), [sections]);

  return (
    <div
      data-testid="overview-tab"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {/* 1. Status billboard */}
      <section
        data-testid="overview-billboard"
        style={{
          minHeight: 96,
          padding: 16,
          borderRadius: 10,
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--primary) 8%, transparent), transparent)',
          border: '1px solid var(--mc-border, var(--border))',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }} data-testid="overview-stage">
              {stage}
            </span>
            <span style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
              · {issueId}
            </span>
          </div>
          <div
            data-testid="overview-cost"
            style={{ fontSize: 14, fontWeight: 600 }}
          >
            <LiveCounter value={totalCost} unit="$" precision={2} pulseOnIncrement />
            <span
              style={{
                marginLeft: 8,
                fontSize: 12,
                color: 'var(--mc-text-muted, var(--muted-foreground))',
                fontWeight: 500,
              }}
            >
              spent
            </span>
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--mc-text-muted, var(--muted-foreground))',
            display: 'flex',
            gap: 12,
          }}
        >
          <span data-testid="overview-last-activity">{lastLabel}</span>
          <span>· {sections.length} session{sections.length === 1 ? '' : 's'}</span>
        </div>
      </section>

      {/* 2. Reviewer summary */}
      {reviewerSections.length > 0 && (
        <Section title="Reviewer summary">
          <div
            data-testid="overview-reviewer-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            {REVIEWER_ROLES.map((role) => {
              const sec = reviewerSections.find((s) => s.role === role);
              const data = findLatestRoundData(sec?.roundMetadata);
              return (
                <div
                  key={role}
                  data-testid={`overview-reviewer-${role}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <ReviewerRoleLabel role={role} />
                  {data ? (
                    <RoundCard round={data} />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px dashed var(--mc-border, var(--border))',
                        fontSize: 11,
                        color: 'var(--mc-text-muted, var(--muted-foreground))',
                      }}
                    >
                      no rounds yet
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 3. Test summary (placeholder — fed by verification gate later) */}
      <Section title="Tests">
        <div
          data-testid="overview-tests"
          style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
        >
          Verification gate output isn't surfaced yet. Run results land alongside
          the verification gate in a follow-up.
        </div>
      </Section>

      {/* 4. PR summary (placeholder — endpoint in pan-9yn5) */}
      <Section title="Pull request">
        <div
          data-testid="overview-pr"
          style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
        >
          PR metadata not wired in this iteration — see PR / Diff tab once the
          backend endpoint lands.
        </div>
      </Section>

      {/* 5. Cost sparkline */}
      <Section
        title="Activity over the last hour"
        rightSlot={
          <button
            type="button"
            data-testid="overview-sparkline-link-costs"
            onClick={() => onSwitchTab?.('costs')}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid var(--mc-border, var(--border))',
              background: 'transparent',
              color: 'var(--mc-text-muted, var(--muted-foreground))',
              cursor: 'pointer',
            }}
          >
            View costs ↗
          </button>
        }
      >
        <div
          data-testid="overview-sparkline"
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <ActivitySparkline events={sparklineEvents} />
          <span style={{ fontSize: 11, color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
            {sparklineEvents.length} session start{sparklineEvents.length === 1 ? '' : 's'}
          </span>
        </div>
      </Section>

      {/* 6. Recent activity */}
      <Section title="Recent activity">
        {recentEvents.length === 0 ? (
          <div
            data-testid="overview-activity-empty"
            style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
          >
            No activity yet — sessions will appear here as they start.
          </div>
        ) : (
          <ul
            data-testid="overview-activity-list"
            style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            {recentEvents.map((s) => (
              <li
                key={s.sessionId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  padding: '4px 6px',
                  borderRadius: 4,
                  background: 'transparent',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                    color: 'var(--mc-text-muted, var(--muted-foreground))',
                    minWidth: 64,
                  }}
                >
                  {s.role ?? s.type}
                </span>
                <span style={{ flex: 1, color: 'var(--foreground)' }}>{s.model || s.sessionId}</span>
                <span style={{ color: 'var(--mc-text-muted, var(--muted-foreground))', fontSize: 11 }}>
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 7. Quick links */}
      <footer
        data-testid="overview-quick-links"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          paddingTop: 4,
        }}
      >
        {(
          [
            ['prd', 'View PRD'],
            ['vbrief', 'View vBRIEF'],
            ['beads', 'View Beads'],
            ['costs', 'View Costs'],
            ['activity', 'View Activity'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-testid={`overview-link-${key}`}
            onClick={() => onSwitchTab?.(key)}
            style={{
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--mc-border, var(--border))',
              background: 'transparent',
              color: 'var(--foreground)',
              cursor: 'pointer',
            }}
          >
            {label} ↗
          </button>
        ))}
      </footer>

      {planning.isLoading && (
        <div
          data-testid="overview-planning-loading"
          style={{ fontSize: 11, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
        >
          Loading planning context…
        </div>
      )}
    </div>
  );
}
