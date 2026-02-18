import { useRef, useEffect, useState, useCallback } from 'react';
import { Loader2, ChevronRight, ChevronDown, GripHorizontal } from 'lucide-react';
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
  cost?: number;
  defaultExpanded?: boolean;
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

// Left border accent colors per section type
const TYPE_ACCENT_COLORS: Record<string, string> = {
  planning: '#3B82F6',
  work: '#10B981',
  review: '#F59E0B',
  test: '#6366F1',
  merge: '#EC4899',
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
  return model
    .replace('claude-opus-4-6', 'Opus 4.6')
    .replace('claude-sonnet-4-5-20250929', 'Sonnet 4.5')
    .replace('claude-haiku-4-5-20251001', 'Haiku 4.5')
    .replace('claude-', '')
    .replace('specialist', '');
}

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function getPreviewLine(transcript: string): string {
  if (!transcript) return '(no output yet)';
  const lines = transcript.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '(no output yet)';
  const last = lines[lines.length - 1].trim();
  return last.length > 120 ? last.slice(0, 120) + '...' : last;
}

export function AgentSection({ section, isUnread, onClick, cost, defaultExpanded = false }: AgentSectionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  // null = natural height (no constraint), number = user-set max-height
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Auto-expand running sections
  useEffect(() => {
    if (section.status === 'running') {
      setExpanded(true);
    }
  }, [section.status]);

  // Scroll to bottom only for running sections (tail-follow)
  useEffect(() => {
    if (contentRef.current && expanded && section.status === 'running') {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
      });
    }
  }, [section.transcript, section.status, expanded]);

  // Resize drag handlers — dragging sets a max-height constraint
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startY.current = e.clientY;
    // If no constraint yet, measure natural height as starting point
    startHeight.current = contentRef.current?.offsetHeight || 300;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      const newHeight = Math.max(80, Math.min(2000, startHeight.current + delta));
      setCustomHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Double-click resize handle to toggle between constrained/unconstrained
  const handleResizeDoubleClick = useCallback(() => {
    setCustomHeight(prev => prev === null ? 400 : null);
  }, []);

  const handleHeaderClick = (e: React.MouseEvent) => {
    if (e.button === 1 || e.ctrlKey) {
      onClick();
      return;
    }
    setExpanded(!expanded);
  };

  const accentColor = TYPE_ACCENT_COLORS[section.type] || 'var(--mc-border)';
  const isConstrained = customHeight !== null;

  const contentStyle: React.CSSProperties = {};
  if (isConstrained && expanded) {
    contentStyle.maxHeight = `${customHeight}px`;
  }

  const contentClass = isConstrained
    ? `${styles.sectionContent} ${styles.sectionContentConstrained}`
    : styles.sectionContent;

  return (
    <div
      className={`${styles.agentSection} ${expanded ? styles.agentSectionExpanded : ''}`}
      style={{ borderLeftColor: accentColor }}
    >
      <div
        className={styles.sectionHeader}
        onClick={handleHeaderClick}
        title="Click to expand/collapse, Ctrl+click to isolate"
      >
        <span className={styles.sectionChevron}>
          {expanded ? (
            <ChevronDown size={12} style={{ color: 'var(--mc-text-muted)' }} />
          ) : (
            <ChevronRight size={12} style={{ color: 'var(--mc-text-muted)' }} />
          )}
        </span>

        {section.status === 'running' ? (
          <Loader2 size={12} className={styles.spinning} style={{ color: 'var(--mc-success)', flexShrink: 0 }} />
        ) : (
          <div className={`${styles.sectionStatus} ${STATUS_STYLES[section.status] || styles.statusCompleted}`} />
        )}

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
        {cost !== undefined && cost > 0 && (
          <span className={styles.sectionCost}>{formatCost(cost)}</span>
        )}
        {isUnread && <div className={styles.unreadDot} />}
      </div>

      {/* Preview line when collapsed */}
      {!expanded && (
        <div className={styles.sectionPreview}>
          {getPreviewLine(section.transcript)}
        </div>
      )}

      {/* Full content when expanded */}
      {expanded && (
        <>
          <div
            ref={contentRef}
            className={contentClass}
            style={contentStyle}
          >
            {section.transcript || '(no output yet)'}
          </div>

          {/* Resize handle — drag to constrain, double-click to toggle */}
          <div
            className={styles.sectionResizeHandle}
            onMouseDown={handleResizeMouseDown}
            onDoubleClick={handleResizeDoubleClick}
            title={isConstrained ? 'Drag to resize, double-click to unconstrain' : 'Drag to constrain height, double-click to set default'}
          >
            <GripHorizontal size={12} style={{ color: 'var(--mc-text-muted)', opacity: isConstrained ? 0.8 : 0.4 }} />
          </div>
        </>
      )}
    </div>
  );
}
