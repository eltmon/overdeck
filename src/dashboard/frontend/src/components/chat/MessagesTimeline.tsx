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
import { ChevronDown, RotateCcw, XCircle, Search, X } from 'lucide-react';
import type { WorkingPhase } from '../../lib/workingPhase';
import type { TurnDiffSummary } from './chat-types';
import { ChatMarkdown, ChatMarkdownSettingsProvider } from './ChatMarkdown';
import { PlanCard } from './PlanCard';
import {
  deriveTimelineEntries,
  deriveMessagesTimelineRows,
  estimateMessagesTimelineRowHeight,
  type MessagesTimelineRow,
} from './MessagesTimeline.logic';
import styles from '../CommandDeck/styles/command-deck.module.css';
import type { MessagesTimelineProps, RoundMarker } from './messagesTimeline/types';
import { AssistantMessageRow, UserMessageRow } from './messagesTimeline/messageRows';
import { WorkLogGroup } from './messagesTimeline/workLogRows';
import {
  CompactBoundaryDivider,
  CompactingIndicator,
  RoundDivider,
  SessionPermissionsRow,
  WorkingIndicator,
} from './messagesTimeline/dividers';
import {
  ALWAYS_UNVIRTUALIZED_TAIL_ROWS,
  AUTO_SCROLL_THRESHOLD_PX,
  clearSearchHighlights,
  escapeDataAttributeValue,
  extractSearchHighlightTerms,
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
