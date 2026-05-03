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
  Fragment,
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  memo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Circle, Bot, GitBranchPlus, RotateCcw, XCircle, Scissors } from 'lucide-react';
import type { CompactBoundary, ProposedPlan, TurnDiffSummary, WorkLogEntry } from './chat-types';
import type { FailedMessage } from './ConversationPanel';
import { ChatMarkdown } from './ChatMarkdown';
import { ChangedFilesTree } from './ChangedFilesTree';
import { DiffStatLabel } from './DiffStatLabel';
import { summarizeTurnDiffStats } from '../../lib/turnDiffTree';
import { PlanCard } from './PlanCard';
import {
  deriveTimelineEntries,
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  type MessagesTimelineRow,
} from './MessagesTimeline.logic';
import type { ChatMessage } from './chat-types';
import type { RoundVerdict } from '../CommandDeck/RoundCard';
import styles from '../CommandDeck/styles/command-deck.module.css';

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

/**
 * Visual divider injected into the timeline between review rounds.
 *
 * The divider renders immediately after the row whose id matches
 * `afterMessageId`. It is rendered inside the matching row's wrapper so
 * `useVirtualizer.measureElement` accounts for its height automatically;
 * no separate row index is needed and no row is hidden behind virtualization.
 */
export interface RoundMarker {
  /** Insert the divider after the row with this id (any row.id, message or work). */
  afterMessageId: string;
  round: number;
  verdict: RoundVerdict;
  /** Optional extra label suffix (e.g. "synthesis", "round-2"). */
  label?: string;
}

export interface MessagesTimelineProps {
  messages: ChatMessage[];
  workLog: WorkLogEntry[];
  streaming: boolean;
  roundMarkers?: ReadonlyArray<RoundMarker>;
  failedMessages?: FailedMessage[];
  onRetryFailed?: (failedId: string, text: string) => void;
  onDiscardFailed?: (failedId: string) => void;
  proposedPlan?: ProposedPlan;
  compactBoundaries?: CompactBoundary[];
  compacting?: boolean;
  conversationName?: string;
  turnDiffSummaryByAssistantMessageId?: Map<string, TurnDiffSummary>;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MessagesTimeline = memo(function MessagesTimeline({
  messages,
  workLog,
  streaming,
  roundMarkers,
  failedMessages,
  onRetryFailed,
  onDiscardFailed,
  proposedPlan,
  compactBoundaries,
  compacting,
  conversationName,
  turnDiffSummaryByAssistantMessageId,
  onOpenTurnDiff,
  resolvedTheme,
}: MessagesTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  // Track whether user has manually scrolled up
  const isPinnedToBottomRef = useRef(true);
  // Visible state for scroll-to-bottom button
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const timelineEntries = useMemo(() => deriveTimelineEntries(messages, workLog), [messages, workLog]);
  const baseRows = useMemo(() => deriveMessagesTimelineRows(timelineEntries, streaming), [timelineEntries, streaming]);
  const rows = useMemo(() => {
    let result = baseRows;

    // Inject compact boundary dividers by timestamp
    if (compactBoundaries && compactBoundaries.length > 0) {
      const copy = [...result];
      for (const boundary of compactBoundaries) {
        const boundaryRow: MessagesTimelineRow = {
          kind: 'compact-boundary',
          id: `compact-${boundary.id}`,
          createdAt: boundary.timestamp,
          boundary,
        };
        const idx = copy.findIndex(r => r.createdAt && r.createdAt > boundary.timestamp);
        if (idx >= 0) {
          copy.splice(idx, 0, boundaryRow);
        } else {
          copy.push(boundaryRow);
        }
      }
      result = copy;
    }

    // Inject proposed plan
    if (proposedPlan) {
      const planRow: MessagesTimelineRow = {
        kind: 'proposed-plan',
        id: `plan-${proposedPlan.id}`,
        createdAt: proposedPlan.createdAt,
        plan: proposedPlan,
      };
      if (proposedPlan.status === 'pending') {
        const workingIdx = result.findIndex(r => r.kind === 'working');
        if (workingIdx >= 0) {
          const copy = [...result];
          copy.splice(workingIdx, 0, planRow);
          result = copy;
        } else {
          result = [...result, planRow];
        }
      } else {
        const copy = [...result];
        const insertIdx = copy.findIndex(r => r.createdAt && r.createdAt > proposedPlan.createdAt);
        if (insertIdx >= 0) {
          copy.splice(insertIdx, 0, planRow);
        } else {
          copy.push(planRow);
        }
        result = copy;
      }
    }

    // Inject compacting indicator at the end
    if (compacting) {
      result = [...result, {
        kind: 'compacting' as const,
        id: 'compacting-indicator',
        createdAt: new Date().toISOString(),
      }];
    }

    return result;
  }, [baseRows, proposedPlan, compactBoundaries, compacting]);

  // Index round markers by the row they should follow. A single row can have
  // multiple markers (e.g. two consecutive rounds without any new messages
  // between them) so the lookup is row-id → marker[].
  const markersByAfterId = useMemo(() => {
    const map = new Map<string, RoundMarker[]>();
    if (!roundMarkers || roundMarkers.length === 0) return map;
    for (const marker of roundMarkers) {
      const existing = map.get(marker.afterMessageId);
      if (existing) existing.push(marker);
      else map.set(marker.afterMessageId, [marker]);
    }
    return map;
  }, [roundMarkers]);

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
              const markersForRow = markersByAfterId.get(row.id);
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
                    background: 'var(--background)',
                  }}
                >
                  <TimelineRowRenderer
                    row={row}
                    isStreaming={streaming}
                    conversationName={conversationName}
                    turnDiffSummary={row.kind === 'message' && row.message.role === 'assistant' ? turnDiffSummaryByAssistantMessageId?.get(row.message.id) : undefined}
                    onOpenTurnDiff={onOpenTurnDiff}
                    resolvedTheme={resolvedTheme}
                  />
                  {markersForRow?.map((marker) => (
                    <RoundDivider
                      key={`marker-${marker.round}-${marker.label ?? ''}`}
                      marker={marker}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Non-virtual tail rows — normal flow */}
        {tailRows.map((row) => {
          const markersForRow = markersByAfterId.get(row.id);
          return (
            <Fragment key={row.id}>
              <TimelineRowRenderer
                row={row}
                isStreaming={streaming}
                conversationName={conversationName}
                turnDiffSummary={row.kind === 'message' && row.message.role === 'assistant' ? turnDiffSummaryByAssistantMessageId?.get(row.message.id) : undefined}
                onOpenTurnDiff={onOpenTurnDiff}
                resolvedTheme={resolvedTheme}
              />
              {markersForRow?.map((marker) => (
                <RoundDivider
                  key={`marker-${marker.round}-${marker.label ?? ''}`}
                  marker={marker}
                />
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>

    {/* Failed message outbox — shows messages that failed to send with Retry/Discard */}
    {failedMessages && failedMessages.length > 0 && (
      <div className={styles.failedOutbox}>
        {failedMessages.map((fm) => (
          <div key={fm.id} className={styles.failedMessage}>
            <div className={styles.failedMessageBubble}>
              <ChatMarkdown text={fm.text} />
            </div>
            <div className={styles.failedMessageActions}>
              <span className={styles.failedMessageLabel}>Failed to send</span>
              <button
                className={styles.failedMessageBtn}
                onClick={() => onRetryFailed?.(fm.id, fm.text)}
                title="Retry sending"
              >
                <RotateCcw size={12} />
                Retry
              </button>
              <button
                className={styles.failedMessageBtn}
                onClick={() => onDiscardFailed?.(fm.id)}
                title="Discard message"
              >
                <XCircle size={12} />
                Discard
              </button>
            </div>
          </div>
        ))}
      </div>
    )}

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
  conversationName?: string;
  turnDiffSummary?: TurnDiffSummary;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
}

const TimelineRowRenderer = memo(function TimelineRowRenderer({ row, isStreaming, conversationName, turnDiffSummary, onOpenTurnDiff, resolvedTheme }: RowProps) {
  if (row.kind === 'working') {
    return <WorkingIndicator startedAt={row.createdAt} />;
  }
  if (row.kind === 'work') {
    return <WorkLogGroup entries={row.groupedEntries} />;
  }
  if (row.kind === 'proposed-plan') {
    return <PlanCard plan={row.plan} conversationName={conversationName ?? ''} />;
  }
  if (row.kind === 'compact-boundary') {
    return <CompactBoundaryDivider boundary={row.boundary} />;
  }
  if (row.kind === 'compacting') {
    return <CompactingIndicator />;
  }
  if (row.message.role === 'user') {
    return <UserMessageRow message={row.message} />;
  }
  return (
    <AssistantMessageRow
      message={row.message}
      durationStart={row.durationStart}
      isStreaming={isStreaming}
      turnDiffSummary={turnDiffSummary}
      onOpenTurnDiff={onOpenTurnDiff}
      resolvedTheme={resolvedTheme}
    />
  );
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
        <div className={styles.userMessageText}><ChatMarkdown text={message.text} /></div>
        <span className={styles.messageTimestamp}>
          {isPending ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <svg style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: 'var(--primary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
  durationStart,
  isStreaming,
  turnDiffSummary,
  onOpenTurnDiff,
  resolvedTheme,
}: {
  message: ChatMessage;
  durationStart: string;
  isStreaming: boolean;
  turnDiffSummary?: TurnDiffSummary;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
}) {
  const duration = message.completedAt
    ? formatElapsed(durationStart, message.completedAt)
    : null;

  const [allExpanded, setAllExpanded] = useState(false);

  return (
    <div className={styles.assistantMessageRow}>
      <Bot size={14} className={styles.assistantMessageAvatar} aria-hidden="true" />
      <div className={styles.assistantMessageContent}>
        <ChatMarkdown text={message.text} isStreaming={isStreaming && !message.completedAt} />
        {turnDiffSummary && turnDiffSummary.files.length > 0 && (
          <div className="mt-2 rounded-md border border-border/50 bg-muted/30 p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Changed files ({turnDiffSummary.files.length})
                {' '}
                <DiffStatLabel
                  additions={summarizeTurnDiffStats(turnDiffSummary.files).additions}
                  deletions={summarizeTurnDiffStats(turnDiffSummary.files).deletions}
                  showParentheses
                />
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => setAllExpanded((v) => !v)}
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
                {onOpenTurnDiff && (
                  <button
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => onOpenTurnDiff(turnDiffSummary.turnId)}
                  >
                    View diff
                  </button>
                )}
              </div>
            </div>
            <ChangedFilesTree
              turnId={turnDiffSummary.turnId}
              files={turnDiffSummary.files}
              allDirectoriesExpanded={allExpanded}
              resolvedTheme={resolvedTheme ?? 'dark'}
              onOpenTurnDiff={onOpenTurnDiff ?? (() => {})}
            />
          </div>
        )}
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
        <SimpleWorkEntryRow key={entry.id} entry={entry} />
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

function SimpleWorkEntryRow({ entry }: { entry: WorkLogEntry }) {
  const [showResult, setShowResult] = useState(false);
  const toneColor: Record<WorkLogEntry['tone'], string> = {
    thinking: 'var(--muted-foreground)',
    tool: 'var(--primary)',
    info: 'var(--success)',
    error: 'var(--destructive)',
  };

  const isTerminal = TERMINAL_TOOLS.has(entry.toolTitle ?? entry.label);
  const isThinking = entry.tone === 'thinking';
  const hasResult = !!entry.result;
  const isExpandable = hasResult || (isThinking && !!entry.detail);

  return (
    <div>
      <div
        className={styles.workLogEntry}
        style={isExpandable ? { cursor: 'pointer' } : undefined}
        onClick={isExpandable ? () => setShowResult(prev => !prev) : undefined}
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
        {isExpandable && (
          <ChevronRight
            size={10}
            style={{
              flexShrink: 0,
              marginLeft: 'auto',
              transition: 'transform 0.15s',
              transform: showResult ? 'rotate(90deg)' : 'none',
              color: 'var(--muted-foreground)',
            }}
          />
        )}
      </div>
      {showResult && (
        isTerminal && entry.result ? (
          <pre className={styles.workLogResult}>{entry.result}</pre>
        ) : isThinking && entry.detail ? (
          <div className={styles.workLogResult}>
            <ChatMarkdown text={entry.detail} />
          </div>
        ) : entry.result ? (
          <div className={styles.workLogResult}>
            <ChatMarkdown text={entry.result} />
          </div>
        ) : null
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

// ─── Round divider ────────────────────────────────────────────────────────────

const ROUND_VERDICT_COLOR: Record<RoundVerdict, string> = {
  pending: 'var(--muted-foreground)',
  passed: 'var(--success)',
  failed: 'var(--destructive)',
  running: 'var(--primary)',
};

const ROUND_VERDICT_LABEL: Record<RoundVerdict, string> = {
  pending: 'Pending',
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
};

function RoundDivider({ marker }: { marker: RoundMarker }) {
  const color = ROUND_VERDICT_COLOR[marker.verdict];
  const verdictLabel = ROUND_VERDICT_LABEL[marker.verdict];
  return (
    <div
      data-testid={`round-divider-${marker.round}`}
      data-round={marker.round}
      data-verdict={marker.verdict}
      role="separator"
      aria-label={`Round ${marker.round} — ${verdictLabel}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '12px 0',
        width: '100%',
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--border)',
        }}
      />
      <span
        style={{
          padding: '2px 10px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color,
          border: `1px solid ${color}`,
          background: 'var(--card, var(--background))',
          whiteSpace: 'nowrap',
        }}
      >
        Round {marker.round} · {verdictLabel}
        {marker.label ? ` · ${marker.label}` : ''}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--border)',
        }}
      />
    </div>
  );
}

// ─── Compact boundary divider ────────────────────────────────────────────────

function CompactBoundaryDivider({ boundary }: { boundary: CompactBoundary }) {
  const label = boundary.preTokens
    ? `Compacted (${Math.round(boundary.preTokens / 1000)}k tokens)`
    : 'Conversation compacted';
  const detail = [
    boundary.trigger && boundary.trigger !== 'panopticon-native' ? boundary.trigger : null,
    boundary.model,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.compactBoundaryDivider}>
      <div className={styles.compactBoundaryLine} />
      <div className={styles.compactBoundaryLabel}>
        <Scissors size={12} />
        <span>{label}</span>
        {detail && <span className={styles.compactBoundaryDetail}>{detail}</span>}
      </div>
      <div className={styles.compactBoundaryLine} />
    </div>
  );
}

// ─── Compacting indicator ────────────────────────────────────────────────────

function CompactingIndicator() {
  return (
    <div className={styles.compactingIndicator}>
      <Scissors size={14} className={styles.compactingIcon} />
      <span>Compacting conversation...</span>
    </div>
  );
}
