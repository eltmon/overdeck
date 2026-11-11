/**
 * BackendRestartCard: the conversations a terminal-backend restart left
 * stopped, in Needs you (PAN-5091). Non-blocking and in the "System" group:
 * Overdeck never resumes them by itself, because relaunching many harnesses
 * into a host that just ran out of memory can cause the same OOM again.
 * Resume all resumes them one at a time and waits while memory pressure is
 * high; the server skips any conversation paused, held, or stopped on purpose.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Decision } from '../lib/useDecisions';
import { BACKEND_RESTART_RECOVERY_QUERY_KEY, postBackendRestartRecovery } from '../lib/backendRestartRecovery';
import styles from './styles/decisions.module.css';

/** The card lists this many conversations by name, then a count of the rest. */
const LISTED_CONVERSATIONS = 8;

function runLine(run: NonNullable<NonNullable<Decision['backendRestart']>['run']>): string {
  if (run.state === 'running') {
    if (run.waitingForMemory) return 'Waiting for memory pressure to fall before the next resume.';
    return run.current ? `Resuming ${run.current} (${run.results.length + 1} so far).` : 'Resuming…';
  }
  const count = (outcome: string) => run.results.filter((result) => result.outcome === outcome).length;
  const parts = [`${count('resumed')} resumed`];
  if (count('already-running')) parts.push(`${count('already-running')} already running`);
  if (count('skipped')) parts.push(`${count('skipped')} skipped`);
  if (count('failed')) parts.push(`${count('failed')} failed`);
  return `Last Resume all: ${parts.join(', ')}.`;
}

export function BackendRestartCard({ decision }: { decision: Decision }) {
  const snapshot = decision.backendRestart;
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!snapshot) return null;
  const running = snapshot.run?.state === 'running';
  const failures = snapshot.run?.results.filter((result) => result.outcome === 'failed') ?? [];
  const listed = snapshot.conversations.slice(0, LISTED_CONVERSATIONS);
  const unlisted = snapshot.conversations.length - listed.length;

  async function act(action: 'resume-all' | 'dismiss') {
    setSending(true);
    setError(await postBackendRestartRecovery(action));
    await queryClient.invalidateQueries({ queryKey: BACKEND_RESTART_RECOVERY_QUERY_KEY });
    setSending(false);
  }

  return (
    <div className={styles.row} data-testid="backend-restart-card" data-decision-id={decision.id}>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.badge}>{decision.label}</span>
        </div>
        {listed.length > 0 && (
          <p className={styles.prompt}>
            {listed.map((conv) => conv.title || conv.name).join(', ')}
            {unlisted > 0 ? `, and ${unlisted} more` : ''}
          </p>
        )}
        {snapshot.run && <p className={styles.meta} data-testid="backend-restart-run">{runLine(snapshot.run)}</p>}
        {!running && failures.map((failure) => (
          <p key={failure.name} className={styles.meta}>
            <span className={styles.mono}>{failure.name}</span>: {failure.reason ?? 'failed'}
          </p>
        ))}
        <p className={styles.meta}>
          Overdeck does not resume these by itself. Resume all starts them one at a time and waits while memory
          pressure is high. It skips conversations that are paused, held, or stopped on purpose.
        </p>
        <div className={styles.secretForm}>
          <button
            type="button"
            className={styles.answer}
            disabled={sending || running || snapshot.conversations.length === 0}
            onClick={() => void act('resume-all')}
          >
            Resume all
          </button>
          <button type="button" className={styles.answer} disabled={sending || running} onClick={() => void act('dismiss')}>
            Dismiss
          </button>
        </div>
        {error && <p role="alert" className={styles.meta}>{error}</p>}
      </div>
    </div>
  );
}
