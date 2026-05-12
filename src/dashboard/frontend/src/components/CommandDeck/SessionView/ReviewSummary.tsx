import { useMemo } from 'react';
import type { SessionNode as SessionNodeType } from '@panctl/contracts';
import {
  ShieldCheck,
  Lock,
  Gauge,
  ClipboardList,
} from 'lucide-react';
import { StatusDot, type StatusDotStatus } from '../StatusDot';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import { RoundCard } from '../RoundCard';
import type { RoundData } from '../RoundCard';
import styles from '../styles/command-deck.module.css';

const ROLE_META: Record<string, { icon: typeof ShieldCheck; label: string; color: string }> = {
  correctness: { icon: ShieldCheck, label: 'Correctness', color: 'var(--primary)' },
  security: { icon: Lock, label: 'Security', color: 'var(--destructive)' },
  performance: { icon: Gauge, label: 'Performance', color: 'var(--warning)' },
  requirements: { icon: ClipboardList, label: 'Requirements', color: 'var(--success)' },
};

function presenceToStatus(presence: SessionNodeType['presence']): StatusDotStatus {
  switch (presence) {
    case 'active': return 'active';
    case 'idle': return 'idle';
    case 'suspended': return 'waiting';
    case 'ended': return 'ended';
    default: return 'ended';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return 'Running';
    case 'stopped': return 'Done';
    case 'error': return 'Error';
    case 'starting': return 'Starting';
    case 'unknown': return 'Pending';
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'var(--primary)';
    case 'stopped': return 'var(--success)';
    case 'error': return 'var(--destructive)';
    default: return 'var(--muted-foreground)';
  }
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function fmtCost(cost: number | null | undefined): string {
  if (cost == null) return '';
  return `$${cost.toFixed(2)}`;
}

interface ReviewSummaryProps {
  session: SessionNodeType;
  reviewers: readonly SessionNodeType[];
  roundData: RoundData[];
}

export function ReviewSummary({ session, reviewers, roundData }: ReviewSummaryProps) {
  const totalFindings = useMemo(() => {
    let sum = 0;
    const latestSynthesis = session.roundMetadata?.history[session.roundMetadata.history.length - 1];
    if (latestSynthesis?.findings) sum += latestSynthesis.findings;
    for (const r of reviewers) {
      const latest = r.roundMetadata?.history[r.roundMetadata.history.length - 1];
      if (latest?.findings) sum += latest.findings;
    }
    return sum;
  }, [reviewers, session.roundMetadata]);

  const totalCost = useMemo(() => {
    let sum = 0;
    if (session.roundMetadata) {
      for (const h of session.roundMetadata.history) {
        if (h.cost) sum += h.cost;
      }
    }
    for (const r of reviewers) {
      if (!r.roundMetadata) continue;
      for (const h of r.roundMetadata.history) {
        if (h.cost) sum += h.cost;
      }
    }
    return sum;
  }, [reviewers, session.roundMetadata]);

  const synthSummary = useMemo(() => {
    if (!session.roundMetadata) return null;
    const latest = session.roundMetadata.history[session.roundMetadata.history.length - 1];
    return latest?.summary ?? null;
  }, [session.roundMetadata]);

  const allDone = reviewers.length > 0 && reviewers.every(r => r.status === 'stopped');
  const anyRunning = reviewers.some(r => r.status === 'running');
  const anyError = reviewers.some(r => r.status === 'error');

  const overallVerdict = allDone ? 'completed' : anyError ? 'issues' : anyRunning ? 'running' : 'pending';
  const verdictLabel = overallVerdict === 'completed' ? 'Review Complete'
    : overallVerdict === 'issues' ? 'Issues Detected'
    : overallVerdict === 'running' ? 'Review In Progress'
    : 'Pending';
  const verdictColor = overallVerdict === 'completed' ? 'var(--success)'
    : overallVerdict === 'issues' ? 'var(--destructive)'
    : overallVerdict === 'running' ? 'var(--primary)'
    : 'var(--muted-foreground)';

  return (
    <div className={styles.reviewSummary}>
      {/* Overall status banner */}
      <div className={styles.reviewSummaryBanner}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: verdictColor }}>
            {verdictLabel}
          </span>
          {reviewers.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
              {reviewers.filter(r => r.status === 'stopped').length}/{reviewers.length} reviewers done
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted-foreground)' }}>
          {totalFindings > 0 && (
            <span>{totalFindings} finding{totalFindings === 1 ? '' : 's'}</span>
          )}
          {totalCost > 0 && <span>{fmtCost(totalCost)}</span>}
          {session.duration != null && session.duration > 0 && (
            <span>{fmtDuration(session.duration)}</span>
          )}
        </div>
      </div>

      {/* Per-reviewer status strip */}
      {reviewers.length > 0 && (
        <div className={styles.reviewerStrip}>
          {reviewers.map(reviewer => {
            const meta = ROLE_META[reviewer.role ?? ''];
            const Icon = meta?.icon ?? ShieldCheck;
            const label = meta?.label ?? reviewer.role ?? 'Unknown';
            const iconColor = meta?.color ?? 'var(--muted-foreground)';
            const latestRound = reviewer.roundMetadata?.history[reviewer.roundMetadata.history.length - 1];

            return (
              <div key={reviewer.sessionId} className={styles.reviewerCard}>
                <div className={styles.reviewerCardLabel}>
                  <Icon size={14} style={{ color: iconColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
                  <StatusDot status={presenceToStatus(reviewer.presence)} size="sm" />
                </div>
                <div className={styles.reviewerCardStats}>
                  <span style={{ color: statusColor(reviewer.status), fontWeight: 500 }}>
                    {statusLabel(reviewer.status)}
                  </span>
                  {latestRound?.findings != null && latestRound.findings > 0 && (
                    <span>{latestRound.findings} finding{latestRound.findings === 1 ? '' : 's'}</span>
                  )}
                  {latestRound?.durationSec != null && (
                    <span>{fmtDuration(latestRound.durationSec)}</span>
                  )}
                  {latestRound?.cost != null && (
                    <span>{fmtCost(latestRound.cost)}</span>
                  )}
                  {reviewer.status === 'error' && reviewer.roundMetadata?.latestStatus && reviewer.roundMetadata.latestStatus !== 'error' && (
                    <span style={{ color: 'var(--destructive)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                      {reviewer.roundMetadata.latestStatus}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Round cards */}
      {roundData.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Rounds
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {roundData.map((r) => (
              <RoundCard key={r.round} round={r} active={r.round === session.roundMetadata?.latestRound} />
            ))}
          </div>
        </div>
      )}

      {/* Synthesis findings */}
      {synthSummary && (
        <div className={styles.reviewSynthesis}>
          <div className={styles.reviewSynthesisHeading}>Findings</div>
          <ChatMarkdown text={synthSummary} isStreaming={false} />
        </div>
      )}

      {/* Empty state */}
      {reviewers.length === 0 && roundData.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
          No review data yet. Reviewers will appear here once the review starts.
        </div>
      )}
    </div>
  );
}
