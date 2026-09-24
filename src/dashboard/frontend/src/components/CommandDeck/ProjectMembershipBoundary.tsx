import type { ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { recoveryRetryDelayMs } from '../../lib/queryRecovery';
import {
  fetchProjectPipelineMembership,
  isMembershipTransientError,
  refreshProjectPipelineMembership,
  NO_PROJECT_KEY,
} from './projectsData';
import styles from './styles/command-deck.module.css';

/**
 * PAN-3527 — delay before re-reading membership after a transient failure:
 * exponential backoff capped at 30s, never sooner than the server's
 * Retry-After hint.
 */
export function membershipRetryDelayMs(failureCount: number, error: unknown): number {
  const backoff = recoveryRetryDelayMs(failureCount);
  return isMembershipTransientError(error) && error.retryAfterMs !== undefined
    ? Math.max(backoff, error.retryAfterMs)
    : backoff;
}

interface ProjectMembershipBoundaryProps {
  selectedProject: string | null;
  projectKey?: string;
  projectName?: string;
  loading: boolean;
  disabled: boolean;
  children: ReactNode;
}

export function ProjectMembershipBoundary({
  selectedProject,
  projectKey,
  projectName,
  loading,
  disabled,
  children,
}: ProjectMembershipBoundaryProps) {
  const membership = useQuery({
    queryKey: ['project-pipeline-membership', projectKey],
    queryFn: ({ signal }) => fetchProjectPipelineMembership(projectKey!, signal),
    enabled: Boolean(projectKey && selectedProject !== NO_PROJECT_KEY && !disabled),
    // PAN-3527: a transient failure (snapshot still loading after a restart,
    // request never answered, proxy error) is not an answer about the project.
    // Keep retrying it with backoff instead of settling it as the error
    // banner; while it retries the query keeps its last good result. A settled
    // answer (typed `unavailable`, other HTTP errors) surfaces at once.
    // A backend reconnect also refetches this key (lib/queryRecovery.ts).
    retry: (_failureCount, error) => isMembershipTransientError(error),
    retryDelay: membershipRetryDelayMs,
  });
  const transientFailure = isMembershipTransientError(membership.failureReason)
    ? membership.failureReason
    : null;

  // PAN-2972 — the GET above only reads the server's snapshot, so on a cold
  // cache a plain refetch can never succeed. Retry forces a server-side
  // re-gather, then refetches the snapshot it just populated.
  const retryMembership = useMutation({
    mutationFn: () => refreshProjectPipelineMembership(projectKey!),
    onSettled: () => void membership.refetch(),
  });

  if (!selectedProject) {
    return <div className={styles.emptyProject}>Select a project to see its issues</div>;
  }

  if (loading) {
    return (
      <div className={styles.skeletonList}>
        <div className={styles.skeletonItem} style={{ width: '60%' }} />
        <div className={styles.skeletonItem} style={{ width: '80%' }} />
        <div className={styles.skeletonItem} style={{ width: '45%' }} />
      </div>
    );
  }

  return (
    <>
      {transientFailure ? (
        <div className={styles.membershipStatus} role="status">
          Pipeline membership is temporarily unavailable ({transientFailure.message}). Retrying automatically…{' '}
          {/* Transient retries never settle, so keep the forced re-gather
              reachable in case the server's snapshot warm-up is wedged. */}
          <button
            type="button"
            className={styles.membershipErrorRetry}
            onClick={() => retryMembership.mutate()}
            disabled={retryMembership.isPending}
          >
            {retryMembership.isPending ? 'Retrying…' : 'Retry membership'}
          </button>
        </div>
      ) : membership.isLoading && (
        <div className={styles.membershipStatus} role="status">
          Refreshing pipeline membership…
        </div>
      )}
      {membership.isError && (
        <div className={styles.membershipError} role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div className={styles.membershipErrorContent}>
            <p>
              Pipeline membership determines which issues appear here. It could not be loaded for{' '}
              <strong>{projectName ?? selectedProject}</strong>, so this issue list may be incomplete.
            </p>
            <p className={styles.membershipErrorDetail}>
              {retryMembership.error instanceof Error
                ? retryMembership.error.message
                : membership.error instanceof Error
                  ? membership.error.message
                  : 'Pipeline membership could not be loaded'}
            </p>
            <button
              type="button"
              className={styles.membershipErrorRetry}
              onClick={() => retryMembership.mutate()}
              disabled={retryMembership.isPending}
            >
              {retryMembership.isPending ? 'Retrying…' : 'Retry membership'}
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
