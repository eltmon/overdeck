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

import { useEffect, useCallback, useRef, useState } from 'react';
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

// ─── Inner plugin: handles Enter/Shift+Enter and draft save ──────────────────

interface InnerPluginProps {
  conversationName: string;
  disabled: boolean;
  onCommandKeyDown: (key: 'Enter') => void;
  onTextChange: (text: string) => void;
}

function ComposerPlugin({
  conversationName,
  disabled,
  onCommandKeyDown,
  onTextChange,
}: InnerPluginProps) {
  const [editor] = useLexicalComposerContext();
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register Enter key handler
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (disabled) return false;
        if (event?.shiftKey) return false; // Allow Shift+Enter to insert newline

        // Submit
        event?.preventDefault();
        onCommandKeyDown('Enter');
        return true; // Consume the event
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, disabled, onCommandKeyDown]);

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

  // Expose editor instance via ref so parent can clear content on submit
  function EditorRefPlugin() {
    const [editor] = useLexicalComposerContext();
    useEffect(() => {
      if (editorRef) {
        (editorRef as React.MutableRefObject<LexicalEditor | null>).current = editor;
      }
    }, [editor]);
    return null;
  }

  return (
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
          disabled={disabled}
          onCommandKeyDown={onCommandKeyDown}
          onTextChange={handleChange}
        />
        <EditorRefPlugin />
      </div>
    </LexicalComposer>
  );
}
