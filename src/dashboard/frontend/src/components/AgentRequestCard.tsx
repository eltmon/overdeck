/**
 * AgentRequestCard — one pending secret request in the Decisions panel
 * (PAN-4941, PAN-4927 W-SEC1, FR-7, D-9).
 *
 * An agent asked the operator for a secret with `request_secret` and is
 * parked in `secret_wait`. Only a root-session viewer (a browser on this
 * machine) can answer: it gets a masked input, Send and Decline. Every other
 * viewer (a phone, a paired device, another machine's browser) reads where to
 * answer instead, because the answer routes accept only root credentials.
 *
 * The value lives only in this component's state until Send posts it. The
 * input is cleared whatever the answer, the value never goes into a URL, and
 * the component never logs.
 */
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Decision } from '../lib/useDecisions';
import { describePendingInput } from '../lib/pendingInput';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus } from './Settings/anywhere/anywhereApi';
import styles from './styles/decisions.module.css';

async function postAnswer(path: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(path, { method: 'POST', headers: await dashboardMutationJsonHeaders(), body: JSON.stringify(body) });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return `HTTP ${res.status}: ${typeof json?.error === 'string' ? json.error : 'request failed'}`;
}

export function AgentRequestCard({ decision }: { decision: Decision }) {
  const request = decision.agentRequest;
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const canAnswer = status?.viewer?.kind === 'root-session';
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!request) return null;
  const base = `/api/agent-requests/${encodeURIComponent(request.id)}`;

  async function answer(path: string, body: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const failure = await postAnswer(path, body);
      if (failure) setError(failure);
      else await queryClient.invalidateQueries({ queryKey: ['agent-requests'] });
    } catch {
      setError('Could not reach the dashboard');
    } finally {
      setValue('');
      setSending(false);
    }
  }

  function onSend(event: FormEvent) {
    event.preventDefault();
    if (value === '' || sending) return;
    void answer(`${base}/secret`, { value });
  }

  return (
    <div
      className={`${styles.row} ${styles.rowBlocking}`}
      data-testid="agent-request-card"
      data-decision-id={decision.id}
      data-blocking="true"
    >
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={`${styles.badge} ${styles.badgeBlocking}`}>{describePendingInput(decision.kinds)}</span>
          <span className={styles.subject}>{decision.label}</span>
        </div>
        <p className={styles.prompt}>{request.prompt}</p>
        <div className={styles.meta}>
          <span className={styles.mono}>{request.name}</span>
        </div>
        {canAnswer ? (
          <form className={styles.secretForm} onSubmit={onSend}>
            <input
              className={styles.secretInput}
              type="password"
              autoComplete="off"
              aria-label={`Value for ${request.name}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <button type="submit" className={styles.answer} disabled={value === '' || sending}>
              Send
            </button>
            <button type="button" className={styles.answer} disabled={sending} onClick={() => void answer(`${base}/decline`, {})}>
              Decline
            </button>
          </form>
        ) : (
          <p className={styles.meta}>Answer this on {status?.machine?.label ?? 'this machine'}'s own dashboard</p>
        )}
        {error && <p role="alert" className={styles.meta}>{error}</p>}
      </div>
    </div>
  );
}
