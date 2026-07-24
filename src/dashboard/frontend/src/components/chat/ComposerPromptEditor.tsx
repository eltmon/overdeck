/**
 * ComposerPromptEditor (PAN-451)
 *
 * Lexical-based text input for the conversation composer.
 * - Enter submits (calls onCommandKeyDown with 'Enter')
 * - Shift+Enter inserts a newline
 * - Auto-expands up to max-h-[200px], scrollable beyond that
 * - Draft persisted to localStorage (300ms debounce)
 * - Undo/redo via Lexical HistoryPlugin
 */

import { useEffect, useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  type LexicalEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from 'lexical';
import styles from '../CommandDeck/styles/command-deck.module.css';
import { SLASH_COMMANDS, type SlashCommand } from './slashCommands';

export { SLASH_COMMANDS };
export type { SlashCommand };

// ─── Draft persistence ────────────────────────────────────────────────────────

function getDraftKey(conversationName: string): string {
  return `conv-draft:${conversationName}`;
}

export function loadDraft(conversationName: string): string {
  try {
    return localStorage.getItem(getDraftKey(conversationName)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(conversationName: string, text: string): void {
  try {
    if (text) {
      localStorage.setItem(getDraftKey(conversationName), text);
    } else {
      localStorage.removeItem(getDraftKey(conversationName));
    }
  } catch {
    // Storage full or unavailable
  }
}

// ─── Inner plugin: handles Enter/Shift+Enter and draft save ──────────────────

interface InnerPluginProps {
  conversationName: string;
  onCommandKeyDown: (key: 'Enter') => void;
  onTextChange: (text: string) => void;
  onSlashKey: (root: HTMLElement) => void;
}

function ComposerPlugin({
  conversationName,
  onCommandKeyDown,
  onTextChange,
  onSlashKey,
}: InnerPluginProps) {
  const [editor] = useLexicalComposerContext();
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestTextRef = useRef(loadDraft(conversationName));
  const unmountingRef = useRef(false);

  // Register Enter key handler.
  // NOTE: We do NOT check `disabled` here — the submit handler owns that check.
  // Checking disabled in the Lexical layer can silently swallow Enter if the
  // closure captures a stale `disabled=true` value after a render cycle.
  // When not disabled, we consume the event (return true) so no newline is inserted.
  // When disabled, we still consume (return true) so behavior is consistent.
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey) return false; // Allow Shift+Enter to insert newline

        // Consume the event and delegate to the submit handler
        event?.preventDefault();
        onCommandKeyDown('Enter');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onCommandKeyDown]);

  // Register / key handler to trigger slash menu
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target === root || root.contains(target)) {
          onSlashKey(root);
        }
      }
    };

    root.addEventListener('keydown', handleKeyDown);
    return () => root.removeEventListener('keydown', handleKeyDown);
  }, [editor, onSlashKey]);

  // Flush draft to localStorage on unmount so tab switches don't lose text
  useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      saveDraft(conversationName, latestTextRef.current);
    };
  }, [conversationName]);

  // Flush draft on page teardown (hard reload, tab close, crash, dev-mode HMR
  // full-page reload). React effect cleanups do NOT run on a page-level
  // teardown — only on clean in-app unmounts — so the unmount flush above is
  // not enough. Without this, text typed within the debounce window (or typed
  // continuously, which keeps resetting the debounce) is lost when the page
  // reloads out from under the editor. pagehide fires on reload/close/bfcache;
  // visibilitychange→hidden is the more reliable mobile/background signal.
  useEffect(() => {
    const flush = () => saveDraft(conversationName, latestTextRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [conversationName]);

  // Debounced draft persistence
  const handleChange = useCallback(() => {
    if (unmountingRef.current) return;
    editor.read(() => {
      const text = $getRoot().getTextContent();
      latestTextRef.current = text;
      onTextChange(text);

      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        saveDraft(conversationName, text);
      }, 300);
    });
  }, [editor, conversationName, onTextChange]);

  return <OnChangePlugin onChange={handleChange} />;
}

// ─── EditorRefPlugin — must be top-level so React doesn't remount it every render ─

interface EditorRefPluginProps {
  editorRef: RefObject<LexicalEditor | null>;
}

function EditorRefPlugin({ editorRef }: EditorRefPluginProps) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    (editorRef as React.MutableRefObject<LexicalEditor | null>).current = editor;
    return () => {
      (editorRef as React.MutableRefObject<LexicalEditor | null>).current = null;
    };
  }, [editor, editorRef]);
  return null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ComposerPromptEditorProps {
  conversationName: string;
  disabled?: boolean;
  placeholder?: string;
  onCommandKeyDown: (key: 'Enter') => void;
  /** Exposed so parent can read current text on submit */
  editorRef?: React.RefObject<LexicalEditor | null>;
  /** Callback whenever text content changes */
  onChange?: (text: string) => void;
  /** Paste handler registered on the editor root element */
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
}

// ─── Slash Menu ───────────────────────────────────────────────────────────────

interface SlashMenuProps {
  commands: SlashCommand[];
  filter: string;
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

// `pan` is the canonical CLI verb; `ovr` and `overdeck` are brand aliases.
// Typing either (optionally followed by a verb) surfaces the same `pan …`
// entries, so "/ovr sync" matches the "pan sync" command.
const BRAND_ALIASES = ['overdeck', 'ovr'];

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  const normalizedFilter = filter.toLowerCase();
  const alias = BRAND_ALIASES.find(
    (a) => normalizedFilter === a || normalizedFilter.startsWith(`${a} `),
  );
  const aliasFilter = alias ? `pan${normalizedFilter.slice(alias.length)}` : null;
  return commands.filter((cmd) => {
    const haystack = `${cmd.label} ${cmd.description}`.toLowerCase();
    return (
      haystack.includes(normalizedFilter) ||
      (aliasFilter !== null && haystack.includes(aliasFilter))
    );
  });
}

function renderHighlightedText(text: string, filter: string, className: string) {
  if (!filter) return text;

  const normalizedText = text.toLowerCase();
  const normalizedFilter = filter.toLowerCase();
  const matchIndex = normalizedText.indexOf(normalizedFilter);

  if (matchIndex < 0) return text;

  const matchEnd = matchIndex + filter.length;
  return (
    <>
      {text.slice(0, matchIndex)}
      <mark className={className}>{text.slice(matchIndex, matchEnd)}</mark>
      {text.slice(matchEnd)}
    </>
  );
}

export function SlashMenu({ commands, filter, selectedIndex, onSelect, onClose, anchorRect }: SlashMenuProps) {
  const filtered = filterCommands(commands, filter);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.slashMenu}`)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll the selected item into view
  useEffect(() => {
    if (menuRef.current) {
      const selected = menuRef.current.querySelector('[aria-selected="true"]');
      if (selected && typeof (selected as HTMLElement).scrollIntoView === 'function') {
        (selected as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  // Always position above the anchor (composer is at the bottom of the screen)
  const left = anchorRect ? anchorRect.left : 0;
  const bottom = anchorRect ? window.innerHeight - anchorRect.top + 4 : 0;

  // Group commands by category
  const groupedCommands = filtered.reduce((acc, cmd) => {
    const category = cmd.category || 'Commands';
    if (!acc[category]) acc[category] = [];
    acc[category].push(cmd);
    return acc;
  }, {} as Record<string, SlashCommand[]>);

  const categories = Object.keys(groupedCommands);

  return (
    <div
      ref={menuRef}
      className={styles.slashMenu}
      style={{ bottom, left }}
      role="listbox"
      aria-label="Slash commands"
    >
      {categories.map((category) => (
        <div key={category}>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-3 py-1.5">
            {category}
          </div>
          {groupedCommands[category].map((cmd) => {
            const globalIndex = filtered.findIndex(c => c.id === cmd.id);
            const labelMatches = filter ? cmd.label.toLowerCase().includes(filter.toLowerCase()) : false;
            return (
              <button
                key={cmd.id}
                className={`${styles.slashMenuItem} ${globalIndex === selectedIndex ? styles.slashMenuItemSelected : ''}`}
                onClick={() => onSelect(cmd)}
                role="option"
                aria-selected={globalIndex === selectedIndex}
              >
                <span className={styles.slashMenuLabel}>
                  {labelMatches
                    ? renderHighlightedText(cmd.label, filter, styles.slashMenuMatch)
                    : cmd.label}
                </span>
                <span className={styles.slashMenuDescription}>
                  {labelMatches
                    ? cmd.description
                    : renderHighlightedText(cmd.description, filter, styles.slashMenuMatch)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerPromptEditor({
  conversationName,
  disabled = false,
  placeholder = 'Message the agent…',
  onCommandKeyDown,
  editorRef,
  onChange,
  onPaste,
}: ComposerPromptEditorProps) {
  const draft = loadDraft(conversationName);

  const [text, setText] = useState(draft);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const pendingSlashTriggerRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);

  const initialConfig = {
    namespace: `composer:${conversationName}`,
    onError: (err: Error) => console.error('[ComposerPromptEditor]', err),
    ...(draft
      ? {
          editorState: (_editor: LexicalEditor) => {
            const root = $getRoot();
            const para = $createParagraphNode();
            para.append($createTextNode(draft));
            root.append(para);
          },
        }
      : {}),
  };

  const handleChange = useCallback(
    (t: string) => {
      setText(t);
      if (pendingSlashTriggerRef.current && t.includes('/')) {
        setIsSlashMenuOpen(true);
        pendingSlashTriggerRef.current = false;
      }
      onChange?.(t);
    },
    [onChange],
  );

  const slashContext = useMemo(() => {
    const slashIdx = text.lastIndexOf('/');
    if (slashIdx < 0) return null;

    const afterSlash = text.slice(slashIdx + 1);

    return {
      slashIdx,
      filterText: afterSlash,
    };
  }, [text]);

  const filteredCommands = useMemo(
    () => filterCommands(SLASH_COMMANDS, slashContext?.filterText ?? ''),
    [slashContext],
  );

  const handleSlashKey = useCallback((root: HTMLElement) => {
    const selection = window.getSelection();
    let anchorRect: DOMRect | null = null;

    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0 || rect.bottom > 0) {
        anchorRect = rect;
      }
    }

    if (!anchorRect) {
      anchorRect = root.getBoundingClientRect();
    }

    setMenuAnchorRect(anchorRect);
    pendingSlashTriggerRef.current = true;
    setIsSlashMenuOpen(true);
    setSelectedIndex(0);
  }, []);

  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      const editor = editorRef?.current;
      if (editor) {
        editor.update(() => {
          const root = $getRoot();
          const fullText = root.getTextContent();
          // Find the last '/' that triggered the menu and strip it + any filter chars after it
          const slashIdx = slashContext?.slashIdx ?? fullText.lastIndexOf('/');
          const textBefore = slashIdx >= 0 ? fullText.slice(0, slashIdx) : fullText;
          // Replace editor content: text before the slash trigger + the selected command
          root.clear();
          const para = $createParagraphNode();
          para.append($createTextNode(textBefore + command.insert));
          root.append(para);
        });
      }
      setIsSlashMenuOpen(false);
      pendingSlashTriggerRef.current = false;
      setSelectedIndex(0);
    },
    [editorRef, slashContext],
  );

  const handleSlashClose = useCallback(() => {
    setIsSlashMenuOpen(false);
    pendingSlashTriggerRef.current = false;
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    if (!isSlashMenuOpen) return;
    if (!pendingSlashTriggerRef.current && !slashContext) {
      handleSlashClose();
    }
  }, [isSlashMenuOpen, slashContext, handleSlashClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [slashContext?.filterText]);

  // Handle keyboard navigation in slash menu
  useEffect(() => {
    if (!isSlashMenuOpen || !slashContext) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (filteredCommands.length > 0) setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (filteredCommands.length > 0) setSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        if (filteredCommands.length > 0 && filteredCommands[selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          handleSlashSelect(filteredCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleSlashClose();
      } else if (e.key === 'Tab') {
        handleSlashClose();
      }
    };

    // Use capture phase so we intercept before Lexical's keydown handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isSlashMenuOpen, slashContext, selectedIndex, filteredCommands, handleSlashSelect, handleSlashClose]);

  return (
    <div style={{ position: 'relative' }}>
      <LexicalComposer key={conversationName} initialConfig={initialConfig}>
        <div className={`${styles.composerEditor} ${disabled ? styles.composerEditorDisabled : ''}`}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={styles.composerEditable}
                onPaste={onPaste}
                aria-placeholder={placeholder}
                placeholder={() =>
                  !text ? (
                    <div className={styles.composerPlaceholder}>{placeholder}</div>
                  ) : null
                }
              />
            }
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <HistoryPlugin />
          <ComposerPlugin
            conversationName={conversationName}
            onCommandKeyDown={onCommandKeyDown}
            onTextChange={handleChange}
            onSlashKey={handleSlashKey}
          />
          {editorRef && <EditorRefPlugin editorRef={editorRef} />}
        </div>
      </LexicalComposer>
      {isSlashMenuOpen && filteredCommands.length > 0 && (
        <SlashMenu
          commands={SLASH_COMMANDS}
          filter={slashContext?.filterText ?? ''}
          selectedIndex={selectedIndex}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
          anchorRect={menuAnchorRect}
        />
      )}
    </div>
  );
}
