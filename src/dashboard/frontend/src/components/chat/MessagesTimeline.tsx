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
import { ChevronDown, ChevronRight, Circle } from 'lucide-react';
import type { WorkLogEntry } from '@panopticon/contracts';
import { ChatMarkdown } from './ChatMarkdown';
import {
  deriveTimelineEntries,
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  type MessagesTimelineRow,
} from './session-logic';
import type { ChatMessage } from '@panopticon/contracts';
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;
const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;
const AUTO_SCROLL_THRESHOLD_PX = 64;

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
  const [width, setWidth] = useState(800);
  // Track whether user has manually scrolled up
  const isPinnedToBottomRef = useRef(true);

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

  // Auto-scroll to bottom during streaming if user hasn't scrolled up
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isPinnedToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [rows.length, streaming]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    isPinnedToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={scrollContainerRef}
      className={styles.messagesTimeline}
      onScroll={handleScroll}
    >
      {/* Virtual section — absolutely positioned rows */}
      {virtualRows.length > 0 && (
        <div
          style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualItems.map((virtualItem) => {
            const row = virtualRows[virtualItem.index]!;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={(el) => {
                  if (el) rowVirtualizer.measureElement(el);
                }}
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

function UserMessageRow({ message }: { message: ChatMessage }) {
  return (
    <div className={styles.userMessageRow}>
      <div className={styles.userMessageBubble}>
        <p className={styles.userMessageText}>{message.text}</p>
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
  return (
    <div className={styles.assistantMessageRow}>
      <ChatMarkdown text={message.text} isStreaming={isStreaming && !message.completedAt} />
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

function WorkLogEntryRow({ entry }: { entry: WorkLogEntry }) {
  const toneColor: Record<WorkLogEntry['tone'], string> = {
    thinking: 'var(--mc-text-secondary)',
    tool: 'var(--mc-accent)',
    info: 'var(--mc-success)',
    error: 'var(--mc-error)',
  };

  return (
    <div className={styles.workLogEntry}>
      <Circle
        size={6}
        style={{
          fill: toneColor[entry.tone],
          color: toneColor[entry.tone],
          flexShrink: 0,
          marginTop: 2,
        }}
      />
      <span className={styles.workLogLabel}>{entry.toolTitle ?? entry.label}</span>
      {entry.detail && (
        <span className={styles.workLogDetail} title={entry.detail}>
          {entry.detail.slice(0, 80)}
          {entry.detail.length > 80 ? '…' : ''}
        </span>
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
