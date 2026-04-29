import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2, ChevronRight, ChevronDown, GripHorizontal, Terminal, FileText, MessageSquare } from 'lucide-react';
import styles from '../styles/command-deck.module.css';
import { XTerminal } from '../../XTerminal';
import { ConversationPanel } from '../../chat/ConversationPanel';
import { ChatMarkdown } from '../../chat/ChatMarkdown';
import type { Conversation } from '../ConversationList';

interface ActivitySection {
  type: string;
  sessionId: string;
  model: string;
  startedAt: string;
  duration: number | null;
  status: string;
  transcript: string;
  /** tmux session name to stream live — present when status is 'running' */
  tmuxSession?: string;
}

interface AgentSectionProps {
  section: ActivitySection;
  isUnread: boolean;
  onClick: () => void;
  cost?: number;
  defaultExpanded?: boolean;
}

const TYPE_STYLES: Record<string, string> = {
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

type ViewMode = 'transcript' | 'terminal' | 'conversation';

export function AgentSection({ section, isUnread, onClick, cost, defaultExpanded = false }: AgentSectionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Default to conversation view when specialist is stopped (has a session to render)
  const isSpecialist = section.sessionId?.startsWith('specialist-');
  const isStopped = section.status !== 'running';
  const [viewMode, setViewMode] = useState<ViewMode>(
    isSpecialist && isStopped ? 'conversation' : 'transcript'
  );

  // Build a Conversation object for stopped specialists so ConversationPanel can fetch the JSONL
  const specialistConversation = useMemo<Conversation | null>(() => {
    if (!isSpecialist) return null;
    return {
      id: 0,
      name: section.sessionId,
      tmuxSession: section.sessionId,
      status: isStopped ? 'ended' : 'active',
      cwd: '',
      issueId: null,
      createdAt: section.startedAt || new Date().toISOString(),
      endedAt: isStopped ? new Date().toISOString() : null,
      lastAttachedAt: null,
      sessionAlive: !isStopped,
      sessionFile: null, // Backend resolves from specialist .session file
    };
  }, [isSpecialist, section.sessionId, section.startedAt, isStopped]);
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

  // Scroll to bottom: tail-follow when running, and on initial transcript view
  useEffect(() => {
    const shouldScroll =
      (section.status === 'running' && viewMode === 'transcript') ||
      (viewMode === 'transcript' && expanded);
    if (contentRef.current && shouldScroll) {
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
      });
    }
  }, [section.transcript, section.status, expanded, viewMode]);

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

  const accentColor = TYPE_ACCENT_COLORS[section.type] || 'var(--border)';
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
            <ChevronDown size={12} style={{ color: 'var(--muted-foreground)' }} />
          ) : (
            <ChevronRight size={12} style={{ color: 'var(--muted-foreground)' }} />
          )}
        </span>

        {section.status === 'running' ? (
          <Loader2 size={12} className={styles.spinning} style={{ color: 'var(--success)', flexShrink: 0 }} />
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

        {/* View toggle — only shown when specialist session is live */}
        {section.tmuxSession && (
          <div className={styles.viewToggle} onClick={e => e.stopPropagation()}>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === 'transcript' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('transcript')}
            >
              Transcript
            </button>
            <button
              className={`${styles.viewToggleBtn} ${viewMode === 'terminal' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('terminal')}
            >
              Terminal
            </button>
          </div>
        )}
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
          {/* View toggle — Conversation/Transcript/Terminal */}
          {(section.tmuxSession || (isSpecialist && specialistConversation)) && (
            <div className={styles.viewToggle} onClick={e => e.stopPropagation()}>
              {isSpecialist && specialistConversation && (
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === 'conversation' ? styles.viewToggleBtnActive : ''}`}
                  onClick={() => setViewMode('conversation')}
                >
                  <MessageSquare size={11} />
                  Conversation
                </button>
              )}
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'transcript' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('transcript')}
              >
                <FileText size={11} />
                Transcript
              </button>
              {section.tmuxSession && (
                <button
                  className={`${styles.viewToggleBtn} ${viewMode === 'terminal' ? styles.viewToggleBtnActive : ''}`}
                  onClick={() => setViewMode('terminal')}
                >
                  <Terminal size={11} />
                  Terminal
                </button>
              )}
            </div>
          )}

          {/* Content view — conditional rendering (xterm.js crashes with visibility:hidden) */}
          {viewMode === 'terminal' && section.tmuxSession ? (
            <div ref={contentRef} className={contentClass} style={{ ...contentStyle, padding: 0, overflow: 'hidden' }}>
              <XTerminal sessionName={section.tmuxSession} />
            </div>
          ) : viewMode === 'conversation' && specialistConversation ? (
            <div ref={contentRef} className={contentClass} style={{ ...contentStyle, padding: 0, overflow: 'hidden' }}>
              <ConversationPanel conversation={specialistConversation} />
            </div>
          ) : (
            <div
              ref={contentRef}
              className={contentClass}
              style={contentStyle}
            >
              {section.transcript
                ? <ChatMarkdown text={section.transcript} isStreaming={section.status === 'running'} />
                : '(no output yet)'}
            </div>
          )}

          {/* Resize handle — drag to constrain, double-click to toggle */}
          <div
            className={styles.sectionResizeHandle}
            onMouseDown={handleResizeMouseDown}
            onDoubleClick={handleResizeDoubleClick}
            title={isConstrained ? 'Drag to resize, double-click to unconstrain' : 'Drag to constrain height, double-click to set default'}
          >
            <GripHorizontal size={12} style={{ color: 'var(--muted-foreground)', opacity: isConstrained ? 0.8 : 0.4 }} />
          </div>
        </>
      )}
    </div>
  );
}
