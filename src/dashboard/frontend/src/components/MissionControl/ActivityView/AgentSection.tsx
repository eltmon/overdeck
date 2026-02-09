import { useRef, useEffect } from 'react';
import styles from '../styles/mission-control.module.css';

interface ActivitySection {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  transcript: string;
}

interface AgentSectionProps {
  section: ActivitySection;
  isUnread: boolean;
  onClick: () => void;
}

const TYPE_STYLES: Record<string, string> = {
  planning: styles.typePlanning,
  work: styles.typeWork,
  review: styles.typeReview,
  test: styles.typeTest,
  merge: styles.typeMerge,
};

const STATUS_STYLES: Record<string, string> = {
  running: styles.statusRunning,
  completed: styles.statusCompleted,
  failed: styles.statusFailed,
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatModel(model: string): string {
  if (!model || model === 'unknown') return '';
  // Shorten common model names
  return model
    .replace('claude-opus-4-6', 'Opus 4.6')
    .replace('claude-sonnet-4-5-20250929', 'Sonnet 4.5')
    .replace('claude-haiku-4-5-20251001', 'Haiku 4.5')
    .replace('claude-', '')
    .replace('specialist', '');
}

export function AgentSection({ section, isUnread, onClick }: AgentSectionProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Tail-anchored scrolling: always scroll to bottom on initial render and for running sections
  const hasInitialScrolled = useRef(false);
  useEffect(() => {
    if (contentRef.current) {
      if (!hasInitialScrolled.current || section.status === 'running') {
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        });
        hasInitialScrolled.current = true;
      }
    }
  }, [section.transcript, section.status]);

  return (
    <div className={styles.agentSection}>
      <div className={styles.sectionHeader} onClick={onClick} title="Click to focus this section">
        <div className={`${styles.sectionStatus} ${STATUS_STYLES[section.status] || styles.statusCompleted}`} />
        <span className={`${styles.sectionType} ${TYPE_STYLES[section.type] || ''}`}>
          {section.type}
        </span>
        {formatModel(section.model) && (
          <span className={styles.sectionModel}>{formatModel(section.model)}</span>
        )}
        <span className={styles.sectionTime}>
          {formatTime(section.startedAt)}
          {section.duration !== null && ` (${formatDuration(section.duration)})`}
        </span>
        {isUnread && <div className={styles.unreadDot} />}
      </div>
      <div ref={contentRef} className={styles.sectionContent}>
        {section.transcript || '(no output yet)'}
      </div>
    </div>
  );
}
