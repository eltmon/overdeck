/**
 * McpSignInCard — one pending MCP OAuth sign-in in the Decisions panel
 * (PAN-4946, PRD WI-3).
 *
 * The approval code is shown so the operator can match it against the page
 * the client opened before granting access. There is no optimistic hide on
 * Approve/Deny: the row disappears only once `MCP_OAUTH_APPROVALS_QUERY_KEY`
 * refetches and the server confirms the approval is gone.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Decision } from '../lib/useDecisions';
import { describePendingInput } from '../lib/pendingInput';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { useNow } from '../hooks/useNow';
import {
  apiError,
  decideMcpSignIn,
  isMcpOAuthLevel,
  isOk,
  MCP_OAUTH_APPROVALS_QUERY_KEY,
  MCP_OAUTH_LEVELS,
  MCP_OAUTH_LEVEL_LABELS,
  type McpOAuthLevel,
} from './Settings/anywhere/anywhereApi';
import styles from './styles/decisions.module.css';

export function McpSignInCard({ decision }: { decision: Decision }) {
  const approval = decision.mcpSignIn;
  const queryClient = useQueryClient();
  const now = useNow();
  const [level, setLevel] = useState<McpOAuthLevel>(() =>
    (approval && isMcpOAuthLevel(approval.requestedLevel) ? approval.requestedLevel : 'read'));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!approval) return null;

  async function decide(decision_: 'approve' | 'deny') {
    setSending(true);
    setError(null);
    try {
      const result = await decideMcpSignIn(approval.id, decision_, decision_ === 'approve' ? level : undefined);
      if (!isOk(result)) setError(`HTTP ${result.status}: ${apiError(result)}`);
    } catch {
      setError('Could not reach the dashboard');
    } finally {
      await queryClient.invalidateQueries({ queryKey: MCP_OAUTH_APPROVALS_QUERY_KEY });
      setSending(false);
    }
  }

  return (
    <div
      className={`${styles.row} ${styles.rowBlocking}`}
      data-testid="mcp-sign-in-card"
      data-decision-id={decision.id}
      data-blocking="true"
    >
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={`${styles.badge} ${styles.badgeBlocking}`}>{describePendingInput(decision.kinds)}</span>
          <span className={styles.subject}>{approval.clientName} wants access to Overdeck</span>
        </div>
        <p data-testid="mcp-sign-in-code" className={styles.approvalCode}>{approval.approvalCode}</p>
        <p className={styles.prompt}>Approve only if the page you opened shows this code.</p>
        <div className={styles.meta}>
          <span className={styles.mono}>{approval.redirectHost}</span>
          <span>· expires {formatRelativeTime(approval.expiresAt, now)}</span>
        </div>
        <div className={styles.secretForm}>
          <select
            aria-label="Access level"
            className={styles.levelSelect}
            value={level}
            disabled={sending}
            onChange={(event) => setLevel(event.target.value as McpOAuthLevel)}
          >
            {MCP_OAUTH_LEVELS.map((candidate) => (
              <option key={candidate} value={candidate}>{MCP_OAUTH_LEVEL_LABELS[candidate]}</option>
            ))}
          </select>
          <button type="button" className={styles.answer} disabled={sending} onClick={() => void decide('approve')}>
            Approve
          </button>
          <button type="button" className={styles.answer} disabled={sending} onClick={() => void decide('deny')}>
            Deny
          </button>
        </div>
        {error && <p role="alert" className={styles.meta}>{error}</p>}
      </div>
    </div>
  );
}
