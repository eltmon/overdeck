import type { MessagesTimelineRow } from '../MessagesTimeline.logic';

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;
export const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;
export const AUTO_SCROLL_THRESHOLD_PX = 64;

export function stringifyToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  try {
    return JSON.stringify(input);
  } catch {
    return '';
  }
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSearchHighlightTerms(query: string): string[] {
  const matches = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const dedup = new Set<string>();
  for (const term of matches) {
    if (term.length > 0) dedup.add(term);
  }
  return [...dedup].sort((a, b) => b.length - a.length);
}

// Match CommandPalette highlighting: quiet background-only amber, no text color swap.
export const SEARCH_HIGHLIGHT_CLASS = 'rounded-sm px-px text-inherit bg-amber-300/40 dark:bg-amber-400/20';
export const SEARCH_HIGHLIGHT_ATTR = 'data-conversation-search-highlight';

export function escapeDataAttributeValue(value: string): string {
  const cssEscape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : null;
  if (cssEscape) return cssEscape(value);
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function clearSearchHighlights(root: ParentNode): void {
  const highlights = Array.from(root.querySelectorAll<HTMLElement>(`[${SEARCH_HIGHLIGHT_ATTR}]`));
  for (const highlight of highlights) {
    highlight.replaceWith(document.createTextNode(highlight.textContent ?? ''));
  }
}

export function highlightSearchTermsInElement(element: HTMLElement, terms: string[]): void {
  clearSearchHighlights(element);
  if (terms.length === 0) return;

  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      pattern.lastIndex = 0;
      if (!node.textContent || !pattern.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      pattern.lastIndex = 0;
      const parent = node.parentElement;
      if (!parent || parent.closest(`[${SEARCH_HIGHLIGHT_ATTR}]`)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    const parts = text.split(pattern);
    if (parts.length <= 1) continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (terms.some((term) => part.toLocaleLowerCase() === term.toLocaleLowerCase())) {
        const span = document.createElement('span');
        span.className = SEARCH_HIGHLIGHT_CLASS;
        span.setAttribute(SEARCH_HIGHLIGHT_ATTR, 'true');
        span.textContent = part;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }
    node.replaceWith(fragment);
  }
}

export function getRowSearchText(row: MessagesTimelineRow): string {
  if (row.kind === 'message') return row.message.text;
  if (row.kind === 'work') {
    return row.groupedEntries
      .map((entry) => [
        entry.label,
        entry.detail,
        entry.result,
        entry.command,
        entry.toolTitle,
        entry.changedFiles?.join('\n'),
        stringifyToolInput(entry.toolInput),
      ].filter(Boolean).join('\n'))
      .join('\n');
  }
  if (row.kind === 'proposed-plan') return row.plan.plan;
  if (row.kind === 'compact-boundary') return `Conversation compacted ${row.boundary.trigger ?? ''} ${row.boundary.model ?? ''}`;
  if (row.kind === 'compacting') return 'Compacting conversation';
  if (row.kind === 'working') return 'Working';
  return '';
}

/** Format an ISO timestamp as a short time string (e.g., "3:42 PM" or "May 14, 3:42 PM"). */
export function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    if (isSameDay) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Format elapsed duration between two ISO timestamps (e.g., "1.5s", "2m 30s"). */
export function formatElapsed(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
