import { useState, type MouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import type { UatStackSummary } from '../UatStackStatus';
import type { WorkspaceStackHealth } from '../ZoneCOverviewTabs/queries';
import styles from '../styles/command-deck.module.css';

/**
 * FeatureAppLink — 'app ↗' chip on an expanded issue tree row linking to the
 * workspace's frontend URL (e.g. https://feature-min-850.myn.localhost).
 * The link renders only while the Docker stack is live (healthy/starting):
 * gating on live stack state, not phase, is what keeps PAN-2996's bogus
 * planning-phase chip from recurring. While the app was stopped on purpose
 * (an idle stop or memory reclaim, `stackHealth.reclaimed`) or the whole
 * stack is stopped, the row offers a 'start app' button instead (PAN-5649):
 * it opens the app URL, whose wake page waits for the app, and asks the
 * dashboard to start the stack.
 */
/** Merge-ready UAT stack-state chip (extracted verbatim from FeatureItem). */
export function FeatureUatChip({ summary }: { summary: UatStackSummary | null }) {
  if (!summary) return null;
  return (
    <span
      className={`${styles.featureBadge} ${summary.active ? styles.featureBadge_paused : styles.featureBadge_running}`}
      data-testid="feature-uat-stack"
      title="UAT workspace Docker stack status"
    >
      {`UAT ${summary.state === 'stale' ? 'idle' : summary.state}`}
    </span>
  );
}

export function FeatureAppLink({ issueId, frontendUrl, summary, stackHealth }: {
  issueId: string;
  frontendUrl?: string;
  summary: UatStackSummary | null;
  stackHealth?: WorkspaceStackHealth;
}) {
  if (!frontendUrl) return null;
  const stoppedOnPurpose = (stackHealth?.reclaimed?.length ?? 0) > 0;
  if (stoppedOnPurpose || summary?.state === 'stopped') {
    return <StartAppButton issueId={issueId} frontendUrl={frontendUrl} />;
  }
  const live = summary?.state === 'healthy' || summary?.state === 'starting';
  if (!live) return null;
  return (
    <a
      href={frontendUrl}
      target="_blank"
      rel="noreferrer"
      className={styles.featureBadge}
      data-testid="feature-open-frontend"
      title={`Open ${frontendUrl}`}
      onClick={(e) => e.stopPropagation()}
    >
      app ↗
    </a>
  );
}

type WakeOutcome = { ok: true; started: string[] } | { ok: false; error: string };

/**
 * POSTs the wake route and never rejects. Kept outside the component: the React
 * Compiler cannot compile a try/finally inside one (reactCompilerCoverage).
 */
async function postWorkspaceWake(issueId: string): Promise<WakeOutcome> {
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(issueId)}/wake`, {
      method: 'POST',
      headers: await dashboardMutationJsonHeaders(),
      body: '{}',
    });
    const body = await response.json().catch(() => ({})) as { error?: unknown; started?: unknown };
    if (!response.ok) {
      return { ok: false, error: typeof body.error === 'string' ? body.error : `Starting ${issueId} failed (${response.status})` };
    }
    const started = Array.isArray(body.started) ? body.started.filter((name): name is string => typeof name === 'string') : [];
    return { ok: true, started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `Starting ${issueId} failed` };
  }
}

/** PAN-5649: opens the app tab first (inside the click, so it is not a blocked popup), then wakes the stack. */
function StartAppButton({ issueId, frontendUrl }: { issueId: string; frontendUrl: string }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    window.open(frontendUrl, '_blank', 'noopener,noreferrer');
    setPending(true);
    void postWorkspaceWake(issueId).then((outcome) => {
      setPending(false);
      if (outcome.ok) {
        toast.success(outcome.started.length > 0 ? `Started ${outcome.started.join(', ')}` : `${issueId} app is already running`);
        void queryClient.invalidateQueries({ queryKey: ['workspace', issueId] });
      } else {
        toast.error(outcome.error);
      }
    });
  };

  return (
    <button
      type="button"
      className={styles.featureBadge}
      data-testid="feature-start-app"
      title={`Start ${issueId}'s stopped app containers and open ${frontendUrl}`}
      disabled={pending}
      onClick={onClick}
    >
      {pending ? 'starting…' : 'start app'}
    </button>
  );
}
