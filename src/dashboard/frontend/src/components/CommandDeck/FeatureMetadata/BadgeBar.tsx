import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ListTodo, Brain, Upload, RefreshCw, ClipboardCheck } from 'lucide-react';
import { MarkdownModal } from './MarkdownModal';
import { TranscriptUpload } from './TranscriptUpload';
import styles from '../styles/command-deck.module.css';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../../../lib/commandDeckSurfaceRegistry';

void COMMAND_DECK_SURFACE_REGISTRY;

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

interface BadgeBarProps {
  issueId: string;
  source?: string;
  onOpenBeads?: () => void;
}

async function fetchPlanning(issueId: string): Promise<PlanningData> {
  const res = await fetch(`/api/command-deck/planning/${issueId}`);
  if (!res.ok) throw new Error('Failed to fetch planning');
  return res.json();
}

export function BadgeBar({ issueId, source, onOpenBeads }: BadgeBarProps) {
  const [showModal, setShowModal] = useState<{ title: string; content: string } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [generatingStatus, setGeneratingStatus] = useState(false);

  const { data: planning, refetch } = useQuery({
    queryKey: ['command-deck-planning', issueId],
    queryFn: () => fetchPlanning(issueId),
    refetchInterval: 30000,
  });

  const handleSyncDiscussions = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      // Use the issue's source tracker if known, otherwise try all
      const trackers = source ? [source] : ['github', 'linear', 'rally'];
      let totalSynced = 0;
      let lastError: string | null = null;

      for (const tracker of trackers) {
        try {
          const res = await fetch(`/api/command-deck/planning/${issueId}/sync-discussions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracker }),
          });
          if (res.ok) {
            const data = await res.json();
            totalSynced += data.synced || 0;
          } else if (source) {
            // Only show error if this was the targeted tracker
            const errData = await res.json().catch(() => ({ error: 'Sync failed' }));
            lastError = errData.error || `HTTP ${res.status}`;
          }
        } catch {
          if (source) lastError = 'Network error';
        }
      }

      if (lastError && totalSynced === 0) {
        setSyncResult({ message: lastError, isError: true });
      } else if (totalSynced > 0) {
        setSyncResult({ message: `Synced ${totalSynced} — generating status...`, isError: false });
      } else {
        setSyncResult({ message: 'No new discussions', isError: false });
      }

      // Auto-generate status review after sync
      // The backend checks a content hash — if nothing changed, it returns the cached review instantly
      setGeneratingStatus(true);
      try {
        const statusRes = await fetch(`/api/command-deck/planning/${issueId}/status-review`, { method: 'POST' });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const wasCached = statusData.cached;
          if (wasCached) {
            setSyncResult({ message: totalSynced > 0 ? `Synced ${totalSynced} (status unchanged)` : 'No changes detected', isError: false });
          } else if (totalSynced > 0) {
            setSyncResult({ message: `Synced ${totalSynced} + status updated`, isError: false });
          } else {
            setSyncResult({ message: 'Status updated', isError: false });
          }
          // Show the status review
          setShowModal({
            title: `Status Review${wasCached ? ' (cached)' : ''} — ${new Date(statusData.reviewedAt).toLocaleString()}`,
            content: statusData.statusReview,
          });
        } else {
          // Status review failed (e.g., no planning dir) — still show sync result
          const errData = await statusRes.json().catch(() => ({ error: 'Status review failed' }));
          if (totalSynced > 0) {
            setSyncResult({ message: `Synced ${totalSynced} (status: ${errData.error})`, isError: false });
          }
        }
      } catch (e) {
        console.error('Status review generation failed:', e);
      } finally {
        setGeneratingStatus(false);
      }

      refetch();
    } catch (e) {
      console.error('Sync failed:', e);
      setSyncResult({ message: 'Sync failed', isError: true });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 6000);
    }
  };

  return (
    <>
      <div className={styles.badgeBar}>
        {/* Tasks badge */}
        <button
          className={styles.badge}
          onClick={onOpenBeads}
          title="View beads tasks"
        >
          <ListTodo size={12} />
          Tasks
        </button>

        {/* STATE.md badge */}
        <button
          className={`${styles.badge} ${!planning?.state ? styles.badgeDisabled : ''}`}
          onClick={() => planning?.state && setShowModal({ title: 'STATE.md', content: planning.state })}
          title={planning?.state ? 'View STATE.md' : 'No STATE.md available'}
        >
          <FileText size={12} />
          STATE
        </button>

        {/* PRD badge */}
        <button
          className={`${styles.badge} ${!planning?.prd ? styles.badgeDisabled : ''}`}
          onClick={() => planning?.prd && setShowModal({ title: 'PRD', content: planning.prd })}
          title={planning?.prd ? 'View PRD' : 'No PRD available'}
        >
          <FileText size={12} />
          PRD
        </button>

        {/* Status Review badge */}
        <button
          className={`${styles.badge} ${!planning?.statusReview && !generatingStatus ? styles.badgeDisabled : ''}`}
          onClick={async () => {
            if (planning?.statusReview) {
              setShowModal({ title: `Status Review${planning.statusReviewedAt ? ` (${new Date(planning.statusReviewedAt).toLocaleString()})` : ''}`, content: planning.statusReview });
            } else {
              // Generate a new status review
              setGeneratingStatus(true);
              try {
                const res = await fetch(`/api/command-deck/planning/${issueId}/status-review`, { method: 'POST' });
                if (res.ok) {
                  const data = await res.json();
                  setShowModal({ title: 'Status Review', content: data.statusReview });
                  refetch();
                }
              } catch (e) {
                console.error('Failed to generate status review:', e);
              } finally {
                setGeneratingStatus(false);
              }
            }
          }}
          title={planning?.statusReview ? 'View status review (click to refresh)' : 'Generate status review'}
        >
          <ClipboardCheck size={12} className={generatingStatus ? styles.spinning : ''} />
          {generatingStatus ? 'Reviewing...' : 'Status'}
        </button>

        {/* Inference badge (Shadow Engineering only) */}
        {planning?.inference && (
          <button
            className={styles.badge}
            onClick={() => setShowModal({
              title: 'INFERENCE.md',
              content: `*The Inference Document is a Shadow Engineering artifact. It analyzes how AI would approach this work — identifying gaps in requirements, risks, and potential implementation strategies — without making any changes. Use it to evaluate readiness before transitioning to AI-driven development.*\n\n---\n\n${planning.inference!}`
            })}
            title="View Inference Document (Shadow Engineering)"
          >
            <Brain size={12} />
            Inference
          </button>
        )}

        {/* Discussions count */}
        {(planning?.discussions?.length ?? 0) > 0 && (
          <button
            className={styles.badge}
            onClick={() => {
              const content = planning!.discussions.map(d =>
                `## ${d.filename}\n\n${d.content}`
              ).join('\n\n---\n\n');
              setShowModal({ title: 'Discussions', content });
            }}
          >
            Discussions ({planning!.discussions.length})
          </button>
        )}

        {/* Transcripts count */}
        {(planning?.transcripts?.length ?? 0) > 0 && (
          <button
            className={styles.badge}
            onClick={() => {
              const content = planning!.transcripts.map(t =>
                `## ${t.filename}\n\n${t.content}`
              ).join('\n\n---\n\n');
              setShowModal({ title: 'Transcripts', content });
            }}
          >
            Transcripts ({planning!.transcripts.length})
          </button>
        )}

        {/* Upload */}
        <button
          className={styles.badge}
          onClick={() => setShowUpload(true)}
          title="Upload transcript or note"
        >
          <Upload size={12} />
          Upload
        </button>

        {/* Sync discussions */}
        <button
          className={`${styles.syncButton} ${syncing ? '' : ''}`}
          onClick={handleSyncDiscussions}
          disabled={syncing || generatingStatus}
          title="Sync discussions and generate AI status review"
        >
          <RefreshCw size={12} className={syncing || generatingStatus ? styles.spinning : ''} />
          {generatingStatus ? 'Reviewing...' : syncing ? 'Syncing...' : 'Sync'}
        </button>
        {syncResult && (
          <span
            className={styles.badge}
            style={{
              color: syncResult.isError ? 'var(--mc-error, #ef4444)' : 'var(--mc-success, #22c55e)',
              fontSize: '0.7rem',
              opacity: 0.9,
            }}
          >
            {syncResult.message}
          </span>
        )}
      </div>

      {showModal && (
        <MarkdownModal
          title={showModal.title}
          content={showModal.content}
          onClose={() => setShowModal(null)}
        />
      )}

      {showUpload && (
        <TranscriptUpload
          issueId={issueId}
          onClose={() => { setShowUpload(false); refetch(); }}
        />
      )}
    </>
  );
}
