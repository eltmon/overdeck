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

interface IsolationModeProps {
  section: ActivitySection;
  onClose: () => void;
}

const TYPE_STYLES: Record<string, string> = {
  planning: styles.typePlanning,
  work: styles.typeWork,
  review: styles.typeReview,
  test: styles.typeTest,
  merge: styles.typeMerge,
};

export function IsolationMode({ section, onClose }: IsolationModeProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Tail-anchored scroll for running
  useEffect(() => {
    if (section.status === 'running' && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [section.transcript, section.status]);

  return (
    <div className={styles.isolationOverlay}>
      <div className={styles.isolationHeader}>
        <button className={styles.isolationClose} onClick={onClose}>
          Esc to close
        </button>
        <span className={`${styles.sectionType} ${TYPE_STYLES[section.type] || ''}`}>
          {section.type}
        </span>
        <span className={styles.sectionModel}>{section.model}</span>
        <span className={styles.sectionTime}>{section.sessionId}</span>
      </div>
      <div ref={contentRef} className={styles.isolationContent}>
        {section.transcript || '(no output)'}
      </div>
    </div>
  );
}
