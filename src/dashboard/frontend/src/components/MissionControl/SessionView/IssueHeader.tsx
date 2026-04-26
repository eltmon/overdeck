import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListTodo, FileText, RefreshCw, ExternalLink } from 'lucide-react';
import type { ReviewStatus } from '../../inspector/types';
import styles from '../styles/mission-control.module.css';

interface PlanningData {
  prd?: string;
  state?: string;
  inference?: string;
  statusReview?: string;
  statusReviewedAt?: string;
  transcripts: Array<{ filename: string; content: string; uploadedAt: string }>;
  discussions: Array<{ filename: string; content: string; syncedAt: string }>;
  notes: Array<{ filename: string; content: string; uploadedAt: string }>;
}

async function fetchPlanning(issueId: string): Promise<PlanningData> {
  const res = await fetch(`/api/command-deck/planning/${issueId}`);
  if (!res.ok) throw new Error('Failed to fetch planning');
  return res.json();
}

async function fetchReviewStatus(issueId: string): Promise<ReviewStatus> {
  const res = await fetch(`/api/review/${issueId}/status`);
  if (!res.ok) throw new Error('Failed to fetch review status');
  return res.json();
}

interface IssueHeaderProps {
  issueId: string;
  title: string;
  cost?: number;
  source?: string;
  url?: string;
  onOpenBeads?: () => void;
}

interface PipelineDotProps {
  label: string;
  status: string;
}

function PipelineDot({ label, status }: PipelineDotProps) {
  const color =
    status === 'passed' || status === 'merged'
      ? 'var(--mc-success)'
      : status === 'failed' || status === 'blocked' || status === 'dispatch_failed'
        ? 'var(--mc-error)'
        : status === 'reviewing' || status === 'testing' || status === 'running' || status === 'merging' || status === 'verifying'
          ? 'var(--mc-warning)'
          : 'var(--mc-border)';

  return (
    <span className={styles.pipelineDotGroup} title={`${label}: ${status}`}>
      <span className={styles.pipelineDot} style={{ background: color }} />
      <span className={styles.pipelineDotLabel}>{label}</span>
    </span>
  );
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

export function IssueHeader({ issueId, title, cost, url, onOpenBeads }: IssueHeaderProps) {
  const [syncing, setSyncing] = useState(false);

  const { data: planning } = useQuery({
    queryKey: ['command-deck-planning', issueId],
    queryFn: () => fetchPlanning(issueId),
    refetchInterval: 30000,
  });

  const { data: reviewStatus } = useQuery({
    queryKey: ['review-status', issueId],
    queryFn: () => fetchReviewStatus(issueId),
    refetchInterval: 10000,
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch(`/api/command-deck/planning/${issueId}/sync-discussions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracker: 'github' }),
      });
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className={styles.issueHeader}>
      {/* Row 1: ID + title + pipeline + cost */}
      <div className={styles.issueHeaderRow}>
        <div className={styles.issueHeaderLeft}>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.issueHeaderId}
            >
              {issueId}
              <ExternalLink size={10} style={{ marginLeft: 4, opacity: 0.6 }} />
            </a>
          ) : (
            <span className={styles.issueHeaderId}>{issueId}</span>
          )}
          <span className={styles.issueHeaderTitle}>{title}</span>
        </div>
        <div className={styles.issueHeaderRight}>
          {reviewStatus && (
            <div className={styles.pipelineDots}>
              <PipelineDot label="Verify" status={reviewStatus.verificationStatus || 'pending'} />
              <PipelineDot label="Review" status={reviewStatus.reviewStatus} />
              <PipelineDot label="Test" status={reviewStatus.testStatus || 'pending'} />
              <PipelineDot label="Merge" status={reviewStatus.mergeStatus || 'pending'} />
            </div>
          )}
          {cost !== undefined && cost > 0 && (
            <span className={styles.issueHeaderCost}>{formatCost(cost)}</span>
          )}
        </div>
      </div>

      {/* Row 2: Compact action buttons */}
      <div className={styles.issueHeaderActions}>
        <button className={styles.issueHeaderBtn} onClick={onOpenBeads} title="View beads tasks">
          <ListTodo size={11} />
          Tasks
        </button>

        <button
          className={`${styles.issueHeaderBtn} ${!planning?.state ? styles.issueHeaderBtnDisabled : ''}`}
          onClick={() => planning?.state && alert('STATE.md\n\n' + planning.state)}
          title={planning?.state ? 'View STATE.md' : 'No STATE.md'}
        >
          <FileText size={11} />
          STATE
        </button>

        <button
          className={`${styles.issueHeaderBtn} ${!planning?.prd ? styles.issueHeaderBtnDisabled : ''}`}
          onClick={() => planning?.prd && alert('PRD\n\n' + planning.prd)}
          title={planning?.prd ? 'View PRD' : 'No PRD'}
        >
          <FileText size={11} />
          PRD
        </button>

        {(planning?.discussions?.length ?? 0) > 0 && (
          <button
            className={styles.issueHeaderBtn}
            onClick={() => {
              const content = planning!.discussions.map(d => `## ${d.filename}\n\n${d.content}`).join('\n\n---\n\n');
              alert(`Discussions (${planning!.discussions.length})\n\n${content}`);
            }}
            title="View discussions"
          >
            Discussions
            <span className={styles.issueHeaderBadge}>{planning!.discussions.length}</span>
          </button>
        )}

        {(planning?.transcripts?.length ?? 0) > 0 && (
          <button
            className={styles.issueHeaderBtn}
            onClick={() => {
              const content = planning!.transcripts.map(t => `## ${t.filename}\n\n${t.content}`).join('\n\n---\n\n');
              alert(`Transcripts (${planning!.transcripts.length})\n\n${content}`);
            }}
            title="View transcripts"
          >
            Transcripts
            <span className={styles.issueHeaderBadge}>{planning!.transcripts.length}</span>
          </button>
        )}

        <button
          className={styles.issueHeaderBtn}
          onClick={handleSync}
          disabled={syncing}
          title="Sync discussions"
        >
          <RefreshCw size={11} className={syncing ? styles.spinning : ''} />
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>
    </div>
  );
}
