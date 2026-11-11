/** PAN-5153: the Command Deck project header names the owner and who acts on the repository. */
import styles from '../styles/command-deck.module.css';
import { findProjectIdentity, useGitHubIdentities } from './useGitHubIdentities';

export function ProjectIdentityChip({ projectKey }: { projectKey: string }) {
  const { data } = useGitHubIdentities();
  const found = findProjectIdentity(data, projectKey);
  if (!found) return null;

  const { owner, project } = found;
  const actor = project.mode === 'none' ? 'not signed in' : project.actor;
  return (
    <span
      data-testid="project-identity-chip"
      data-identity-mode={project.mode}
      className={styles.projectIdentityChip}
      style={{ color: project.mode === 'none' ? 'var(--destructive)' : 'var(--muted-foreground)' }}
      title={project.detail}
    >
      {`${owner} · ${actor}`}
    </span>
  );
}
