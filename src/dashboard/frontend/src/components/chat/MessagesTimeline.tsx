/**
 * MessagesTimeline (PAN-451)
 *
 * Virtualized scrolling message display for the conversation view.
 * Mirrors T3Code's MessagesTimeline pattern using @tanstack/react-virtual.
 *
 * Renders three row types:
 *   - user messages    → right-aligned bubble
 *   - assistant msgs   → left-aligned via ChatMarkdown
 *   - work log groups  → collapsible tool-call list
 *   - working          → animated dot indicator
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  memo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Circle, Bot, GitBranchPlus } from 'lucide-react';
import type { WorkLogEntry } from './chat-types';
import { ChatMarkdown } from './ChatMarkdown';
import {
  deriveTimelineEntries,
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  type MessagesTimelineRow,
} from './session-logic';
import type { ChatMessage } from './chat-types';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;
const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;
const AUTO_SCROLL_THRESHOLD_PX = 64;

/** Format an ISO timestamp as a short time string (e.g., "3:42 PM"). */
function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Format elapsed duration between two ISO timestamps (e.g., "1.5s", "2m 30s"). */
function formatElapsed(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MessagesTimelineProps {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MessagesTimeline = memo(function MessagesTimeline({
  messages,
  workLog,
  streaming,
}: MessagesTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  // Track whether user has manually scrolled up
  const isPinnedToBottomRef = useRef(true);
  // Visible state for scroll-to-bottom button
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const timelineEntries = deriveTimelineEntries(messages, workLog);
  const rows = deriveMessagesTimelineRows(timelineEntries, streaming);

  // Split: virtualize all but the last N rows
  const firstUnvirtIdx = Math.max(0, rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS);
  const virtualRows = rows.slice(0, firstUnvirtIdx);
  const tailRows = rows.slice(firstUnvirtIdx);

  const widthKey = `width:${Math.round(width)}`;

  const rowVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index) => `${widthKey}:${virtualRows[index]!.id}`,
    estimateSize: (index) =>
      estimateMessagesTimelineRowHeight(virtualRows[index]!, width),
    measureElement: (el) => el.getBoundingClientRect().height,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });

  // Observe container width for height estimation accuracy
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll when inner content grows (e.g. AI streaming text into existing row)
  // This fires on every height change, complementing the row-count-based effect below.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (isPinnedToBottomRef.current && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to bottom when row count changes (new message added)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isPinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [rows.length, streaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isPinnedToBottomRef.current = true;
    setShowScrollToBottom(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    const atBottom = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
    isPinnedToBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
  }, []);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const dedupedVirtualItems = (() => {
    const seen = new Set<number>();
    return virtualItems.filter((item) => {
      if (seen.has(item.index)) return false;
      seen.add(item.index);
      return true;
    });
  })();

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={scrollContainerRef}
        className={styles.messagesTimeline}
        onScroll={handleScroll}
        style={{ flex: 1 }}
      >
      <div ref={innerRef} className={styles.messagesTimelineInner}>
        {/* Virtual section — absolutely positioned rows */}
        {virtualRows.length > 0 && (
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
          >
            {dedupedVirtualItems.map((virtualItem) => {
              const row = virtualRows[virtualItem.index]!;
              return (
                <div
                  key={row.id}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <TimelineRowRenderer row={row} isStreaming={streaming} />
                </div>
              );
            })}
          </div>
        )}

        {/* Non-virtual tail rows — normal flow */}
        {tailRows.map((row) => (
          <TimelineRowRenderer key={row.id} row={row} isStreaming={streaming} />
        ))}
      </div>
    </div>

    {/* Scroll-to-bottom button — appears when user has scrolled up */}
    {showScrollToBottom && (
      <button
        onClick={scrollToBottom}
        style={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 12px',
          background: 'var(--color-primary)',
          color: 'var(--color-primary-foreground)',
          border: 'none',
          borderRadius: 20,
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          opacity: 0.95,
        }}
        title="Scroll to bottom"
      >
        <ChevronDown size={14} />
        Bottom
      </button>
    )}
    </div>
  );
});

// ─── Row renderer ─────────────────────────────────────────────────────────────

interface RowProps {
  row: MessagesTimelineRow;
  isStreaming: boolean;
}

const TimelineRowRenderer = memo(function TimelineRowRenderer({ row, isStreaming }: RowProps) {
  if (row.kind === 'working') {
    return <WorkingIndicator startedAt={row.createdAt} />;
  }
  if (row.kind === 'work') {
    return <WorkLogGroup entries={row.groupedEntries} />;
  }
  if (row.message.role === 'user') {
    return <UserMessageRow message={row.message} />;
  }
  return <AssistantMessageRow message={row.message} isStreaming={isStreaming} />;
});

// ─── User message ─────────────────────────────────────────────────────────────

function isSummaryForkMessage(text: string): boolean {
  return text.startsWith('## Conversation Summary Fork') ||
    text.includes('**Do not take any action.** This is context from a prior conversation fork');
}

function UserMessageRow({ message }: { message: ChatMessage }) {
  if (isSummaryForkMessage(message.text)) {
    return <ContextMessageBlock message={message} />;
  }

  const isPending = message.id.startsWith('optimistic-');
  return (
    <div className={styles.userMessageRow}>
      <div
        className={styles.userMessageBubble}
        style={isPending ? { opacity: 0.6 } : undefined}
        title={isPending ? 'Pending — waiting for agent to process' : undefined}
      >
        <p className={styles.userMessageText}>{message.text}</p>
        <span className={styles.messageTimestamp}>
          {isPending ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <svg style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: 'var(--mc-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Sending…
            </span>
          ) : (
            formatTimestamp(message.createdAt)
          )}
        </span>
      </div>
    </div>
  );
}

function ContextMessageBlock({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const cleanText = message.text
    .replace(/\n---\n\n\*\*Do not take any action\.\*\*.*$/s, '')
    .trim();

  return (
    <div className={styles.contextMessageRow}>
      <div className={styles.contextMessageBlock}>
        <button
          type="button"
          className={styles.contextMessageToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          <GitBranchPlus size={14} className={styles.contextMessageIcon} />
          <span className={styles.contextMessageLabel}>Conversation Fork Summary</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {expanded && (
          <div className={styles.contextMessageContent}>
            <ChatMarkdown text={cleanText} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Assistant message ────────────────────────────────────────────────────────

function AssistantMessageRow({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming: boolean;
}) {
  const duration = message.completedAt
    ? formatElapsed(message.createdAt, message.completedAt)
    : null;

  return (
    <div className={styles.assistantMessageRow}>
      <Bot size={14} className={styles.assistantMessageAvatar} aria-hidden="true" />
      <div className={styles.assistantMessageContent}>
        <ChatMarkdown text={message.text} isStreaming={isStreaming && !message.completedAt} />
        <div className={styles.messageMetadata}>
          <span className={styles.messageTimestamp}>
            {formatTimestamp(message.createdAt)}
          </span>
          {duration && (
            <>
              <span className={styles.messageSeparator}>&middot;</span>
              <span className={styles.messageTimestamp}>{duration}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Work log group ───────────────────────────────────────────────────────────

function WorkLogGroup({ entries }: { entries: WorkLogEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? entries : entries.slice(0, MAX_VISIBLE_WORK_LOG_ENTRIES);
  const hasOverflow = entries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;

  return (
    <div className={styles.workLogGroup}>
      {visible.map((entry) => (
        <WorkLogEntryRow key={entry.id} entry={entry} />
      ))}
      {hasOverflow && !expanded && (
        <button
          className={styles.workLogExpandBtn}
          onClick={() => setExpanded(true)}
        >
          <ChevronRight size={12} />
          Show {entries.length - MAX_VISIBLE_WORK_LOG_ENTRIES} more
        </button>
      )}
      {expanded && (
        <button
          className={styles.workLogExpandBtn}
          onClick={() => setExpanded(false)}
        >
          <ChevronDown size={12} />
          Collapse
        </button>
      )}
    </div>
  );
}

const TERMINAL_TOOLS = new Set(['Bash', 'bash', 'terminal', 'shell']);

function WorkLogEntryRow({ entry }: { entry: WorkLogEntry }) {
  const [showResult, setShowResult] = useState(false);
  const toneColor: Record<WorkLogEntry['tone'], string> = {
    thinking: 'var(--mc-text-secondary)',
    tool: 'var(--mc-accent)',
    info: 'var(--mc-success)',
    error: 'var(--mc-error)',
  };

  const isTerminal = TERMINAL_TOOLS.has(entry.toolTitle ?? entry.label);
  const hasResult = !!entry.result;

  return (
    <div>
      <div
        className={styles.workLogEntry}
        style={hasResult ? { cursor: 'pointer' } : undefined}
        onClick={hasResult ? () => setShowResult(prev => !prev) : undefined}
      >
        {isTerminal ? (
          <span
            className={styles.workLogTerminalIcon}
            style={{ color: toneColor[entry.tone] }}
          >
            {'>_'}
          </span>
        ) : (
          <Circle
            size={6}
            style={{
              fill: toneColor[entry.tone],
              color: toneColor[entry.tone],
              flexShrink: 0,
              marginTop: 2,
            }}
          />
        )}
        <span className={styles.workLogLabel}>{entry.toolTitle ?? entry.label}</span>
        {entry.detail && (
          <span className={styles.workLogDetail} title={entry.detail}>
            {entry.detail.slice(0, 80)}
            {entry.detail.length > 80 ? '…' : ''}
          </span>
        )}
        {hasResult && (
          <ChevronRight
            size={10}
            style={{
              flexShrink: 0,
              marginLeft: 'auto',
              transition: 'transform 0.15s',
              transform: showResult ? 'rotate(90deg)' : 'none',
              color: 'var(--mc-text-muted)',
            }}
          />
        )}
      </div>
      {showResult && entry.result && (
        isTerminal ? (
          <pre className={styles.workLogResult}>{entry.result}</pre>
        ) : (
          <div className={styles.workLogResult}>
            <ChatMarkdown text={entry.result} />
          </div>
        )
      )}
    </div>
  );
}

// ─── Working indicator ────────────────────────────────────────────────────────

function WorkingIndicator({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  const startMs = startedAt ? new Date(startedAt).getTime() : Date.now();

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startMs]);

  return (
    <div className={styles.workingIndicator}>
      <span className={styles.workingDots}>
        <span />
        <span />
        <span />
      </span>
      <span className={styles.workingLabel}>
        Working{elapsed > 0 ? ` for ${elapsed}s` : '…'}
      </span>
    </div>
  );
}
