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

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  insert: string;
  category?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  // ─── AI CLI Commands ─────────────────────────────────────────────────────────
  {
    id: 'model',
    label: '/model',
    description: 'Switch the AI model for this conversation',
    insert: '/model ',
    category: 'AI CLI',
  },
  {
    id: 'context',
    label: '/context',
    description: 'Add context from a file or URL',
    insert: '/context ',
    category: 'AI CLI',
  },
  {
    id: 'effort',
    label: '/effort',
    description: 'Set effort level (low, medium, high)',
    insert: '/effort ',
    category: 'AI CLI',
  },
  {
    id: 'cancel',
    label: '/cancel',
    description: 'Cancel the current operation',
    insert: '/cancel',
    category: 'AI CLI',
  },

  // ─── Core System ─────────────────────────────────────────────────────────────
  { id: 'pan-up', label: 'pan up', description: 'Start dashboard and Traefik', insert: 'pan up', category: 'Core' },
  { id: 'pan-down', label: 'pan down', description: 'Stop dashboard and Traefik', insert: 'pan down', category: 'Core' },
  { id: 'pan-status', label: 'pan status', description: 'Show running agents', insert: 'pan status', category: 'Core' },
  { id: 'pan-init', label: 'pan init', description: 'Initialize Panopticon', insert: 'pan init', category: 'Core' },
  { id: 'pan-sync', label: 'pan sync', description: 'Sync skills/agents/rules to devroot', insert: 'pan sync', category: 'Core' },
  { id: 'pan-doctor', label: 'pan doctor', description: 'Check system health', insert: 'pan doctor', category: 'Core' },
  { id: 'pan-update', label: 'pan update', description: 'Update Panopticon', insert: 'pan update', category: 'Core' },
  { id: 'pan-install', label: 'pan install', description: 'Install prerequisites', insert: 'pan install', category: 'Core' },
  { id: 'pan-serve', label: 'pan serve', description: 'Start dashboard and open in browser', insert: 'pan serve', category: 'Core' },
  { id: 'pan-skills', label: 'pan skills', description: 'List and manage skills', insert: 'pan skills', category: 'Core' },
  { id: 'pan-test-run', label: 'pan test run', description: 'Run tests', insert: 'pan test run ', category: 'Core' },

  // ─── Lifecycle ───────────────────────────────────────────────────────────────
  { id: 'pan-start', label: 'pan start', description: 'Spawn agent for an issue', insert: 'pan start ', category: 'Lifecycle' },
  { id: 'pan-tell', label: 'pan tell', description: 'Send message to running agent', insert: 'pan tell ', category: 'Lifecycle' },
  { id: 'pan-kill', label: 'pan kill', description: 'Kill a running agent', insert: 'pan kill ', category: 'Lifecycle' },
  { id: 'pan-resume', label: 'pan resume', description: 'Resume a paused agent', insert: 'pan resume ', category: 'Lifecycle' },
  { id: 'pan-recover', label: 'pan recover', description: 'Recover a crashed agent', insert: 'pan recover ', category: 'Lifecycle' },
  { id: 'pan-sync-main', label: 'pan sync-main', description: 'Sync latest main into feature branch', insert: 'pan sync-main ', category: 'Lifecycle' },
  { id: 'pan-done', label: 'pan done', description: 'Mark agent work complete', insert: 'pan done ', category: 'Lifecycle' },
  { id: 'pan-approve', label: 'pan approve', description: 'Approve agent work and merge', insert: 'pan approve ', category: 'Lifecycle' },
  { id: 'pan-reopen', label: 'pan reopen', description: 'Reopen a completed issue', insert: 'pan reopen ', category: 'Lifecycle' },
  { id: 'pan-wipe', label: 'pan wipe', description: 'Deep wipe: completely reset all state', insert: 'pan wipe ', category: 'Lifecycle' },
  { id: 'pan-close', label: 'pan close', description: 'Close out a completed issue', insert: 'pan close ', category: 'Lifecycle' },
  { id: 'pan-plan', label: 'pan plan', description: 'Create execution plan before spawning', insert: 'pan plan ', category: 'Lifecycle' },
  { id: 'pan-plan-finalize', label: 'pan plan finalize', description: 'Materialize plan to beads', insert: 'pan plan finalize ', category: 'Lifecycle' },
  { id: 'pan-issues', label: 'pan issues', description: 'List and triage issues from configured trackers', insert: 'pan issues', category: 'Lifecycle' },

  // ─── Observation ─────────────────────────────────────────────────────────────
  { id: 'pan-show', label: 'pan show', description: 'Show shadow state, CV, context, health', insert: 'pan show ', category: 'Observation' },
  { id: 'pan-show-cv', label: 'pan show --cv', description: 'Show agent work history (CV)', insert: 'pan show  --cv', category: 'Observation' },
  { id: 'pan-show-context', label: 'pan show --context', description: 'Show context engineering state', insert: 'pan show  --context', category: 'Observation' },
  { id: 'pan-show-health', label: 'pan show --health', description: 'Show health + heartbeat status', insert: 'pan show  --health', category: 'Observation' },

  // ─── Review ──────────────────────────────────────────────────────────────────
  { id: 'pan-review-pending', label: 'pan review pending', description: 'Show completed work awaiting review', insert: 'pan review pending', category: 'Review' },
  { id: 'pan-review-request', label: 'pan review request', description: 'Request re-review after fixing feedback', insert: 'pan review request ', category: 'Review' },
  { id: 'pan-review-reset', label: 'pan review reset', description: 'Reset review/test/merge cycles', insert: 'pan review reset ', category: 'Review' },
  { id: 'pan-review-reset-session', label: 'pan review reset --session', description: 'Reset review and clear saved Claude session', insert: 'pan review reset  --session', category: 'Review' },

  // ─── Workspace ───────────────────────────────────────────────────────────────
  { id: 'pan-workspace-create', label: 'pan workspace create', description: 'Create workspace for issue', insert: 'pan workspace create ', category: 'Workspace' },
  { id: 'pan-workspace-list', label: 'pan workspace list', description: 'List all workspaces', insert: 'pan workspace list', category: 'Workspace' },
  { id: 'pan-workspace-destroy', label: 'pan workspace destroy', description: 'Destroy workspace', insert: 'pan workspace destroy ', category: 'Workspace' },
  { id: 'pan-workspace-update', label: 'pan workspace update', description: 'Update skills/agents/rules in workspace', insert: 'pan workspace update ', category: 'Workspace' },
  { id: 'pan-workspace-migrate', label: 'pan workspace migrate', description: 'Migrate workspace local ↔ remote', insert: 'pan workspace migrate ', category: 'Workspace' },
  { id: 'pan-workspace-ssh', label: 'pan workspace ssh', description: 'SSH into remote workspace VM', insert: 'pan workspace ssh ', category: 'Workspace' },
  { id: 'pan-workspace-sync-auth', label: 'pan workspace sync-auth', description: 'Sync Claude credentials to remote', insert: 'pan workspace sync-auth ', category: 'Workspace' },
  { id: 'pan-workspace-start', label: 'pan workspace start', description: 'Start a stopped remote workspace', insert: 'pan workspace start ', category: 'Workspace' },
  { id: 'pan-workspace-stop', label: 'pan workspace stop', description: 'Stop (hibernate) a remote workspace', insert: 'pan workspace stop ', category: 'Workspace' },
  { id: 'pan-workspace-add-repo', label: 'pan workspace add-repo', description: 'Add repos to polyrepo workspace', insert: 'pan workspace add-repo ', category: 'Workspace' },

  // ─── Admin: Cloister ─────────────────────────────────────────────────────────
  { id: 'pan-admin-cloister-status', label: 'pan admin cloister status', description: 'Show Cloister service status', insert: 'pan admin cloister status', category: 'Admin' },
  { id: 'pan-admin-cloister-start', label: 'pan admin cloister start', description: 'Start Cloister monitoring', insert: 'pan admin cloister start', category: 'Admin' },
  { id: 'pan-admin-cloister-stop', label: 'pan admin cloister stop', description: 'Stop Cloister monitoring', insert: 'pan admin cloister stop', category: 'Admin' },
  { id: 'pan-admin-cloister-emergency-stop', label: 'pan admin cloister emergency-stop', description: 'Emergency stop — kill ALL agents', insert: 'pan admin cloister emergency-stop', category: 'Admin' },

  // ─── Convoy ──────────────────────────────────────────────────────────────────
  { id: 'pan-convoy-start', label: 'pan convoy start', description: 'Start a new convoy', insert: 'pan convoy start ', category: 'Convoy' },
  { id: 'pan-convoy-status', label: 'pan convoy status', description: 'Show convoy status', insert: 'pan convoy status ', category: 'Convoy' },
  { id: 'pan-convoy-list', label: 'pan convoy list', description: 'List all convoys', insert: 'pan convoy list', category: 'Convoy' },
  { id: 'pan-convoy-stop', label: 'pan convoy stop', description: 'Stop a running convoy', insert: 'pan convoy stop ', category: 'Convoy' },

  // ─── Admin: Specialists ──────────────────────────────────────────────────────
  { id: 'pan-admin-specialists-list', label: 'pan admin specialists list', description: 'Show all specialists with status', insert: 'pan admin specialists list', category: 'Admin' },
  { id: 'pan-admin-specialists-wake', label: 'pan admin specialists wake', description: 'Wake up a specialist agent', insert: 'pan admin specialists wake ', category: 'Admin' },
  { id: 'pan-admin-specialists-queue', label: 'pan admin specialists queue', description: 'Show pending specialist work', insert: 'pan admin specialists queue ', category: 'Admin' },
  { id: 'pan-admin-specialists-reset', label: 'pan admin specialists reset', description: 'Reset a specialist', insert: 'pan admin specialists reset ', category: 'Admin' },
  { id: 'pan-admin-specialists-clear-queue', label: 'pan admin specialists clear-queue', description: 'Clear specialist queue', insert: 'pan admin specialists clear-queue ', category: 'Admin' },
  { id: 'pan-admin-specialists-done', label: 'pan admin specialists done', description: 'Signal specialist completion', insert: 'pan admin specialists done', category: 'Admin' },
  { id: 'pan-admin-specialists-logs', label: 'pan admin specialists logs', description: 'View specialist run logs', insert: 'pan admin specialists logs', category: 'Admin' },
  { id: 'pan-admin-specialists-cleanup-logs', label: 'pan admin specialists cleanup-logs', description: 'Clean up old specialist logs', insert: 'pan admin specialists cleanup-logs', category: 'Admin' },

  // ─── Project ─────────────────────────────────────────────────────────────────
  { id: 'pan-project-add', label: 'pan project add', description: 'Register a project', insert: 'pan project add ', category: 'Project' },
  { id: 'pan-project-list', label: 'pan project list', description: 'List all registered projects', insert: 'pan project list', category: 'Project' },
  { id: 'pan-project-show', label: 'pan project show', description: 'Show project details', insert: 'pan project show ', category: 'Project' },
  { id: 'pan-project-remove', label: 'pan project remove', description: 'Remove a project', insert: 'pan project remove ', category: 'Project' },
  { id: 'pan-project-init', label: 'pan project init', description: 'Initialize projects.yaml', insert: 'pan project init', category: 'Project' },

  // ─── Admin: Remote ───────────────────────────────────────────────────────────
  { id: 'pan-admin-remote-status', label: 'pan admin remote status', description: 'Show Fly.io connection status', insert: 'pan admin remote status', category: 'Admin' },
  { id: 'pan-admin-remote-init', label: 'pan admin remote init', description: 'Initialize Fly.io app', insert: 'pan admin remote init', category: 'Admin' },
  { id: 'pan-admin-remote-resources', label: 'pan admin remote resources', description: 'Show RAM/disk usage across VMs', insert: 'pan admin remote resources', category: 'Admin' },
  { id: 'pan-admin-remote-setup', label: 'pan admin remote setup', description: 'Setup Fly.io integration', insert: 'pan admin remote setup', category: 'Admin' },

  // ─── Admin: DB & Beads ───────────────────────────────────────────────────────
  { id: 'pan-admin-db-snapshot', label: 'pan admin db snapshot', description: 'Create database snapshot', insert: 'pan admin db snapshot', category: 'Admin' },
  { id: 'pan-admin-db-seed', label: 'pan admin db seed', description: 'Seed database', insert: 'pan admin db seed ', category: 'Admin' },
  { id: 'pan-admin-beads-compact', label: 'pan admin beads compact', description: 'Compact beads database', insert: 'pan admin beads compact', category: 'Admin' },
  { id: 'pan-admin-beads-stats', label: 'pan admin beads stats', description: 'Show beads statistics', insert: 'pan admin beads stats', category: 'Admin' },
  { id: 'pan-admin-config-shadow', label: 'pan admin config shadow', description: 'Configure shadow mode', insert: 'pan admin config shadow', category: 'Admin' },
  { id: 'pan-admin-hooks-install', label: 'pan admin hooks install', description: 'Install/update Claude Code heartbeat hooks', insert: 'pan admin hooks install', category: 'Admin' },
  { id: 'pan-admin-tldr', label: 'pan admin tldr', description: 'TLDR daemon management', insert: 'pan admin tldr ', category: 'Admin' },
  { id: 'pan-admin-fpp', label: 'pan admin fpp', description: 'FPP hooks: check, push, pop, clear', insert: 'pan admin fpp ', category: 'Admin' },
  { id: 'pan-admin-tracker-linear-states', label: 'pan admin tracker linear-states', description: 'Manage Linear workflow states', insert: 'pan admin tracker linear-states', category: 'Admin' },
  { id: 'pan-admin-tracker-linear-cleanup', label: 'pan admin tracker linear-cleanup', description: 'Clean up Linear custom states', insert: 'pan admin tracker linear-cleanup', category: 'Admin' },
  { id: 'pan-admin-migrate-config', label: 'pan admin migrate-config', description: 'Migrate settings.json to config.yaml', insert: 'pan admin migrate-config', category: 'Admin' },

  // ─── Data ────────────────────────────────────────────────────────────────────
  { id: 'pan-backup-list', label: 'pan backup list', description: 'List all backups', insert: 'pan backup list', category: 'Data' },
  { id: 'pan-backup-clean', label: 'pan backup clean', description: 'Remove old backups', insert: 'pan backup clean', category: 'Data' },
  { id: 'pan-restore', label: 'pan restore', description: 'Restore from backup', insert: 'pan restore ', category: 'Data' },
  { id: 'pan-inspect', label: 'pan inspect', description: 'Inspect workspace state', insert: 'pan inspect ', category: 'Data' },
  { id: 'pan-cost-today', label: 'pan cost today', description: 'Show cost tracking for today', insert: 'pan cost today', category: 'Data' },
  { id: 'pan-cost-sync', label: 'pan cost sync', description: 'Import cost events from WAL files', insert: 'pan cost sync', category: 'Data' },
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

function filterCommands(commands: SlashCommand[], filter: string): SlashCommand[] {
  const normalizedFilter = filter.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(normalizedFilter) ||
      cmd.description.toLowerCase().includes(normalizedFilter),
  );
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
  placeholder = 'Message Claude…',
  onCommandKeyDown,
  editorRef,
  onChange,
}: ComposerPromptEditorProps) {
  const draft = loadDraft(conversationName);

  const [text, setText] = useState(draft);
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false);
  const [pendingSlashTrigger, setPendingSlashTrigger] = useState(false);
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
      if (pendingSlashTrigger && t.includes('/')) {
        setIsSlashMenuOpen(true);
        setPendingSlashTrigger(false);
      }
      onChange?.(t);
    },
    [onChange, pendingSlashTrigger],
  );

  const slashContext = useMemo(() => {
    const slashIdx = text.lastIndexOf('/');
    if (slashIdx < 0) return null;

    const afterSlash = text.slice(slashIdx + 1);
    if (/\s/.test(afterSlash)) return null;

    return {
      slashIdx,
      filterText: afterSlash,
    };
  }, [text]);

  const filteredCommands = useMemo(
    () => filterCommands(SLASH_COMMANDS, slashContext?.filterText ?? ''),
    [slashContext],
  );

  const handleSlashKey = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setMenuAnchorRect(rect);
    }
    setPendingSlashTrigger(true);
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
      setPendingSlashTrigger(false);
      setSelectedIndex(0);
    },
    [editorRef, slashContext],
  );

  const handleSlashClose = useCallback(() => {
    setIsSlashMenuOpen(false);
    setPendingSlashTrigger(false);
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    if (!isSlashMenuOpen) return;
    if (!slashContext) {
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
      {isSlashMenuOpen && slashContext && filteredCommands.length > 0 && (
        <SlashMenu
          commands={SLASH_COMMANDS}
          filter={slashContext.filterText}
          selectedIndex={selectedIndex}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
          anchorRect={menuAnchorRect}
        />
      )}
    </div>
  );
}
