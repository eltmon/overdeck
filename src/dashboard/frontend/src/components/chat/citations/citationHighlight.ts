import { useLayoutEffect, useMemo, type RefObject } from 'react';
import { useConversationCitations } from '../../../lib/composerCitations';

const HIGHLIGHT_NAME = 'overdeck-citation';

interface TextPosition {
  node: Text;
  offset: number;
}

function buildCompactIndex(root: HTMLElement): { compact: string; positions: TextPosition[] } {
  const chars: string[] = [];
  const positions: TextPosition[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (!/\s/.test(ch)) {
        chars.push(ch);
        positions.push({ node: node as Text, offset: i });
      }
    }
    node = walker.nextNode();
  }
  return { compact: chars.join(''), positions };
}

/** Finds a (possibly cross-element) quote within `root`, ignoring whitespace differences. */
export function findQuoteRange(root: HTMLElement, quote: string): Range | null {
  const strippedQuote = quote.replace(/\s+/g, '');
  if (strippedQuote === '') return null;

  const { compact, positions } = buildCompactIndex(root);
  const startIndex = compact.indexOf(strippedQuote);
  if (startIndex === -1) return null;

  const endIndex = startIndex + strippedQuote.length - 1;
  const start = positions[startIndex]!;
  const end = positions[endIndex]!;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

// Module registry: one row's ranges per `${conversationName}:${messageId}` key. Rows
// unmount under virtualization, so each row re-registers its ranges on mount.
const rowRanges = new Map<string, Range[]>();

function hasHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight === 'function';
}

function syncHighlightRegistry(): void {
  if (!hasHighlightApi()) return;
  const allRanges = Array.from(rowRanges.values()).flat();
  if (allRanges.length === 0) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  } else {
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...allRanges));
  }
}

export function setRowCitationRanges(key: string, ranges: Range[]): void {
  if (ranges.length > 0) rowRanges.set(key, ranges);
  else rowRanges.delete(key);
  syncHighlightRegistry();
}

export function clearRowCitationRanges(key: string): void {
  if (!rowRanges.has(key)) return;
  rowRanges.delete(key);
  syncHighlightRegistry();
}

/** PAN-4642 WI-8: paints pending-citation quotes inside one message row. Returns
 *  true when the row has at least one pending citation (for `data-cited`). */
export function useCitationHighlight(
  ref: RefObject<HTMLElement | null>,
  conversationName: string,
  messageId: string,
  text: string,
): boolean {
  const citations = useConversationCitations(conversationName);
  const relevant = useMemo(
    () => citations.filter((citation) => citation.source.kind === 'message' && citation.source.messageId === messageId),
    [citations, messageId],
  );

  useLayoutEffect(() => {
    const root = ref.current;
    const key = `${conversationName}:${messageId}`;
    if (!root) return undefined;
    const ranges = relevant
      .map((citation) => findQuoteRange(root, citation.quotedText))
      .filter((range): range is Range => range !== null);
    setRowCitationRanges(key, ranges);
    return () => clearRowCitationRanges(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant, text, conversationName, messageId]);

  return relevant.length > 0;
}

/** PAN-4658: paints pending file-citation quotes inside an editor Preview. */
export function useFileCitationHighlight(
  ref: RefObject<HTMLElement | null>,
  conversationName: string,
  path: string,
  text: string,
): void {
  const citations = useConversationCitations(conversationName);
  const relevant = useMemo(
    () => citations.filter((citation) => citation.source.kind === 'file' && citation.source.path === path),
    [citations, path],
  );

  useLayoutEffect(() => {
    const root = ref.current;
    const key = `${conversationName}:file:${path}`;
    if (!root) return undefined;
    const ranges = relevant
      .map((citation) => findQuoteRange(root, citation.quotedText))
      .filter((range): range is Range => range !== null);
    setRowCitationRanges(key, ranges);
    return () => clearRowCitationRanges(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant, text, conversationName, path]);
}
