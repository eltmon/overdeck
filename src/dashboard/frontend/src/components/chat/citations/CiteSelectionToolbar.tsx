import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { addCitation } from '../../../lib/composerCitations';
import { resolveSelectionCitation } from './resolveSelectionCitation';

export interface CiteSnapshot {
  messageId: string;
  role: 'assistant' | 'user';
  quotedText: string;
  rect: DOMRect;
}

const QUOTE_EXCERPT_LIMIT = 160;

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.hasAttribute('contenteditable');
}

/** PAN-4642 WI-5: tracks the current citable text selection within `rootRef`. */
export function useCiteSelection(rootRef: RefObject<HTMLElement | null>): { snapshot: CiteSnapshot | null; clear: () => void } {
  const [snapshot, setSnapshot] = useState<CiteSnapshot | null>(null);

  const updateFromSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection) {
      setSnapshot(null);
      return;
    }
    const resolved = resolveSelectionCitation(selection);
    if (!resolved || !selection.anchorNode || !root.contains(selection.anchorNode)) {
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

export function CiteSelectionToolbar({
  conversationName,
  snapshot,
  onDone,
}: {
  conversationName: string;
  snapshot: CiteSnapshot;
  onDone: () => void;
}) {
  const [frozen, setFrozen] = useState<CiteSnapshot | null>(null);
  const [comment, setComment] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // A conversation change closes the box.
  useEffect(() => {
    setFrozen(null);
    setComment('');
  }, [conversationName]);

  const open = useCallback(() => {
    setFrozen(snapshot);
    setComment('');
  }, [snapshot]);

  // D13: while the button is visible (box closed), `c`/`C` with no modifiers opens
  // the box, unless focus is already in an editable element.
  useEffect(() => {
    if (frozen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'c' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableElement(document.activeElement)) return;
      open();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [frozen, open]);

  useEffect(() => {
    if (frozen) textareaRef.current?.focus();
  }, [frozen]);

  const save = useCallback(() => {
    if (!frozen) return;
    addCitation(conversationName, {
      source: { kind: 'message', messageId: frozen.messageId, role: frozen.role },
      quotedText: frozen.quotedText,
      comment,
    });
    window.getSelection()?.removeAllRanges();
    setFrozen(null);
    onDone();
  }, [comment, conversationName, frozen, onDone]);

  const cancel = useCallback(() => {
    setFrozen(null);
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

  if (!frozen) {
    const top = Math.max(8, snapshot.rect.top - 36);
    const left = Math.min(Math.max(8, snapshot.rect.left + snapshot.rect.width / 2 - 28), window.innerWidth - 64);
    return createPortal(
      <button
        type="button"
        style={{ position: 'fixed', top, left, zIndex: 1000 }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={open}
      >
        Cite
      </button>,
      document.body,
    );
  }

  const top = Math.max(8, frozen.rect.top - 36) + 32;
  const left = Math.min(Math.max(8, frozen.rect.left + frozen.rect.width / 2 - 28), window.innerWidth - 64);
  const excerpt = frozen.quotedText.length > QUOTE_EXCERPT_LIMIT
    ? `${frozen.quotedText.slice(0, QUOTE_EXCERPT_LIMIT)}…`
    : frozen.quotedText;

  return createPortal(
    <div style={{ position: 'fixed', top, left, zIndex: 1000 }}>
      <blockquote>{excerpt}</blockquote>
      <textarea
        ref={textareaRef}
        aria-label="Citation comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={handleTextareaKeyDown}
      />
      <button type="button" onClick={save}>Save</button>
      <button type="button" onClick={cancel}>Cancel</button>
    </div>,
    document.body,
  );
}

export function CiteSelectionLayer({
  conversationName,
  rootRef,
}: {
  conversationName: string;
  rootRef: RefObject<HTMLElement | null>;
}) {
  const { snapshot, clear } = useCiteSelection(rootRef);
  if (!snapshot) return null;
  return <CiteSelectionToolbar conversationName={conversationName} snapshot={snapshot} onDone={clear} />;
}
