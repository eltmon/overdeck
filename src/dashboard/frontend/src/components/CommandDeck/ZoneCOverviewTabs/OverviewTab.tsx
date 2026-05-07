/**
 * OverviewTab — the killer issue-selected default view.
 *
 * Stacks (from top):
 *   1. Status billboard       (stage + cost + acceptance progress + last activity)
 *   2. Reviewer summary       (5-col grid, only when review sessions exist)
 *   3. Test summary           (placeholder until verification gate exposes results)
 *   4. PR summary             (placeholder — endpoint lands in pan-9yn5)
 *   5. Cost breakdown sparkline
 *   6. Recent activity feed   (issue-scoped, capped at 10 events)
 *   7. Quick links            (chips that switch tabs)
 *
 * This component keeps the data dependencies tight: planning summary + activity
 * + costs are shared so sibling tabs reuse cached lightweight responses.
 */

import { useMemo, useState } from 'react';
import type { Issue, Agent } from '../../../types';
import { LiveCounter } from '../LiveCounter';
import { ActivitySparkline } from '../ActivitySparkline';
import { RoundCard, type RoundData, type RoundVerdict } from '../RoundCard';
import {
  useActivityQuery,
  useIssueCostsQuery,
  usePlanningSummaryQuery,
  useReviewStatusQuery,
  usePrQuery,
  useWorkspaceQuery,
  type ActivitySection,
  type ReviewerRoundMetadata,
} from './queries';
import type { OverviewTab as OverviewTabKey } from '../ZoneCOverview';
import { refreshDashboardState } from '../../../lib/refresh-dashboard-state';
import { isReviewPipelineStuck } from '../../../lib/pipeline-state';
import { useConfirm } from '../../DialogProvider';
import { useQueryClient } from '@tanstack/react-query';
import { GitPullRequest, CheckCircle2, XCircle, Clock, AlertCircle, Copy, Box, Link2, Terminal, Play, Pause, ExternalLink, Code2, Loader2, RotateCcw } from 'lucide-react';
import { PlanDAGViewer } from '../../PlanDAG.js';

interface OverviewTabProps {
  issueId: string;
  onSwitchTab?: (tab: OverviewTabKey) => void;
  issue?: Issue;
  agent?: Agent;
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
  if (sections.length === 0) return 'idle';
  const active = [...sections].reverse().find((s) => s.status === 'active' || s.status === 'running');
  const target = active ?? sections.at(-1);
  if (!target) return 'idle';
  if (target.role) return target.role;
  return target.type;
}

function Tile({
  title,
  icon,
  children,
  testid,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {icon}
        <span>{title}</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
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
        border: '1px solid var(--border)',
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
          color: 'var(--muted-foreground)',
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

function formatRuntime(startedAt: string): string {
  const ms = Date.now() - Date.parse(startedAt);
  if (Number.isNaN(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function OverviewTab({ issueId, onSwitchTab, issue, agent }: OverviewTabProps) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [isRecoverPending, setIsRecoverPending] = useState(false);
  const [isSpawnPending, setIsSpawnPending] = useState(false);
  const planning = usePlanningSummaryQuery(issueId);
  const activity = useActivityQuery(issueId);
  const costs = useIssueCostsQuery(issueId);
  const reviewStatus = useReviewStatusQuery(issueId);
  const pr = usePrQuery(issueId);
  const workspace = useWorkspaceQuery(issueId);

  const sections = activity.data?.sections ?? [];
  const stage = deriveStageFromSections(sections);
  const isCostPending = costs.isLoading && activity.isLoading;
  const costFromIssues = costs.data?.resolvedTotalCost;
  const costFromActivity = !activity.isLoading ? activity.data?.resolvedTotalCost : undefined;
  const totalCost = costFromIssues ?? costFromActivity ?? null;
  const lastLabel = lastActivityLabel(sections);
  const activeAgentCount = sections.filter(
    (s) => s.status === 'running' || s.status === 'active',
  ).length;

  const costSparklineEvents = useMemo(
    () =>
      (costs.data?.sessions ?? [])
        .filter((session) => typeof session.cost === 'number' && session.cost > 0)
        .map((session) => {
          const endedAt = session.endedAt ? Date.parse(session.endedAt) : NaN;
          const startedAt = Date.parse(session.startedAt);
          const timestamp = Number.isNaN(endedAt) ? startedAt : endedAt;
          return {
            timestamp,
            weight: session.cost,
            category: 'info' as const,
          };
        })
        .filter((event) => !Number.isNaN(event.timestamp)),
    [costs.data?.sessions],
  );

  const reviewerSections = useMemo(
    () => sections.filter((s) => s.type === 'reviewer'),
    [sections],
  );

  const isRecoverable = isReviewPipelineStuck(reviewStatus.data ?? undefined);
  const recentEvents = useMemo(() => sections.slice(-10).reverse(), [sections]);

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
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Title row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            <h1
              data-testid="overview-title"
              style={{
                fontSize: 18,
                fontWeight: 700,
                margin: 0,
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={issue?.title || issueId}
            >
              {issue?.title || issueId}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* State pill */}
              {issue?.status && (
                <span
                  data-testid="overview-status-pill"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                    color: 'var(--primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}
                >
                  {issue.status}
                </span>
              )}
              {/* Stage pill */}
              <span
                data-testid="overview-stage"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'color-mix(in srgb, var(--foreground) 5%, transparent)',
                  color: 'var(--muted-foreground)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                }}
              >
                {stage}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                {issueId}
              </span>
            </div>
          </div>
          {/* Cost metric */}
          <div
            data-testid="overview-cost"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 2,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700 }}>
              {isCostPending
                ? <span data-testid="overview-cost-loading">Loading…</span>
                : totalCost === null
                  ? null
                  : <LiveCounter value={totalCost} unit="$" precision={2} pulseOnIncrement />}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
              cost to date
            </span>
          </div>
        </div>

        {/* Metrics row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 12,
            color: 'var(--muted-foreground)',
            flexWrap: 'wrap',
          }}
        >
          {/* Runtime */}
          {agent?.startedAt && (
            <div data-testid="overview-runtime" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} />
              <span>Runtime: {formatRuntime(agent.startedAt)}</span>
            </div>
          )}
          {/* Agent count */}
          <div data-testid="overview-agent-count" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Box size={12} />
            <span>
              {activeAgentCount} active agent{activeAgentCount === 1 ? '' : 's'}
            </span>
          </div>
          {/* Session count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Terminal size={12} />
            <span>
              {sections.length} session{sections.length === 1 ? '' : 's'}
            </span>
          </div>
          {/* Last activity */}
          <span data-testid="overview-last-activity">{lastLabel}</span>
        </div>
      </section>

      {/* 2. Directive DAG — front-loaded plan visualization */}
      <section
        data-testid="overview-dag"
        style={{
          borderRadius: 10,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          height: 520,
          background: '#111827',
        }}
      >
        <PlanDAGViewer issueId={issueId} reviewStatus={reviewStatus.data ?? undefined} />
      </section>

      {/* 3. Tile grid */}
      <div
        data-testid="overview-tile-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 10,
        }}
      >
        {/* AGENT tile */}
        <Tile title="Agent" icon={<Box size={14} />} testid="overview-tile-agent">
          {agent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span><strong>Model:</strong> {agent.model}</span>
              <span><strong>Runtime:</strong> {formatRuntime(agent.startedAt)}</span>
              <span><strong>Status:</strong> {agent.status}</span>
              {workspace.data?.agentSessionId && (
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted-foreground)' }}>
                  {workspace.data.agentSessionId}
                </span>
              )}
            </div>
          ) : workspace.data?.hasAgent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span><strong>Model:</strong> {workspace.data.agentModelFull || workspace.data.agentModel || 'unknown'}</span>
              {workspace.data.agentSessionId && (
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted-foreground)' }}>
                  {workspace.data.agentSessionId}
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No active agent</span>
              <button
                type="button"
                disabled={isSpawnPending}
                onClick={async () => {
                  if (isSpawnPending) return;
                  setIsSpawnPending(true);
                  try {
                    await fetch(`/api/agents`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ issueId }),
                    });
                  } catch {
                    // non-fatal
                  } finally {
                    setIsSpawnPending(false);
                  }
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: isSpawnPending ? 'wait' : 'pointer',
                  opacity: isSpawnPending ? 0.6 : 1,
                  alignSelf: 'flex-start',
                }}
              >
                {isSpawnPending ? 'Spawning…' : 'Spawn Work'}
              </button>
            </div>
          )}
        </Tile>

        {/* COST tile */}
        <Tile title="Cost" icon={<Code2 size={14} />} testid="overview-tile-cost">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {isCostPending
                ? <span data-testid="overview-cost-tile-loading">Loading…</span>
                : totalCost === null
                  ? null
                  : <LiveCounter value={totalCost} unit="$" precision={2} />}
            </div>
            {costs.data?.byModel && Object.keys(costs.data.byModel).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Object.entries(costs.data.byModel)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([model, v]) => (
                    <div key={model} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: 'var(--muted-foreground)' }}>{model}</span>
                      <span>${v.cost.toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </Tile>

        {/* BY STAGE tile */}
        <Tile title="By Stage" icon={<Clock size={14} />} testid="overview-tile-stage">
          {costs.data?.byStage && Object.keys(costs.data.byStage).length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(costs.data.byStage)
                .sort((a, b) => b[1].cost - a[1].cost)
                .map(([stageName, v]) => (
                  <div key={stageName} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ textTransform: 'capitalize', color: 'var(--muted-foreground)' }}>{stageName}</span>
                    <span>${v.cost.toFixed(2)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No stage data yet</span>
          )}
        </Tile>

        {/* SERVICES tile */}
        <Tile title="Services" icon={<ExternalLink size={14} />} testid="overview-tile-services">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workspace.data?.services?.some((svc) => svc.url) ? (
              workspace.data.services
                .filter((svc) => svc.url)
                .map((svc) => (
                  <a
                    key={svc.name}
                    href={svc.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--primary)',
                      textDecoration: 'none',
                    }}
                  >
                    {svc.name} ↗
                  </a>
                ))
            ) : (
              <>
                {workspace.data?.frontendUrl && (
                  <a
                    href={workspace.data.frontendUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}
                  >
                    Frontend ↗
                  </a>
                )}
                {workspace.data?.apiUrl && (
                  <a
                    href={workspace.data.apiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}
                  >
                    API ↗
                  </a>
                )}
              </>
            )}
            {!workspace.data?.frontendUrl && !workspace.data?.apiUrl && !workspace.data?.services?.length && (
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No services configured</span>
            )}
          </div>
        </Tile>

        {/* ATTACH tile */}
        <Tile title="Attach" icon={<Terminal size={14} />} testid="overview-tile-attach">
          {workspace.data?.agentSessionId ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  padding: '6px 8px',
                  background: 'color-mix(in srgb, var(--foreground) 3%, transparent)',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  tmux attach -t {workspace.data.agentSessionId}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`tmux attach -t ${workspace.data.agentSessionId}`).catch(() => { /* ignore */ });
                  }}
                  style={{
                    padding: 2,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    color: 'var(--muted-foreground)',
                    flexShrink: 0,
                  }}
                  title="Copy command"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No active session</span>
          )}
        </Tile>

        {/* ACTIONS tile */}
        <Tile title="Actions" icon={<Play size={14} />} testid="overview-tile-actions">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              data-testid="overview-action-review-test"
              onClick={() => {
                void fetch(`/api/review/${issueId}/trigger`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                }).catch(() => { /* ignore */ });
              }}
              disabled={!reviewStatus.data || reviewStatus.data.reviewStatus === 'reviewing' || reviewStatus.data.testStatus === 'testing'}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                fontSize: 11,
                cursor: 'pointer',
                opacity: !reviewStatus.data || reviewStatus.data.reviewStatus === 'reviewing' || reviewStatus.data.testStatus === 'testing' ? 0.5 : 1,
              }}
            >
              {reviewStatus.data?.readyForMerge ? 'Re-Review' : 'Review & Test'}
            </button>
            {isRecoverable && (
              <button
                type="button"
                data-testid="overview-action-recover"
                onClick={() => {
                  void (async () => {
                    if (!(await confirm({
                      title: 'Recover Pipeline',
                      message: `Recover ${issueId}?\n\nThis will:\n• Clear failed review, test, and merge state\n• Reset circuit breaker counters\n• Remove queued specialist tasks\n• Re-dispatch review and test as needed`,
                      confirmLabel: 'Recover',
                    }))) {
                      return;
                    }
                    setIsRecoverPending(true);
                    try {
                      await fetch(`/api/review/${issueId}/reset`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rerun: true }),
                      });
                      await refreshDashboardState(queryClient);
                    } catch {
                      /* ignore */
                    } finally {
                      setIsRecoverPending(false);
                    }
                  })();
                }}
                disabled={isRecoverPending}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  fontSize: 11,
                  cursor: 'pointer',
                  opacity: isRecoverPending ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {isRecoverPending ? <Loader2 size={12} /> : <RotateCcw size={12} />}
                {isRecoverPending ? 'Recovering...' : 'Recover'}
              </button>
            )}
            <button
              type="button"
              data-testid="overview-action-sync"
              onClick={() => {
                void fetch(`/api/issues/${issueId}/sync-main`, { method: 'POST' }).catch(() => { /* ignore */ });
              }}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Sync
            </button>
            {agent && (agent.status === 'running' || agent.status === 'starting' || agent.status === 'healthy') && (
              <button
                type="button"
                data-testid="overview-action-stop"
                onClick={() => {
                  void fetch(`/api/agents/${agent.id}`, { method: 'DELETE' }).catch(() => { /* ignore */ });
                }}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--destructive)',
                  background: 'transparent',
                  color: 'var(--destructive)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Stop
              </button>
            )}
          </div>
        </Tile>

        {/* WORKSPACE tile */}
        <Tile title="Workspace" icon={<Box size={14} />} testid="overview-tile-workspace">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {workspace.data?.containers && workspace.data.containers.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {workspace.data.containers.map((c) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: c.status === 'running' ? 'var(--success)' : 'var(--destructive)',
                      }}
                    />
                    <span>{c.name}</span>
                    <span style={{ color: 'var(--muted-foreground)', marginLeft: 'auto' }}>{c.status}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {workspace.data?.hasDocker && (
                <button
                  type="button"
                  onClick={() => {
                    void fetch(`/api/workspaces/${issueId}/containers/frontend/stop`, { method: 'POST' }).catch(() => { /* ignore */ });
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Pause size={12} /> Stop
                </button>
              )}
              {workspace.data?.path && (
                <a
                  href={`vscode://file/${workspace.data.path}`}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <ExternalLink size={12} /> Open VS Code
                </a>
              )}
              {workspace.data?.canContainerize && !workspace.data?.hasAgent && (
                <button
                  type="button"
                  onClick={() => {
                    void fetch(`/api/workspaces/${issueId}/containerize`, { method: 'POST' }).catch(() => { /* ignore */ });
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Box size={12} /> Containerize
                </button>
              )}
            </div>
            {!workspace.data?.hasDocker && !workspace.data?.canContainerize && (
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No containers</span>
            )}
          </div>
        </Tile>

        {/* LINKS tile */}
        <Tile title="Links" icon={<Link2 size={14} />} testid="overview-tile-links">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {issue?.url && (
              <a
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none' }}
              >
                {issue.source === 'linear' ? 'Linear' : 'GitHub Issue'} ↗
              </a>
            )}
            {planning.data?.hasPrd && (
              <button
                type="button"
                onClick={() => onSwitchTab?.('prd')}
                style={{
                  fontSize: 12,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                View PRD ↗
              </button>
            )}
            {!issue?.url && !planning.data?.hasPrd && (
              <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>No links available</span>
            )}
          </div>
        </Tile>
      </div>

      {/* 3. Reviewer summary */}
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
              // When the reviewer is currently running, show "running" status.
              // If there's prior round data, keep showing it but with running verdict.
              // If no prior data, show a clean running card.
              const isLive = sec?.status === 'running' || sec?.status === 'active';
              const displayData = isLive
                ? { round: data ? data.round + 1 : 1, verdict: 'running' as const }
                : data;
              return (
                <div
                  key={role}
                  data-testid={`overview-reviewer-${role}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <ReviewerRoleLabel role={role} />
                  {displayData ? (
                    <RoundCard round={displayData} />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px dashed var(--border)',
                        fontSize: 11,
                        color: 'var(--muted-foreground)',
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

      {/* 3. Test summary (PAN-847) */}
      <Section title="Tests">
        {reviewStatus.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Loading…</div>
        ) : (
          <div data-testid="overview-tests" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              {reviewStatus.data?.testStatus === 'passed' || reviewStatus.data?.verificationStatus === 'passed' ? (
                <>
                  <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                  <span style={{ color: 'var(--success)', fontWeight: 600 }}>Tests passed</span>
                </>
              ) : reviewStatus.data?.testStatus === 'failed' || reviewStatus.data?.verificationStatus === 'failed' ? (
                <>
                  <XCircle size={14} style={{ color: 'var(--destructive)' }} />
                  <span style={{ color: 'var(--destructive)', fontWeight: 600 }}>Tests failed</span>
                </>
              ) : reviewStatus.data?.testStatus === 'testing' || reviewStatus.data?.verificationStatus === 'running' ? (
                <>
                  <Clock size={14} style={{ color: 'var(--warning)' }} />
                  <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Tests running…</span>
                </>
              ) : (
                <>
                  <AlertCircle size={14} style={{ color: 'var(--muted-foreground)' }} />
                  <span style={{ color: 'var(--muted-foreground)' }}>No test results yet</span>
                </>
              )}
              {reviewStatus.data?.verificationCycleCount !== undefined && reviewStatus.data?.verificationMaxCycles !== undefined && (
                <span style={{ color: 'var(--muted-foreground)', marginLeft: 'auto' }}>
                  cycle {reviewStatus.data.verificationCycleCount}/{reviewStatus.data.verificationMaxCycles}
                </span>
              )}
            </div>
            {(reviewStatus.data?.testNotes || reviewStatus.data?.verificationNotes) && (
              <div style={{ fontSize: 11, color: 'var(--muted-foreground)', padding: '4px 8px', background: 'color-mix(in srgb, var(--foreground) 3%, transparent)', borderRadius: 4 }}>
                {reviewStatus.data.testNotes || reviewStatus.data.verificationNotes}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 4. PR summary (PAN-847) */}
      <Section title="Pull request">
        {pr.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Loading…</div>
        ) : pr.data?.pr ? (
          <div data-testid="overview-pr" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <GitPullRequest size={14} style={{ color: 'var(--primary)' }} />
              <a href={pr.data.pr.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                #{pr.data.pr.number} {pr.data.pr.title}
              </a>
              <span style={{ color: 'var(--muted-foreground)', marginLeft: 'auto' }}>
                {pr.data.pr.state}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted-foreground)' }}>
              <span>+{pr.data.pr.additions} -{pr.data.pr.deletions}</span>
              <span>{pr.data.pr.changedFiles} file{pr.data.pr.changedFiles === 1 ? '' : 's'}</span>
              {pr.data.pr.reviewDecision && (
                <span style={{ textTransform: 'capitalize' }}>{pr.data.pr.reviewDecision.replace(/_/g, ' ')}</span>
              )}
              <button
                type="button"
                data-testid="overview-pr-link"
                onClick={() => onSwitchTab?.('prdiff')}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--muted-foreground)',
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
              >
                View diff ↗
              </button>
            </div>
          </div>
        ) : (
          <div data-testid="overview-pr" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            No PR found for this issue.
          </div>
        )}
      </Section>

      {/* 5. Cost sparkline */}
      <Section
        title="Cost trend over recent sessions"
        rightSlot={
          <button
            type="button"
            data-testid="overview-sparkline-link-costs"
            onClick={() => onSwitchTab?.('costs')}
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted-foreground)',
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
          <ActivitySparkline events={costSparklineEvents} ariaLabel="Cost trend across recent sessions" />
          <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
            {costSparklineEvents.length} billed session{costSparklineEvents.length === 1 ? '' : 's'}
          </span>
        </div>
      </Section>

      {/* 6. Recent activity */}
      <Section title="Recent activity">
        {recentEvents.length === 0 ? (
          <div
            data-testid="overview-activity-empty"
            style={{ fontSize: 12, color: 'var(--muted-foreground)' }}
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
                    color: 'var(--muted-foreground)',
                    minWidth: 64,
                  }}
                >
                  {s.role ?? s.type}
                </span>
                <span style={{ flex: 1, color: 'var(--foreground)' }}>{s.model || s.sessionId}</span>
                <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
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
              border: '1px solid var(--border)',
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
          style={{ fontSize: 11, color: 'var(--muted-foreground)' }}
        >
          Loading planning context…
        </div>
      )}
    </div>
  );
}
