import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { addCitation } from '../../../lib/composerCitations';
import type { CitationSource, PendingCitation } from '../../../lib/citationFormat';
import { resolveMessageSelection, type SelectionCitationResolver } from './resolveSelectionCitation';

export interface CiteSnapshot {
  source: CitationSource;
  quotedText: string;
  rect: DOMRect;
}

const QUOTE_EXCERPT_LIMIT = 160;
const BOX_WIDTH = 260;

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.hasAttribute('contenteditable');
}

/** PAN-4642 WI-5: tracks the current citable text selection within `rootRef`. */
export function useCiteSelection(
  rootRef: RefObject<HTMLElement | null>,
  resolve: SelectionCitationResolver = resolveMessageSelection,
): { snapshot: CiteSnapshot | null; clear: () => void } {
  const [snapshot, setSnapshot] = useState<CiteSnapshot | null>(null);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const updateFromSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection) {
      setSnapshot(null);
      return;
    }
    if (
      !selection.anchorNode ||
      !selection.focusNode ||
      !root.contains(selection.anchorNode) ||
      !root.contains(selection.focusNode)
    ) {
      setSnapshot(null);
      return;
    }
    const resolved = resolveRef.current(selection);
    if (!resolved) {
      setSnapshot(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSnapshot({ ...resolved, rect });
  }, [rootRef]);

  useEffect(() => {
    document.addEventListener('selectionchange', updateFromSelection);
    document.addEventListener('mouseup', updateFromSelection);
    return () => {
      document.removeEventListener('selectionchange', updateFromSelection);
      document.removeEventListener('mouseup', updateFromSelection);
    };
  }, [updateFromSelection]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleScroll = () => setSnapshot(null);
    root.addEventListener('scroll', handleScroll);
    return () => root.removeEventListener('scroll', handleScroll);
  }, [rootRef]);

  return { snapshot, clear: useCallback(() => setSnapshot(null), []) };
}

/**
 * PAN-4642 review fix: the open comment box must survive the live selection
 * clearing (focusing the textarea moves the document selection out of the cite
 * row, and a timeline scroll clears it too). `isOpen`/`onOpen` are owned by the
 * parent (`CiteSelectionLayer`) precisely so the box's lifetime is independent
 * of `useCiteSelection`'s live snapshot — only Save/Cancel/Escape/a conversation
 * change may close it.
 */
export function CiteSelectionToolbar({
  conversationName,
  snapshot,
  isOpen,
  onOpen,
  onDone,
  onSaved,
}: {
  conversationName: string;
  snapshot: CiteSnapshot;
  isOpen: boolean;
  onOpen: () => void;
  onDone: () => void;
  onSaved?: (citation: PendingCitation) => void;
}) {
  const [comment, setComment] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isOpen) setComment('');
  }, [isOpen]);

  // D13: while the button is visible (box closed), `c`/`C` with no modifiers opens
  // the box, unless focus is already in an editable element.
  useEffect(() => {
    if (isOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableElement(document.activeElement)) return;
      event.preventDefault();
      onOpen();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onOpen]);

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus();
  }, [isOpen]);

  const save = useCallback(() => {
    const citation = addCitation(conversationName, {
      source: snapshot.source,
      quotedText: snapshot.quotedText,
      comment,
    });
    if (citation) onSaved?.(citation);
    window.getSelection()?.removeAllRanges();
    onDone();
  }, [comment, conversationName, snapshot, onDone, onSaved]);

  const cancel = useCallback(() => {
    onDone();
  }, [onDone]);

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    },
    [cancel, save],
  );

  if (!isOpen) {
    const top = Math.max(8, snapshot.rect.top - 36);
    const left = Math.min(Math.max(8, snapshot.rect.left + snapshot.rect.width / 2 - 28), window.innerWidth - 64);
    return createPortal(
      <button
        type="button"
        className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground shadow-md hover:bg-muted"
        style={{ position: 'fixed', top, left, zIndex: 1000 }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onOpen}
      >
        Cite
      </button>,
      document.body,
    );
  }

  // Below the selection, never over it — the box quotes the very text it sits on.
  const top = Math.min(snapshot.rect.bottom + 8, window.innerHeight - 220);
  const left = Math.min(Math.max(8, snapshot.rect.left), window.innerWidth - BOX_WIDTH - 16);
  const excerpt = snapshot.quotedText.length > QUOTE_EXCERPT_LIMIT
    ? `${snapshot.quotedText.slice(0, QUOTE_EXCERPT_LIMIT)}…`
    : snapshot.quotedText;

  return createPortal(
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm text-foreground shadow-lg"
      style={{ position: 'fixed', top, left, width: BOX_WIDTH, zIndex: 1000 }}
    >
      <blockquote className="border-border border-l-2 bg-muted/30 pl-2 text-muted-foreground">{excerpt}</blockquote>
      <textarea
        ref={textareaRef}
        aria-label="Citation comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={handleTextareaKeyDown}
        className="min-h-[60px] rounded-md border border-border bg-background p-2 text-sm text-foreground"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function CiteSelectionLayer({
  conversationName,
  rootRef,
  resolve,
  onSaved,
}: {
  conversationName: string;
  rootRef: RefObject<HTMLElement | null>;
  resolve?: SelectionCitationResolver;
  onSaved?: (citation: PendingCitation) => void;
}) {
  const { snapshot: liveSnapshot, clear } = useCiteSelection(rootRef, resolve);
  const [frozen, setFrozen] = useState<CiteSnapshot | null>(null);

  // A conversation change closes the box.
  useEffect(() => {
    setFrozen(null);
  }, [conversationName]);

  const activeSnapshot = frozen ?? liveSnapshot;
  if (!activeSnapshot) return null;

  return (
    <CiteSelectionToolbar
      conversationName={conversationName}
      snapshot={activeSnapshot}
      isOpen={frozen !== null}
      onOpen={() => setFrozen(liveSnapshot)}
      onDone={() => {
        setFrozen(null);
        clear();
      }}
      onSaved={onSaved}
    />
  );
}
