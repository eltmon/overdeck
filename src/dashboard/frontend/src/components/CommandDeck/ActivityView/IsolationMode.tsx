import { useRef, useEffect } from 'react';
import styles from '../styles/command-deck.module.css';
import { ChatMarkdown } from '../../chat/ChatMarkdown';

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
  work: styles.typeWork,
  review: styles.typeReview,
  test: styles.typeTest,
  merge: styles.typeMerge,
};

function formatModel(model: string): string {
  if (!model || model === 'unknown') return '';
  return model
    .replace('claude-opus-4-6', 'Opus 4.6')
    .replace('claude-sonnet-4-5-20250929', 'Sonnet 4.5')
    .replace('claude-haiku-4-5-20251001', 'Haiku 4.5')
    .replace('claude-', '')
    .replace('specialist', '');
}

export function IsolationMode({ section, onClose }: IsolationModeProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Tail-anchored scroll for running
  useEffect(() => {
    if (section.status === 'running' && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [section.transcript, section.status]);

  // Browser back button support via pushState
  useEffect(() => {
    history.pushState({ isolation: true }, '');
    const handlePopState = () => {
      onClose();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onClose]);

  return (
    <div className={styles.isolationOverlay}>
      <div className={styles.isolationHeader}>
        <button className={styles.isolationClose} onClick={onClose}>
          <kbd className={styles.kbdHint}>Esc</kbd> Close
        </button>
        <span className={`${styles.sectionType} ${TYPE_STYLES[section.type] || ''}`}>
          {section.type}
        </span>
        {formatModel(section.model) && (
          <span className={styles.sectionModel}>{formatModel(section.model)}</span>
        )}
        <span className={styles.sectionTime}>{section.sessionId}</span>
      </div>
      <div ref={contentRef} className={styles.isolationContent}>
        {section.transcript
          ? <ChatMarkdown text={section.transcript} isStreaming={section.status === 'running'} />
          : '(no output)'}
      </div>
    </div>
  );
}
