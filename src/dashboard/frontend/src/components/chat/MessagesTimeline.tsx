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
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  memo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Circle, Bot, GitBranchPlus, RotateCcw, XCircle, Scissors, ClipboardList, ShieldCheck, Wrench, Search, X } from 'lucide-react';
import type { WorkingPhase } from '../../lib/workingPhase';
import type { CompactBoundary, TurnDiffSummary, WorkLogEntry } from './chat-types';
import { ChatMarkdown, ChatMarkdownSettingsProvider } from './ChatMarkdown';
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
import type { MessagesTimelineProps, RoundMarker } from './messagesTimeline/types';
import {
  ALWAYS_UNVIRTUALIZED_TAIL_ROWS,
  AUTO_SCROLL_THRESHOLD_PX,
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  clearSearchHighlights,
  escapeDataAttributeValue,
  extractSearchHighlightTerms,
  formatElapsed,
  formatTimestamp,
  getRowSearchText,
  highlightSearchTermsInElement,
} from './messagesTimeline/helpers';

export type { MessagesTimelineProps, RoundMarker } from './messagesTimeline/types';

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
  cwd,
  issueId,
  turnDiffSummaryByAssistantMessageId,
  onOpenTurnDiff,
  resolvedTheme,
  hideToolCalls = false,
  workingPhase,
  targetMessageId,
  targetMessageIndex,
  targetMessageNonce,
  onTargetMessageHandled,
}: MessagesTimelineProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  // Track whether user has manually scrolled up
  const isPinnedToBottomRef = useRef(true);
  // Set by wheel/touch/pointerdown/keydown — distinguishes a real user scroll
  // from a programmatic scrollTop adjustment. Without this, virtualizer
  // re-measurement after a row is added briefly grows scrollHeight before
  // our auto-scroll catches up, the scroll event fires with
  // distanceFromBottom > threshold, and pinning is lost even though the
  // user never touched the timeline. (Regression of fix in commit 80b33db80.)
  const userScrollIntentRef = useRef(false);
  // Visible state for scroll-to-bottom button
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [searchRenderTick, setSearchRenderTick] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousSearchQueryRef = useRef('');
  const handledTargetKeyRef = useRef<string | null>(null);

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
      estimateMessagesTimelineRowHeight(virtualRows[index]!, { timelineWidth: width, hideToolCalls }),
    measureElement: (el) => el.getBoundingClientRect().height,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });

  // Remeasure rows when hideToolCalls changes so the virtualizer
  // updates heights for collapsed / expanded work groups.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, hideToolCalls]);

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

  // Reset scroll pinning when switching conversations. The component is reused
  // across reviewer switches (parent does not remount it), so without this the
  // previous conversation's scrolled-up state leaks in and bails out the
  // auto-scroll effects above.
  useLayoutEffect(() => {
    isPinnedToBottomRef.current = true;
    userScrollIntentRef.current = false;
    setShowScrollToBottom(false);
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversationName]);

  // Mark user-initiated scroll intent so handleScroll can distinguish a real
  // scroll-up from a transient programmatic-scroll undershoot.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const markIntent = () => { userScrollIntentRef.current = true; };
    el.addEventListener('wheel', markIntent, { passive: true });
    el.addEventListener('touchstart', markIntent, { passive: true });
    el.addEventListener('pointerdown', markIntent);
    el.addEventListener('keydown', markIntent);
    return () => {
      el.removeEventListener('wheel', markIntent);
      el.removeEventListener('touchstart', markIntent);
      el.removeEventListener('pointerdown', markIntent);
      el.removeEventListener('keydown', markIntent);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Scroll virtualizer to last virtual row first (expands its height),
    // then set scrollTop to max to reach the unvirtualized tail rows.
    if (virtualRows.length > 0) {
      rowVirtualizer.scrollToIndex(virtualRows.length - 1, { align: 'end' });
    }
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    });
    isPinnedToBottomRef.current = true;
    userScrollIntentRef.current = false;
    setShowScrollToBottom(false);
  }, [rowVirtualizer, virtualRows.length]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    const atBottom = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
    if (atBottom) {
      // Landing at the bottom always re-pins, regardless of cause.
      isPinnedToBottomRef.current = true;
      userScrollIntentRef.current = false;
      setShowScrollToBottom(false);
    } else if (userScrollIntentRef.current) {
      // Only unpin when the user actually scrolled. Programmatic scrolls that
      // momentarily land short of the bottom (virtualizer re-measurement
      // during streaming) must not unpin — the resize-observer auto-scroll
      // below will catch up on the next tick.
      isPinnedToBottomRef.current = false;
      setShowScrollToBottom(true);
    }
  }, []);

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return rows
      .map((row, index) => ({ row, index, text: getRowSearchText(row).toLocaleLowerCase() }))
      .filter((candidate) => candidate.text.includes(query));
  }, [rows, searchQuery]);

  const currentMatch = searchMatches[currentMatchIndex] ?? null;
  const targetMessageRow = useMemo(() => {
    if (!targetMessageId && targetMessageIndex === undefined) return null;
    const byId = targetMessageId
      ? rows.findIndex((row) => row.kind === 'message' && row.message.id === targetMessageId)
      : -1;
    if (byId >= 0) return { row: rows[byId]!, index: byId };
    if (targetMessageIndex === undefined) return null;
    let messageIndex = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]!;
      if (row.kind !== 'message') continue;
      if (messageIndex === targetMessageIndex) return { row, index: rowIndex };
      messageIndex += 1;
    }
    return null;
  }, [rows, targetMessageId, targetMessageIndex]);
  const targetMessageKey = targetMessageId || targetMessageIndex !== undefined
    ? `${targetMessageNonce ?? 'no-nonce'}:${targetMessageId ?? ''}:${targetMessageIndex ?? ''}`
    : null;
  const searchHighlightTerms = useMemo(() => extractSearchHighlightTerms(searchQuery), [searchQuery]);

  const scrollToRow = useCallback((rowIndex: number, rowId: string) => {
    isPinnedToBottomRef.current = false;
    userScrollIntentRef.current = true;
    setShowScrollToBottom(true);

    const scrollRenderedRowIntoView = () => {
      const selector = `[data-search-row-id="${escapeDataAttributeValue(rowId)}"]`;
      const rowEl = scrollContainerRef.current?.querySelector<HTMLElement>(selector);
      rowEl?.scrollIntoView({ block: 'center' });
      setSearchRenderTick((tick) => tick + 1);
    };

    if (rowIndex < firstUnvirtIdx) {
      rowVirtualizer.scrollToIndex(rowIndex, { align: 'center' });
      requestAnimationFrame(scrollRenderedRowIntoView);
      return;
    }

    requestAnimationFrame(scrollRenderedRowIntoView);
  }, [firstUnvirtIdx, rowVirtualizer]);

  const goToMatch = useCallback((nextIndex: number) => {
    if (searchMatches.length === 0) return;
    const normalized = ((nextIndex % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(normalized);
    const match = searchMatches[normalized]!;
    scrollToRow(match.index, match.row.id);
  }, [scrollToRow, searchMatches]);

  useEffect(() => {
    if (!targetMessageRow || !targetMessageKey) return;
    if (handledTargetKeyRef.current === targetMessageKey) return;
    handledTargetKeyRef.current = targetMessageKey;
    scrollToRow(targetMessageRow.index, targetMessageRow.row.id);
    onTargetMessageHandled?.();
  }, [targetMessageRow, targetMessageKey, scrollToRow, onTargetMessageHandled]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen]);

  useEffect(() => {
    if (previousSearchQueryRef.current === searchQuery) return;
    previousSearchQueryRef.current = searchQuery;
    setCurrentMatchIndex(0);
    if (searchMatches[0]) {
      scrollToRow(searchMatches[0].index, searchMatches[0].row.id);
    }
  }, [searchQuery, searchMatches, scrollToRow]);

  useEffect(() => {
    if (currentMatchIndex >= searchMatches.length) {
      setCurrentMatchIndex(Math.max(0, searchMatches.length - 1));
    }
  }, [currentMatchIndex, searchMatches.length]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;
    clearSearchHighlights(root);
    if (!currentMatch || searchHighlightTerms.length === 0) return;
    const selector = `[data-search-row-id="${escapeDataAttributeValue(currentMatch.row.id)}"]`;
    const rowEl = root.querySelector<HTMLElement>(selector);
    if (rowEl) highlightSearchTermsInElement(rowEl, searchHighlightTerms);
    return () => clearSearchHighlights(root);
  }, [currentMatch, searchHighlightTerms, searchRenderTick, virtualItems.length, tailRows.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        return;
      }
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [searchOpen]);

  const dedupedVirtualItems = (() => {
    const seen = new Set<number>();
    return virtualItems.filter((item) => {
      if (seen.has(item.index)) return false;
      seen.add(item.index);
      return true;
    });
  })();

  return (
    <ChatMarkdownSettingsProvider>
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
                  data-search-row-id={row.id}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                    background: 'var(--background)',
                    outline: currentMatch?.row.id === row.id || targetMessageRow?.row.id === row.id ? '2px solid var(--color-primary)' : undefined,
                    outlineOffset: '-2px',
                    borderRadius: 8,
                  }}
                >
                  <TimelineRowRenderer
                    row={row}
                    isStreaming={streaming}
                    conversationName={conversationName}
                    cwd={cwd}
                    issueId={issueId}
                    turnDiffSummary={row.kind === 'message' && row.message.role === 'assistant' ? turnDiffSummaryByAssistantMessageId?.get(row.message.id) : undefined}
                    onOpenTurnDiff={onOpenTurnDiff}
                    resolvedTheme={resolvedTheme}
                    hideToolCalls={hideToolCalls}
                    workingPhase={workingPhase}
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
            <div
              key={row.id}
              data-search-row-id={row.id}
              style={{
                outline: currentMatch?.row.id === row.id || targetMessageRow?.row.id === row.id ? '2px solid var(--color-primary)' : undefined,
                outlineOffset: '-2px',
                borderRadius: 8,
              }}
            >
              <TimelineRowRenderer
                row={row}
                isStreaming={streaming}
                conversationName={conversationName}
                cwd={cwd}
                issueId={issueId}
                turnDiffSummary={row.kind === 'message' && row.message.role === 'assistant' ? turnDiffSummaryByAssistantMessageId?.get(row.message.id) : undefined}
                onOpenTurnDiff={onOpenTurnDiff}
                resolvedTheme={resolvedTheme}
                hideToolCalls={hideToolCalls}
                workingPhase={workingPhase}
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
    </div>

    {searchOpen && (
      <div
        role="search"
        aria-label="Search conversation"
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 8,
          background: 'var(--popover, var(--background))',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}
      >
        <Search size={14} />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setSearchOpen(false);
              setSearchQuery('');
            } else if (event.key === 'Enter') {
              event.preventDefault();
              goToMatch(currentMatchIndex + (event.shiftKey ? -1 : 1));
            }
          }}
          placeholder="Search conversation…"
          aria-label="Search conversation"
          style={{
            width: 260,
            background: 'var(--input, var(--background))',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '5px 8px',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <span style={{ minWidth: 54, textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>
          {searchQuery.trim() ? `${searchMatches.length === 0 ? 0 : currentMatchIndex + 1}/${searchMatches.length}` : '0/0'}
        </span>
        <button
          type="button"
          onClick={() => goToMatch(currentMatchIndex - 1)}
          disabled={searchMatches.length === 0}
          title="Previous match"
          aria-label="Previous match"
          style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'inherit', cursor: searchMatches.length ? 'pointer' : 'not-allowed' }}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => goToMatch(currentMatchIndex + 1)}
          disabled={searchMatches.length === 0}
          title="Next match"
          aria-label="Next match"
          style={{ padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'inherit', cursor: searchMatches.length ? 'pointer' : 'not-allowed' }}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
          title="Close search"
          aria-label="Close search"
          style={{ padding: 4, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          <X size={14} />
        </button>
      </div>
    )}

    {/* Failed message outbox — shows messages that failed to send with Retry/Discard */}
    {failedMessages && failedMessages.length > 0 && (
      <div className={styles.failedOutbox}>
        {failedMessages.map((fm) => (
          <div key={fm.id} className={styles.failedMessage}>
            <div className={styles.failedMessageBubble}>
              <ChatMarkdown text={fm.text} cwd={cwd} issueId={issueId} />
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
    </ChatMarkdownSettingsProvider>
  );
});

// ─── Row renderer ─────────────────────────────────────────────────────────────

interface RowProps {
  row: MessagesTimelineRow;
  isStreaming: boolean;
  conversationName?: string;
  cwd?: string;
  issueId?: string | null;
  turnDiffSummary?: TurnDiffSummary;
  onOpenTurnDiff?: (turnId: string, filePath?: string) => void;
  resolvedTheme?: 'light' | 'dark';
  hideToolCalls?: boolean;
  workingPhase?: WorkingPhase;
}

const TimelineRowRenderer = memo(function TimelineRowRenderer({ row, isStreaming, conversationName, cwd, issueId, turnDiffSummary, onOpenTurnDiff, resolvedTheme, hideToolCalls, workingPhase }: RowProps) {
  if (row.kind === 'working') {
    return <WorkingIndicator startedAt={row.createdAt} phase={workingPhase} />;
  }
  if (row.kind === 'work') {
    return <WorkLogGroup entries={row.groupedEntries} hideToolCalls={hideToolCalls} cwd={cwd} issueId={issueId} />;
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
  if (row.message.role === 'system') {
    return <SessionPermissionsRow message={row.message} />;
  }
  if (row.message.role === 'user') {
    return <UserMessageRow message={row.message} cwd={cwd} issueId={issueId} />;
  }
  return (
    <AssistantMessageRow
      message={row.message}
      durationStart={row.durationStart}
      isStreaming={isStreaming}
      cwd={cwd}
      issueId={issueId}
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

function isReviewerContextMessage(text: string): boolean {
  return text.startsWith('# Review Context\n');
}

// PAN-1458: Detect a Claude Code slash-command user message (the literal token Claude
// Code writes when the user types /clear, /compact, /resume, etc.). Returned object
// carries the command name (e.g. '/clear') so the divider can label itself.
function parseSlashCommandMessage(text: string): { command: string } | null {
  const match = text.trimStart().match(/^<command-name>([^<]+)<\/command-name>/);
  return match ? { command: match[1] } : null;
}

function UserMessageRow({ message, cwd, issueId }: { message: ChatMessage; cwd?: string; issueId?: string | null }) {
  const slashCommand = parseSlashCommandMessage(message.text);
  if (slashCommand) {
    return <SlashCommandDivider command={slashCommand.command} createdAt={message.createdAt} />;
  }
  if (isSummaryForkMessage(message.text)) {
    return <ContextMessageBlock message={message} cwd={cwd} issueId={issueId} />;
  }
  if (isReviewerContextMessage(message.text)) {
    return <ReviewerContextBlock message={message} cwd={cwd} issueId={issueId} />;
  }

  const isPending = message.id.startsWith('optimistic-') && !message.acknowledged;
  return (
    <div className={styles.userMessageRow}>
      <div
        className={styles.userMessageBubble}
        style={isPending ? { opacity: 0.6 } : undefined}
        title={isPending ? 'Pending — waiting for agent to process' : undefined}
      >
        <div className={styles.userMessageText}><ChatMarkdown text={message.text} cwd={cwd} issueId={issueId} /></div>
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

function ContextMessageBlock({ message, cwd, issueId }: { message: ChatMessage; cwd?: string; issueId?: string | null }) {
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
            <ChatMarkdown text={cleanText} cwd={cwd} issueId={issueId} />
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewerContextBlock({ message, cwd, issueId }: { message: ChatMessage; cwd?: string; issueId?: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.contextMessageRow}>
      <div className={styles.contextMessageBlock}>
        <button
          type="button"
          className={styles.contextMessageToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          <ClipboardList size={14} className={styles.contextMessageIcon} />
          <span className={styles.contextMessageLabel}>Review Context</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {expanded && (
          <div className={styles.contextMessageContent}>
            <ChatMarkdown text={message.text} cwd={cwd} issueId={issueId} />
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
  cwd,
  issueId,
}: {
  message: ChatMessage;
  durationStart: string;
  isStreaming: boolean;
  cwd?: string;
  issueId?: string | null;
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
        <ChatMarkdown text={message.text} isStreaming={isStreaming && !message.completedAt} cwd={cwd} issueId={issueId} />
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

function WorkLogGroup({ entries, hideToolCalls, cwd, issueId }: { entries: WorkLogEntry[]; hideToolCalls?: boolean; cwd?: string; issueId?: string | null }) {
  const [expanded, setExpanded] = useState(false);

  const onlyToolEntries = entries.every((entry) => entry.tone === 'tool' || entry.tone === 'error');
  if (hideToolCalls && onlyToolEntries && !expanded) {
    const n = entries.length;
    return (
      <button
        type="button"
        className={styles.workLogGroup}
        onClick={() => setExpanded(true)}
        title={`Show ${n} tool ${n === 1 ? 'call' : 'calls'}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          opacity: 0.5,
          fontSize: 11,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; }}
      >
        <Wrench size={12} />
        <span>{n} tool {n === 1 ? 'call was' : 'calls were'} made</span>
      </button>
    );
  }

  const visible = expanded ? entries : entries.slice(0, MAX_VISIBLE_WORK_LOG_ENTRIES);
  const hasOverflow = entries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;

  return (
    <div className={styles.workLogGroup}>
      {visible.map((entry) => (
        <SimpleWorkEntryRow key={entry.id} entry={entry} cwd={cwd} issueId={issueId} />
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

const TERMINAL_TOOLS = new Set(['Bash', 'bash', 'Shell', 'terminal', 'shell']);
const WORK_LOG_DETAIL_MAX = 80;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstLine(value: string): string {
  const idx = value.indexOf('\n');
  return idx >= 0 ? value.slice(0, idx) : value;
}

function getWorkLogDisplayDetail(entry: WorkLogEntry): string | undefined {
  const detail = entry.detail ?? entry.command;
  return detail ? firstLine(detail) : undefined;
}

/**
 * Per-tool expanded body for a tool_use work-log entry. Reads structured
 * fields out of `entry.toolInput` and renders them in a form that matches
 * the tool's semantics (shell block for Bash, file chip for Read/Write/Edit,
 * pattern + path for Grep/Glob, etc.). Unknown tools fall back to a
 * pretty-printed JSON code block. See PAN-1459.
 */
function ToolUseExpanded({
  entry,
  cwd,
  issueId,
}: {
  entry: WorkLogEntry;
  cwd?: string;
  issueId?: string | null;
}) {
  const tool = entry.toolTitle ?? entry.label;
  const input = entry.toolInput;
  if (!input) return null;

  switch (tool) {
    case 'Bash': {
      const description = asString(input.description);
      const command = asString(input.command);
      return (
        <>
          {description && <div className={styles.workLogToolHeader}>{description}</div>}
          {command && (
            <pre className={styles.workLogResult}>
              <code>{command}</code>
            </pre>
          )}
        </>
      );
    }

    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const filePath = asString(input.file_path) ?? asString(input.notebook_path);
      if (!filePath) break;
      return (
        <div className={styles.workLogResult}>
          <ChatMarkdown text={`\`${filePath}\``} cwd={cwd} issueId={issueId} />
        </div>
      );
    }

    case 'Grep': {
      const pattern = asString(input.pattern) ?? '';
      const path = asString(input.path);
      const glob = asString(input.glob);
      const flags = [
        asString(input.type) && `type=${input.type}`,
        input['-i'] === true && 'case-insensitive',
        input['-n'] === true && 'line-numbers',
        glob && `glob=${glob}`,
      ].filter(Boolean);
      return (
        <div className={styles.workLogResult}>
          <code>{pattern}</code>
          {path && <> in <code>{path}</code></>}
          {flags.length > 0 && <> · {flags.join(' · ')}</>}
        </div>
      );
    }

    case 'Glob': {
      const pattern = asString(input.pattern) ?? '';
      const path = asString(input.path);
      return (
        <div className={styles.workLogResult}>
          <code>{pattern}</code>
          {path && <> in <code>{path}</code></>}
        </div>
      );
    }

    case 'WebFetch': {
      const url = asString(input.url);
      const prompt = asString(input.prompt);
      return (
        <div className={styles.workLogResult}>
          {url && (
            <div>
              <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
            </div>
          )}
          {prompt && <div>{prompt}</div>}
        </div>
      );
    }

    case 'WebSearch': {
      const query = asString(input.query);
      return query ? <div className={styles.workLogResult}>{query}</div> : null;
    }

    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return (
        <ul className={styles.workLogResult}>
          {todos.map((todo, i) => {
            const t = todo as Record<string, unknown>;
            const content = asString(t.content) ?? asString(t.activeForm) ?? '(empty)';
            const status = asString(t.status) ?? 'pending';
            return (
              <li key={i}>
                <span style={{ color: 'var(--muted-foreground)' }}>[{status}]</span> {content}
              </li>
            );
          })}
        </ul>
      );
    }

    case 'Task': {
      const subagent = asString(input.subagent_type);
      const description = asString(input.description);
      const prompt = asString(input.prompt);
      return (
        <div className={styles.workLogResult}>
          {(subagent || description) && (
            <div className={styles.workLogToolHeader}>
              {subagent && <code>{subagent}</code>}
              {subagent && description && ' · '}
              {description}
            </div>
          )}
          {prompt && <ChatMarkdown text={prompt} cwd={cwd} issueId={issueId} />}
        </div>
      );
    }

    // ─── Pi harness (lowercase tool names; `path`/`command`/`edits` keys) ────
    case 'bash': {
      const description = asString(input.description);
      const command = asString(input.command);
      return (
        <>
          {description && <div className={styles.workLogToolHeader}>{description}</div>}
          {command && (
            <pre className={styles.workLogResult}>
              <code>{command}</code>
            </pre>
          )}
        </>
      );
    }

    case 'read':
    case 'write': {
      const filePath = asString(input.path) ?? asString(input.file_path);
      if (!filePath) break;
      return (
        <div className={styles.workLogResult}>
          <ChatMarkdown text={`\`${filePath}\``} cwd={cwd} issueId={issueId} />
        </div>
      );
    }

    case 'edit': {
      const filePath = asString(input.path) ?? asString(input.file_path);
      if (!filePath) break;
      const edits = Array.isArray(input.edits) ? input.edits.length : 0;
      return (
        <div className={styles.workLogResult}>
          <ChatMarkdown text={`\`${filePath}\`${edits > 1 ? ` \u00b7 ${edits} edits` : ''}`} cwd={cwd} issueId={issueId} />
        </div>
      );
    }

    default:
      break;
  }

  // Fallback: pretty-printed JSON. Replaces the previous behavior of stuffing
  // JSON.stringify(input) into a one-line `detail` string with no formatting.
  return (
    <pre className={styles.workLogResult}>
      <code>{JSON.stringify(input, null, 2)}</code>
    </pre>
  );
}

function SimpleWorkEntryRow({ entry, cwd, issueId }: { entry: WorkLogEntry; cwd?: string; issueId?: string | null }) {
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
  const hasToolBody = !!entry.toolInput && (entry.tone === 'tool' || entry.tone === 'error');
  const isExpandable = hasResult || hasToolBody || (isThinking && !!entry.detail);
  const displayDetail = getWorkLogDisplayDetail(entry);

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
        {displayDetail && (
          <span className={styles.workLogDetail} title={displayDetail}>
            {displayDetail.slice(0, WORK_LOG_DETAIL_MAX)}
            {displayDetail.length > WORK_LOG_DETAIL_MAX ? '…' : ''}
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
        <>
          {hasToolBody && <ToolUseExpanded entry={entry} cwd={cwd} issueId={issueId} />}
          {isThinking && entry.detail && (
            <div className={styles.workLogResult}>
              <ChatMarkdown text={entry.detail} cwd={cwd} issueId={issueId} />
            </div>
          )}
          {entry.result && (
            isTerminal ? (
              <pre className={styles.workLogResult}>{entry.result}</pre>
            ) : (
              <div className={styles.workLogResult}>
                <ChatMarkdown text={entry.result} cwd={cwd} issueId={issueId} />
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

// ─── Working indicator ────────────────────────────────────────────────────────

function WorkingIndicator({ startedAt, phase }: { startedAt: string | null; phase?: WorkingPhase }) {
  const [elapsed, setElapsed] = useState(0);
  const startMs = startedAt ? new Date(startedAt).getTime() : Date.now();

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startMs]);

  const isToolPhase = phase === 'tool';

  return (
    <div className={styles.workingIndicator}>
      {isToolPhase ? (
        <Wrench size={14} className={styles.pulseIcon} aria-label="Using tool" />
      ) : (
        <span className={styles.workingDots}>
          <span />
          <span />
          <span />
        </span>
      )}
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

// ─── Session permissions banner ──────────────────────────────────────────────

function SessionPermissionsRow({ message }: { message: ChatMessage }) {
  return (
    <div className={styles.sessionPermissionsRow}>
      <ShieldCheck size={11} className={styles.sessionPermissionsIcon} />
      <span className={styles.sessionPermissionsLabel}>Permissions:</span>
      <span className={styles.sessionPermissionsTools}>{message.text}</span>
    </div>
  );
}

// ─── Slash-command divider (PAN-1458) ────────────────────────────────────────

/**
 * Renders a Claude Code slash command (the kind Claude Code emits as a user
 * message wrapped in `<command-name>X</command-name>`) as a horizontal divider
 * instead of a regular message bubble. Most relevant for `/clear`, which
 * signals the JSONL boundary — see PAN-1458 — but applies to any slash command
 * Claude Code happens to record this way.
 */
function SlashCommandDivider({ command, createdAt }: { command: string; createdAt: string }) {
  const isClear = command === '/clear';
  const label = isClear ? 'Conversation cleared' : `Slash command: ${command}`;
  return (
    <div className={styles.compactBoundaryDivider}>
      <div className={styles.compactBoundaryLine} />
      <div className={styles.compactBoundaryLabel}>
        <RotateCcw size={12} />
        <span>{label}</span>
        <span className={styles.compactBoundaryDetail}>{formatTimestamp(createdAt)}</span>
      </div>
      <div className={styles.compactBoundaryLine} />
    </div>
  );
}

// ─── Compact boundary divider ────────────────────────────────────────────────

function CompactBoundaryDivider({ boundary }: { boundary: CompactBoundary }) {
  const label = boundary.preTokens
    ? `Compacted (${Math.round(boundary.preTokens / 1000)}k tokens)`
    : 'Conversation compacted';
  const detail = [
    boundary.trigger && boundary.trigger !== 'overdeck-native' ? boundary.trigger : null,
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
