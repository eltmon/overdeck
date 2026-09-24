import type { ProjectDeployPhase, ProjectDeploySnapshot } from '@overdeck/contracts';
import { useNow } from '../../hooks/useNow';
import { selectProjectDeploy, useDashboardStore } from '../../lib/store';
import styles from './styles/command-deck.module.css';

// Style guide: in-flight work is info blue, never green; operator-needed is warning.
const PHASE_COLOR: Record<ProjectDeployPhase, string> = {
  building: 'var(--info)',
  'awaiting-approval': 'var(--warning)',
  restarting: 'var(--info)',
  failed: 'var(--destructive)',
};

function elapsed(startIso: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(startIso)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function label(deploy: ProjectDeploySnapshot, now: Date): string {
  switch (deploy.phase) {
    case 'building': return `Deploying ${elapsed(deploy.startedAt, now)}`;
    case 'awaiting-approval': return 'Deploy: approve restart';
    case 'restarting': return 'Deploy: restarting';
    case 'failed': return 'Deploy ✗';
  }
}

function detail(deploy: ProjectDeploySnapshot): string {
  const lines = [`${deploy.trigger} — ${deploy.phase}`];
  if (deploy.phase === 'awaiting-approval') lines.push('Waiting for the operator: use the restart banner to put the build live.');
  if (deploy.error) lines.push(deploy.error);
  if (deploy.logPath) lines.push(`log: ${deploy.logPath}`);
  if (deploy.logTail?.length) lines.push('', ...deploy.logTail);
  return lines.join('\n');
}

function DeployChip({ deploy }: { deploy: ProjectDeploySnapshot }) {
  // Re-renders the elapsed clock only; the deploy itself arrives over /ws/rpc.
  const now = useNow(1_000);
  const text = detail(deploy);
  return (
    <span
      data-testid="project-deploy-chip"
      data-deploy-phase={deploy.phase}
      role="status"
      aria-label={text}
      className={styles.projectDeployChip}
      style={{ color: PHASE_COLOR[deploy.phase] }}
      title={text}
    >
      {label(deploy, now)}
    </span>
  );
}

/** PAN-3751 — the owning project's in-flight deploy (`pan reload`), when there is one. */
export function ProjectDeployChip({ projectKey }: { projectKey: string }) {
  const deploy = useDashboardStore(selectProjectDeploy(projectKey));
  return deploy ? <DeployChip deploy={deploy} /> : null;
}
