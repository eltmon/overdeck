/**
 * AgentRequestCard — one pending agent request in the Decisions panel
 * (PAN-4941, PAN-4927 W-SEC1, FR-7, D-9; PAN-4942 W-LINK1, D-9).
 *
 * An agent asked the operator for a secret with `request_secret` and is
 * parked in `secret_wait`. Only a root-session viewer (a browser on this
 * machine) can answer: it gets a masked input, Send and Decline. Every other
 * viewer (a phone, a paired device, another machine's browser) reads where to
 * answer instead (D10, `agentRequestElsewhereText`), because the answer
 * routes accept only root credentials.
 *
 * The value lives only in `AgentRequestAnswer`'s state until Send posts it.
 * The input is cleared whatever the answer, the value never goes into a URL,
 * and the component never logs.
 *
 * A machine-link request (`link_machine`, parked in `link_machine_wait`)
 * renders `MachineLinkRequestBody` in the same frame: the agent's hint, then
 * for a root-session viewer **Link a machine…**, which opens the Link a
 * machine dialog with the request id so the dialog resolves it after linking,
 * and **Dismiss**, which declines it. No pairing code passes through here.
 *
 * PAN-5541 WI-3: `AgentRequestAnswer` is the answer body alone (no frame, no
 * testid), so the agent-request dialog and the pinned terminal-view cards can
 * reuse it without duplicating state. `onAnswered`/`onLinkOpened` let a
 * caller close itself and toast after a successful answer (D8); neither is
 * required for the Decisions panel card.
 */
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { Decision } from '../lib/useDecisions';
import { describePendingInput } from '../lib/pendingInput';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';
import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus } from './Settings/anywhere/anywhereApi';
import { openAnywhereDialog } from './Settings/anywhere/anywhereDialogStore';
import styles from './styles/decisions.module.css';

async function postAnswer(path: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(path, { method: 'POST', headers: await dashboardMutationJsonHeaders(), body: JSON.stringify(body) });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return `HTTP ${res.status}: ${typeof json?.error === 'string' ? json.error : 'request failed'}`;
}

/** D10: the machine named is the one running this dashboard, not the agent's host. */
export function agentRequestElsewhereText(kind: 'secret' | 'machine-link', machineLabel: string | null | undefined): string {
  if (machineLabel) {
    return kind === 'secret'
      ? `Answer this on ${machineLabel}'s own dashboard. A secret can be typed only in a browser on ${machineLabel} itself, so it never crosses the network.`
      : `Answer this on ${machineLabel}'s own dashboard. Machines can be linked only from a browser on ${machineLabel} itself.`;
  }
  return kind === 'secret'
    ? 'Answer this in a browser on the machine that runs this dashboard. A secret can be typed only there, so it never crosses the network.'
    : 'Answer this in a browser on the machine that runs this dashboard. Machines can be linked only from there.';
}

function MachineLinkRequestBody({
  label,
  hint,
  canAnswer,
  elsewhereText,
  sending,
  onLink,
  onDismiss,
}: {
  label: string;
  hint: string;
  canAnswer: boolean;
  elsewhereText: string;
  sending: boolean;
  onLink: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <p className={styles.prompt}>{label} asks you to link a machine: {hint}</p>
      {canAnswer ? (
        <div className={styles.requestActions}>
          <button type="button" className={styles.answer} disabled={sending} onClick={onLink}>
            Link a machine…
          </button>
          <button type="button" className={styles.answer} disabled={sending} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      ) : (
        <p className={styles.meta}>{elsewhereText}</p>
      )}
    </>
  );
}

/** The answer body for one agent request: the prompt/hint and, for a root-session viewer, the controls to answer it. */
export function AgentRequestAnswer({
  decision,
  onAnswered,
  onLinkOpened,
}: {
  decision: Decision;
  /** Called after a successful POST, before the `['agent-requests']` invalidate resolves. */
  onAnswered?: (outcome: 'sent' | 'declined') => void;
  /** Called right after `openAnywhereDialog('link-machine', …)`. */
  onLinkOpened?: () => void;
}) {
  const request = decision.agentRequest;
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus });
  const canAnswer = status?.viewer?.kind === 'root-session';
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!request) return null;
  const base = `/api/agent-requests/${encodeURIComponent(request.id)}`;

  async function answer(path: string, body: Record<string, unknown>, outcome: 'sent' | 'declined') {
    setSending(true);
    setError(null);
    try {
      const failure = await postAnswer(path, body);
      if (failure) setError(failure);
      else {
        onAnswered?.(outcome);
        await queryClient.invalidateQueries({ queryKey: ['agent-requests'] });
      }
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
    void answer(`${base}/secret`, { value }, 'sent');
  }

  const elsewhereText = agentRequestElsewhereText(request.kind, status?.machine?.label);

  return (
    <>
      {request.kind === 'machine-link' ? (
        <MachineLinkRequestBody
          label={decision.label}
          hint={request.hint}
          canAnswer={canAnswer}
          elsewhereText={elsewhereText}
          sending={sending}
          onLink={() => {
            openAnywhereDialog('link-machine', { agentRequestId: request.id });
            onLinkOpened?.();
          }}
          onDismiss={() => void answer(`${base}/decline`, {}, 'declined')}
        />
      ) : (
        <>
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
              <button type="button" className={styles.answer} disabled={sending} onClick={() => void answer(`${base}/decline`, {}, 'declined')}>
                Decline
              </button>
            </form>
          ) : (
            <p className={styles.meta}>{elsewhereText}</p>
          )}
        </>
      )}
      {error && <p role="alert" className={styles.meta}>{error}</p>}
    </>
  );
}

export function AgentRequestCard({ decision }: { decision: Decision }) {
  if (!decision.agentRequest) return null;
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
        <AgentRequestAnswer decision={decision} />
      </div>
    </div>
  );
}
