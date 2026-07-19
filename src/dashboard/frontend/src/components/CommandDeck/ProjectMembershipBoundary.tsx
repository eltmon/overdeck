import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { fetchProjectPipelineMembership, NO_PROJECT_KEY } from './projectsData';
import styles from './styles/command-deck.module.css';

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
    queryFn: () => fetchProjectPipelineMembership(projectKey!),
    enabled: Boolean(projectKey && selectedProject !== NO_PROJECT_KEY && !disabled),
    retry: false,
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
      {membership.isLoading && (
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
              {membership.error instanceof Error
                ? membership.error.message
                : 'Pipeline membership could not be loaded'}
            </p>
            <button
              type="button"
              className={styles.membershipErrorRetry}
              onClick={() => void membership.refetch()}
            >
              Retry membership
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
