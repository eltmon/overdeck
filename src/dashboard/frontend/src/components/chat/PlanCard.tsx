import { useState, useCallback } from 'react';
import { Check, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type { ProposedPlan } from './chat-types';
import { ChatMarkdown } from './ChatMarkdown';
import styles from '../CommandDeck/styles/command-deck.module.css';

async function sendPlanAction(
  conversationName: string,
  action: string,
  feedback?: string,
): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(conversationName)}/plan-action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, feedback }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Plan action failed (${res.status})${body ? `: ${body}` : ''}`);
  }
}

interface PlanCardProps {
  plan: ProposedPlan;
  conversationName: string;
}

export function PlanCard({ plan, conversationName }: PlanCardProps) {
  const [sending, setSending] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [expanded, setExpanded] = useState(true);

  const handleAction = useCallback(async (action: string, feedbackText?: string) => {
    setSending(true);
    try {
      await sendPlanAction(conversationName, action, feedbackText);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send plan action');
    } finally {
      setSending(false);
    }
  }, [conversationName]);

  const handleApprove = useCallback(() => handleAction('approve-manual'), [handleAction]);

  const handleRejectWithFeedback = useCallback(() => {
    if (!feedback.trim()) {
      toast.error('Please enter feedback');
      return;
    }
    void handleAction('reject-feedback', feedback.trim());
    setShowFeedback(false);
    setFeedback('');
  }, [handleAction, feedback]);

  return (
    <div className={styles.planCard}>
      <div className={styles.planCardHeader}>
        <button
          type="button"
          className={styles.planCardToggle}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className={styles.planCardTitle}>Proposed Plan</span>
        </button>
        <span className={styles.planCardBadge}>Awaiting approval</span>
      </div>

      {expanded && (
        <div className={styles.planCardBody}>
          <ChatMarkdown text={plan.plan} />
        </div>
      )}

      <div className={styles.planCardActions}>
        <button
          className={styles.planCardApproveBtn}
          onClick={handleApprove}
          disabled={sending}
          title="Approve plan and begin implementation"
        >
          <Check size={14} />
          Approve
        </button>
        <button
          className={styles.planCardFeedbackBtn}
          onClick={() => setShowFeedback(v => !v)}
          disabled={sending}
          title="Request changes to the plan"
        >
          <MessageSquare size={14} />
          Request Changes
        </button>
      </div>

      {showFeedback && (
        <div className={styles.planCardFeedbackArea}>
          <textarea
            className={styles.planCardTextarea}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what to change..."
            rows={3}
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleRejectWithFeedback();
              }
            }}
          />
          <div className={styles.planCardFeedbackActions}>
            <button
              className={styles.planCardApproveBtn}
              onClick={handleRejectWithFeedback}
              disabled={sending || !feedback.trim()}
            >
              Send Feedback
            </button>
            <button
              className={styles.planCardCancelBtn}
              onClick={() => { setShowFeedback(false); setFeedback(''); }}
              disabled={sending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
