import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ListTodo, Brain, Upload, RefreshCw, ClipboardCheck } from 'lucide-react';
import { MarkdownModal } from './MarkdownModal';
import { TranscriptUpload } from './TranscriptUpload';
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

interface BadgeBarProps {
  issueId: string;
  onOpenBeads?: () => void;
}

async function fetchPlanning(issueId: string): Promise<PlanningData> {
  const res = await fetch(`/api/mission-control/planning/${issueId}`);
  if (!res.ok) throw new Error('Failed to fetch planning');
  return res.json();
}

export function BadgeBar({ issueId, onOpenBeads }: BadgeBarProps) {
  const [showModal, setShowModal] = useState<{ title: string; content: string } | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState(false);

  const { data: planning, refetch } = useQuery({
    queryKey: ['mission-control-planning', issueId],
    queryFn: () => fetchPlanning(issueId),
    refetchInterval: 30000,
  });

  const handleSyncDiscussions = async () => {
    setSyncing(true);
    try {
      // Try GitHub first, then Linear
      for (const tracker of ['github', 'linear']) {
        await fetch(`/api/mission-control/planning/${issueId}/sync-discussions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracker }),
        });
      }
      refetch();
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
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
                const res = await fetch(`/api/mission-control/planning/${issueId}/status-review`, { method: 'POST' });
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
            onClick={() => setShowModal({ title: 'INFERENCE.md', content: planning.inference! })}
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
          disabled={syncing}
          title="Sync discussions from issue tracker"
        >
          <RefreshCw size={12} className={syncing ? styles.spinning : ''} />
          Sync
        </button>
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
