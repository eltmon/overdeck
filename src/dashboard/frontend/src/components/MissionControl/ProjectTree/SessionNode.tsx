import type { SessionNode as SessionNodeType } from '@panopticon/contracts';
import styles from '../styles/mission-control.module.css';

interface SessionNodeProps {
  session: SessionNodeType;
  isSelected?: boolean;
  onClick?: () => void;
}

function PresenceDot({ presence }: { presence: SessionNodeType['presence'] }) {
  if (presence === 'active') {
    return (
      <span className={styles.sessionPresence}>
        <svg
          className={styles.sessionPresenceSpinner}
          width="10"
          height="10"
          viewBox="0 0 10 10"
        >
          <circle
            cx="5"
            cy="5"
            r="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="16"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  const className =
    presence === 'idle'
      ? styles.sessionPresenceIdle
      : styles.sessionPresenceEnded;

  return <span className={`${styles.sessionPresence} ${className}`} />;
}

function TypeBadge({ type, role }: { type: SessionNodeType['type']; role?: string }) {
  const label = role && type === 'reviewer' ? `${type}:${role}` : type;
  return <span className={styles.sessionTypeBadge}>{label}</span>;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function SessionNode({ session, isSelected, onClick }: SessionNodeProps) {
  return (
    <button
      className={`${styles.sessionNode} ${isSelected ? styles.sessionNodeSelected : ''}`}
      onClick={onClick}
    >
      <PresenceDot presence={session.presence} />
      <TypeBadge type={session.type} role={session.role} />
      <span className={styles.sessionId} title={session.sessionId}>
        {session.sessionId}
      </span>
      <span className={styles.sessionModel} title={session.model}>
        {session.model}
      </span>
      <span className={styles.sessionStatus}>{session.status}</span>
      <span className={styles.sessionDuration}>{formatDuration(session.duration)}</span>
    </button>
  );
}
