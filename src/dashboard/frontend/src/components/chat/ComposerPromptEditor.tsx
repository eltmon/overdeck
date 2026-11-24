/**
 * ComposerPromptEditor (PAN-451)
 *
 * Lexical-based text input for the conversation composer.
 * - Enter submits (calls onCommandKeyDown with 'Enter')
 * - Ctrl+Enter / Cmd+Enter steers (calls onCommandKeyDown with 'SteerEnter', PAN-4292)
 * - Shift+Enter inserts a newline
 * - Auto-expands up to max-h-[200px], scrollable beyond that
 * - Draft persisted to localStorage (300ms debounce)
 * - Undo/redo via Lexical HistoryPlugin
 * - Triggers (PAN-5662): `@` files, `$` skills and `/` commands open one shared
 *   TriggerMenu; the default placeholder lists the triggers this composer offers
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
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
} from 'lexical';
import { getHarnessBehavior } from '@overdeck/contracts';
import type { Harness } from '../shared/ModelPicker';
import styles from '../CommandDeck/styles/command-deck.module.css';
import { getSlashCommands, SLASH_COMMANDS, type SlashCommand } from './slashCommands';
import { useSkillMentionCommands, useSkillSlashCommands, type SkillSlashContext } from './skillSlashCommands';
import { TriggerMenu, caretAnchorRect, useTriggerMenuKeys } from './TriggerMenu';
import {
  composerPromptHint,
  mentionTriggerContext,
  slashTriggerContext,
  toSkillMentionItems,
  type TriggerContext,
} from './composerTriggers';
import { useFileMentionItems } from './useFileMentionItems';
import { loadDraft, saveDraft } from '../../lib/composerDraft';

export { getSlashCommands, SLASH_COMMANDS };
export type { SlashCommand };
export { loadDraft } from '../../lib/composerDraft';

// ─── Inner plugin: handles Enter/Shift+Enter and draft save ──────────────────

interface InnerPluginProps {
  conversationName: string;
  onCommandKeyDown: (key: 'Enter' | 'SteerEnter') => void;
  /** `beforeCaret` is the caret text node's text up to a collapsed caret, else null (PAN-5662). */
  onTextChange: (text: string, beforeCaret: string | null, root: HTMLElement | null) => void;
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
        onCommandKeyDown(event && (event.ctrlKey || event.metaKey) ? 'SteerEnter' : 'Enter');
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
      // An @ or $ token never contains whitespace, so it always lies inside
      // the caret's text node (PAN-5662 D3).
      let beforeCaret: string | null = null;
      const selection = $getSelection();
      if ($isRangeSelection(selection) && selection.isCollapsed()) {
        const node = selection.anchor.getNode();
        if ($isTextNode(node)) beforeCaret = node.getTextContent().slice(0, selection.anchor.offset);
      }
      onTextChange(text, beforeCaret, editor.getRootElement());

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
  harness?: Harness;
  slashCommandsEnabled?: boolean;
  /** The open conversation's skill scope (PAN-5347); the / menu's Skills group fetches from it. */
  skillContext?: SkillSlashContext;
  /** Explorer root the @ menu searches (PAN-5662); null/undefined = no @ menu. */
  fileRootId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  onCommandKeyDown: (key: 'Enter' | 'SteerEnter') => void;
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

function matchRank(cmd: SlashCommand, normalizedFilter: string, aliasFilter: string | null): number {
  const label = cmd.label.toLowerCase();
  if (label === `/${normalizedFilter}` || (aliasFilter !== null && label === `/${aliasFilter}`)) return 0;
  if (label.includes(normalizedFilter) || (aliasFilter !== null && label.includes(aliasFilter))) return 1;
  return 2;
}

/**
 * Orders matches so the flat array stays category-contiguous (SlashMenu groups
 * rows by category, while selectedIndex walks the flat array) while still
 * surfacing exact and label matches ahead of description-only ones (PAN-5348).
 */
function rankWithinCategories(
  matches: SlashCommand[],
  normalizedFilter: string,
  aliasFilter: string | null,
): SlashCommand[] {
  const categoryOrder: string[] = [];
  const categoryMembers = new Map<string, { cmd: SlashCommand; rank: number; index: number }[]>();
  matches.forEach((cmd, index) => {
    const category = cmd.category || 'Commands';
    let members = categoryMembers.get(category);
    if (members === undefined) {
      members = [];
      categoryOrder.push(category);
      categoryMembers.set(category, members);
    }
    members.push({ cmd, rank: matchRank(cmd, normalizedFilter, aliasFilter), index });
  });

  const categoryBestRank = new Map<string, number>();
  for (const category of categoryOrder) {
    const members = categoryMembers.get(category)!;
    categoryBestRank.set(category, Math.min(...members.map((member) => member.rank)));
  }

  const orderedCategories = [...categoryOrder].sort((left, right) => {
    const rankDelta = categoryBestRank.get(left)! - categoryBestRank.get(right)!;
    if (rankDelta !== 0) return rankDelta;
    return categoryOrder.indexOf(left) - categoryOrder.indexOf(right);
  });

  return orderedCategories.flatMap((category) =>
    categoryMembers.get(category)!
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map((member) => member.cmd));
}

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  const normalizedFilter = filter.toLowerCase();
  const alias = BRAND_ALIASES.find(
    (a) => normalizedFilter === a || normalizedFilter.startsWith(`${a} `),
  );
  const aliasFilter = alias ? `pan${normalizedFilter.slice(alias.length)}` : null;
  const matches = commands.filter((cmd) => {
    const haystack = `${cmd.label} ${cmd.description}`.toLowerCase();
    return (
      haystack.includes(normalizedFilter) ||
      (aliasFilter !== null && haystack.includes(aliasFilter))
    );
  });
  if (!normalizedFilter) return matches;
  return rankWithinCategories(matches, normalizedFilter, aliasFilter);
}

export function SlashMenu({ commands, filter, selectedIndex, onSelect, onClose, anchorRect }: SlashMenuProps) {
  const filtered = filterCommands(commands, filter);
  if (filtered.length === 0) return null;
  return (
    <TriggerMenu
      items={filtered}
      filter={filter}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onClose={onClose}
      anchorRect={anchorRect}
      ariaLabel="Slash commands"
    />
  );
}

// ─── Mention menus (@ files, $ skills) ─────────────────────────────────────────

type MentionChar = '@' | '$';

const NO_MENTION_ITEMS: SlashCommand[] = [];

/** Stable trigger lists, so handleChange keeps its identity across renders. */
const MENTION_CHARS: Record<'none' | 'files' | 'skills' | 'both', readonly MentionChar[]> = {
  none: [],
  files: ['@'],
  skills: ['$'],
  both: ['@', '$'],
};

function mentionCharsFor(files: boolean, skills: boolean): readonly MentionChar[] {
  if (files && skills) return MENTION_CHARS.both;
  if (files) return MENTION_CHARS.files;
  return skills ? MENTION_CHARS.skills : MENTION_CHARS.none;
}

/** The live @ or $ token before the caret, among the triggers this composer offers. */
function mentionContextFor(beforeCaret: string | null, chars: readonly MentionChar[]): TriggerContext | null {
  if (beforeCaret === null) return null;
  for (const char of chars) {
    const context = mentionTriggerContext(beforeCaret, char);
    if (context) return context;
  }
  return null;
}

function mentionKey(context: TriggerContext | null): string | null {
  return context ? `${context.char}:${context.index}` : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComposerPromptEditor({
  slashCommandsEnabled = true,
  conversationName,
  harness = 'claude-code',
  skillContext,
  fileRootId,
  disabled = false,
  placeholder,
  onCommandKeyDown,
  editorRef,
  onChange,
  onPaste,
}: ComposerPromptEditorProps) {
  const draft = loadDraft(conversationName);

  const [text, setText] = useState(draft);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const skillCommands = useSkillSlashCommands({
    harness, context: slashCommandsEnabled ? skillContext : undefined, active: isSlashMenuOpen,
  });
  const pendingSlashTriggerRef = useRef(false);
  const lastTextRef = useRef(draft);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const internalEditorRef = useRef<LexicalEditor | null>(null);

  // @/$ menus open from text and caret changes, not keydown (PAN-5662 D4).
  const skillMention = getHarnessBehavior(harness).capabilities.skillMention;
  const skillMentionsEnabled = skillContext !== undefined && skillMention !== null;
  // An explicit placeholder wins; otherwise list the triggers this composer offers (PAN-5662 D12).
  const effectivePlaceholder = placeholder ?? composerPromptHint({
    files: fileRootId != null,
    skills: skillMentionsEnabled,
    commands: slashCommandsEnabled,
  });
  const mentionChars = mentionCharsFor(Boolean(fileRootId), skillMentionsEnabled);
  const [beforeCaret, setBeforeCaret] = useState<string | null>(null);
  const [dismissedMention, setDismissedMention] = useState<string | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<DOMRect | null>(null);
  const mentionKeyRef = useRef<string | null>(null);
  const mentionFilterKeyRef = useRef<string | null>(null);

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
    (t: string, caretText: string | null, root: HTMLElement | null) => {
      setText(t);
      setBeforeCaret(caretText);
      const context = mentionContextFor(caretText, mentionChars);
      const key = mentionKey(context);
      if (key !== mentionKeyRef.current) {
        mentionKeyRef.current = key;
        if (key === null) setDismissedMention(null);
        else if (root) setMentionAnchorRect(caretAnchorRect(root));
      }
      const filterKey = context ? `${key}:${context.filter}` : null;
      if (filterKey !== mentionFilterKeyRef.current) {
        mentionFilterKeyRef.current = filterKey;
        setMentionSelectedIndex(0);
      }
      // A pending `/` keypress resolves on the first text change: it opens the
      // menu only when the `/` landed at a word start (PAN-5662 D2), so `src/`
      // and `and/or` stay plain text.
      if (pendingSlashTriggerRef.current && t !== lastTextRef.current) {
        pendingSlashTriggerRef.current = false;
        setIsSlashMenuOpen(slashTriggerContext(t) !== null);
      }
      lastTextRef.current = t;
      onChange?.(t);
    },
    [onChange, mentionChars, setDismissedMention, setMentionSelectedIndex],
  );

  const slashContext = useMemo(() => slashTriggerContext(text), [text]);

  const slashCommands = useMemo(
    () => slashCommandsEnabled ? getSlashCommands(harness, skillCommands) : [],
    [harness, slashCommandsEnabled, skillCommands],
  );
  const filteredCommands = useMemo(
    () => filterCommands(slashCommands, slashContext?.filter ?? ''),
    [slashCommands, slashContext],
  );

  const handleSlashKey = useCallback((root: HTMLElement) => {
    if (!slashCommandsEnabled) return;
    // The menu opens on the text change that inserts the `/` (handleChange),
    // so a `/` inside a word never opens it or fetches skills.
    setMenuAnchorRect(caretAnchorRect(root));
    pendingSlashTriggerRef.current = true;
    setSelectedIndex(0);
  }, [slashCommandsEnabled]);

  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      const editor = editorRef?.current;
      if (editor) {
        editor.update(() => {
          const root = $getRoot();
          const fullText = root.getTextContent();
          // Find the word-start '/' that triggered the menu and strip it + any filter chars after it
          const slashIdx = (slashContext ?? slashTriggerContext(fullText))?.index ?? -1;
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
  }, [slashContext?.filter]);

  const mentionContext = mentionContextFor(beforeCaret, mentionChars);
  const mentionOpen = mentionContext !== null && dismissedMention !== mentionKey(mentionContext);
  const { items: fileItems } = useFileMentionItems(
    fileRootId ?? null,
    mentionOpen && mentionContext.char === '@' ? mentionContext.filter : null,
  );
  const mentionSkills = useSkillMentionCommands({
    harness,
    context: skillContext,
    active: mentionOpen && mentionContext.char === '$',
  });
  const skillItems = mentionContext?.char === '$' && skillMention
    ? toSkillMentionItems(mentionSkills, skillMention, mentionContext.filter)
    : NO_MENTION_ITEMS;
  const mentionItems = mentionContext?.char === '@' ? fileItems : mentionContext?.char === '$' ? skillItems : NO_MENTION_ITEMS;
  const mentionHint = mentionContext?.char === '@' && mentionContext.filter === '' ? 'Type to search files' : undefined;
  // Keys are captured only while a menu is on screen: a $ token matching no skill shows nothing and leaves keys alone.
  const mentionVisible = mentionOpen && (mentionItems.length > 0 || mentionHint !== undefined);

  const handleMentionSelect = (item: SlashCommand) => {
    const editor = internalEditorRef.current;
    if (!mentionContext || !editor) return;
    const token = mentionContext.char + mentionContext.filter;
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      const node = selection.anchor.getNode();
      if (!$isTextNode(node)) return;
      const offset = selection.anchor.offset;
      const start = offset - token.length;
      if (start < 0 || node.getTextContent().slice(start, offset) !== token) return;
      node.spliceText(start, token.length, item.insert, true);
    });
    setMentionSelectedIndex(0);
  };
  const handleMentionSelectIndex = (index: number) => {
    const item = mentionItems[index];
    if (item) handleMentionSelect(item);
  };
  const handleMentionClose = () => {
    setDismissedMention(mentionKey(mentionContext));
  };

  useTriggerMenuKeys({
    open: mentionVisible,
    rowCount: mentionItems.length,
    selectedIndex: mentionSelectedIndex,
    setSelectedIndex: setMentionSelectedIndex,
    onSelectIndex: handleMentionSelectIndex,
    onClose: handleMentionClose,
    tabSelects: true,
  });

  // A live @/$ token wins over the / menu (PAN-5662 D5): `/review @fi` shows files.
  const isSlashMenuVisible = isSlashMenuOpen && slashContext !== null && mentionContext === null;
  const handleSlashSelectIndex = (index: number) => {
    const command = filteredCommands[index];
    if (command) handleSlashSelect(command);
  };

  useTriggerMenuKeys({
    open: isSlashMenuVisible,
    rowCount: filteredCommands.length,
    selectedIndex,
    setSelectedIndex,
    onSelectIndex: handleSlashSelectIndex,
    onClose: handleSlashClose,
    tabSelects: false,
  });

  return (
    <div style={{ position: 'relative' }}>
      <LexicalComposer key={conversationName} initialConfig={initialConfig}>
        <div className={`${styles.composerEditor} ${disabled ? styles.composerEditorDisabled : ''}`}>
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={styles.composerEditable}
                onPaste={onPaste}
                aria-placeholder={effectivePlaceholder}
                placeholder={() =>
                  !text ? (
                    <div className={styles.composerPlaceholder}>{effectivePlaceholder}</div>
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
          <EditorRefPlugin editorRef={internalEditorRef} />
          {editorRef && <EditorRefPlugin editorRef={editorRef} />}
        </div>
      </LexicalComposer>
      {isSlashMenuVisible && filteredCommands.length > 0 && (
        <SlashMenu
          commands={slashCommands}
          filter={slashContext.filter}
          selectedIndex={selectedIndex}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
          anchorRect={menuAnchorRect}
        />
      )}
      {mentionVisible && (
        <TriggerMenu
          items={mentionItems}
          filter={mentionContext.filter}
          selectedIndex={mentionSelectedIndex}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
          anchorRect={mentionAnchorRect}
          ariaLabel={mentionContext.char === '@' ? 'Files' : 'Skills'}
          hint={mentionHint}
        />
      )}
    </div>
  );
}
