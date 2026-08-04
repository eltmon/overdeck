import type { SyntheticEvent } from 'react';
import { deriveProjectCi, type ProjectCiState } from '@overdeck/contracts';
import { selectProjectCi, useDashboardStore } from '../../lib/store';
import styles from './styles/command-deck.module.css';

const STATE_COLOR: Record<ProjectCiState, string> = {
  queued: 'var(--muted-foreground)',
  in_progress: 'var(--info)',
  success: 'var(--muted-foreground)',
  failure: 'var(--destructive)',
};

export function ProjectCiChip({ projectKey }: { projectKey: string }) {
  const record = useDashboardStore(selectProjectCi(projectKey));
  if (!record || Object.keys(record.suites).length === 0) return null;

  const { state, completed, total, href } = deriveProjectCi(record);
  const label = state === 'success' ? 'CI' : state === 'failure' ? 'CI ✗' : `CI ${completed}/${total}`;
  const open = (event: SyntheticEvent) => {
    event.stopPropagation();
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <span
      role="link"
      tabIndex={0}
      data-testid="project-ci-chip"
      data-ci-state={state}
      className={styles.projectCiChip}
      style={{ color: STATE_COLOR[state] }}
      title={`${record.branch} @ ${record.headSha.slice(0, 7)} — ${state} (${completed}/${total} workflows)`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open(event);
      }}
    >
      {label}
    </span>
  );
}
