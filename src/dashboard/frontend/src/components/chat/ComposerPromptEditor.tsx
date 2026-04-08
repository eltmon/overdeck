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

import { useEffect, useCallback, useRef, useState, type RefObject } from 'react';
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
import styles from '../MissionControl/styles/mission-control.module.css';

// ─── Draft persistence ────────────────────────────────────────────────────────

function getDraftKey(conversationName: string): string {
  return `conv-draft:${conversationName}`;
}

function loadDraft(conversationName: string): string {
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

// ─── Slash commands ───────────────────────────────────────────────────────────

interface SlashCommand {
  id: string;
  label: string;
  description: string;
  insert: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'model',
    label: '/model',
    description: 'Switch the AI model for this conversation',
    insert: '/model ',
  },
  {
    id: 'context',
    label: '/context',
    description: 'Add context from a file or URL',
    insert: '/context ',
  },
  {
    id: 'effort',
    label: '/effort',
    description: 'Set effort level (low, medium, high)',
    insert: '/effort ',
  },
  {
    id: 'cancel',
    label: '/cancel',
    description: 'Cancel the current operation',
    insert: '/cancel',
  },
];

// ─── Inner plugin: handles Enter/Shift+Enter and draft save ──────────────────

interface InnerPluginProps {
  conversationName: string;
  onCommandKeyDown: (key: 'Enter') => void;
  onTextChange: (text: string) => void;
  onSlashKey: () => void;
}

function ComposerPlugin({
  conversationName,
  onCommandKeyDown,
  onTextChange,
  onSlashKey,
}: InnerPluginProps) {
  const [editor] = useLexicalComposerContext();
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          e.preventDefault();
          onSlashKey();
        }
      }
    };

    root.addEventListener('keydown', handleKeyDown);
    return () => root.removeEventListener('keydown', handleKeyDown);
  }, [editor, onSlashKey]);

  // Debounced draft persistence
  const handleChange = useCallback(() => {
    editor.read(() => {
      const text = $getRoot().getTextContent();
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

function SlashMenu({ commands, filter, selectedIndex, onSelect, onClose, anchorRect }: SlashMenuProps) {
  const filtered = commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(filter.toLowerCase()) ||
      cmd.description.toLowerCase().includes(filter.toLowerCase()),
  );

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

  if (filtered.length === 0) return null;

  const top = anchorRect ? anchorRect.bottom + 4 : 0;
  const left = anchorRect ? anchorRect.left : 0;

  return (
    <div
      className={styles.slashMenu}
      style={{ top, left }}
      role="listbox"
      aria-label="Slash commands"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          className={`${styles.slashMenuItem} ${i === selectedIndex ? styles.slashMenuItemSelected : ''}`}
          onClick={() => onSelect(cmd)}
          role="option"
          aria-selected={i === selectedIndex}
        >
          <span className={styles.slashMenuLabel}>{cmd.label}</span>
          <span className={styles.slashMenuDescription}>{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerPromptEditor({
  conversationName,
  disabled = false,
  placeholder = 'Message Claude…',
  onCommandKeyDown,
  editorRef,
  onChange,
}: ComposerPromptEditorProps) {
  const draft = loadDraft(conversationName);

  const [text, setText] = useState(draft);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

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
      onChange?.(t);
    },
    [onChange],
  );

  const handleSlashKey = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setMenuAnchorRect(rect);
    }
    setIsSlashMenuOpen(true);
    setSelectedIndex(0);
  }, []);

  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      const editor = editorRef?.current;
      if (editor) {
        editor.update(() => {
          const root = $getRoot();
          // Get current text content
          const fullText = $getRoot().getTextContent();
          // Remove the trailing '/' that triggered the menu
          const textWithoutSlash = fullText.endsWith('/')
            ? fullText.slice(0, -1)
            : fullText;
          // Clear and rebuild with command inserted
          root.clear();
          const para = $createParagraphNode();
          para.append($createTextNode(textWithoutSlash + command.insert));
          root.append(para);
        });
      }
      setIsSlashMenuOpen(false);
      setSelectedIndex(0);
    },
    [editorRef],
  );

  const handleSlashClose = useCallback(() => {
    setIsSlashMenuOpen(false);
    setSelectedIndex(0);
  }, []);

  // Handle keyboard navigation in slash menu
  useEffect(() => {
    if (!isSlashMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const filtered = SLASH_COMMANDS;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleSlashSelect(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleSlashClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSlashMenuOpen, selectedIndex, handleSlashSelect, handleSlashClose]);

  return (
    <div ref={editorContainerRef} style={{ position: 'relative' }}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className={`${styles.composerEditor} ${disabled ? styles.composerEditorDisabled : ''}`}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={styles.composerEditable}
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
      {isSlashMenuOpen && (
        <SlashMenu
          commands={SLASH_COMMANDS}
          filter=""
          selectedIndex={selectedIndex}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
          anchorRect={menuAnchorRect}
        />
      )}
    </div>
  );
}
