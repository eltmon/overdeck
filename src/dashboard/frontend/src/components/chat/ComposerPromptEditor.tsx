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
  {
    id: 'all-up',
    label: '/all-up',
    description: 'Run the Fix-All flywheel: pan-oversee every PAN issue, fix substrate bugs at root cause, surface merge-ready issues on the Awaiting Merge page',
    insert: '/all-up',
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
  { id: 'pan-migrate-config', label: 'pan migrate-config', description: 'Migrate settings.json to config.yaml', insert: 'pan migrate-config', category: 'Core' },
  { id: 'pan-test-run', label: 'pan test run', description: 'Run tests', insert: 'pan test run ', category: 'Core' },
  { id: 'pan-plan-finalize', label: 'pan plan-finalize', description: 'Finalize a planning session: create beads from vBRIEF and write completion marker', insert: 'pan plan-finalize', category: 'Core' },

  // ─── Work (Agent Management) ─────────────────────────────────────────────────
  { id: 'pan-work-issue', label: 'pan work issue', description: 'Spawn agent for an issue', insert: 'pan work issue ', category: 'Work' },
  { id: 'pan-work-status', label: 'pan work status', description: 'Show all running agents', insert: 'pan work status', category: 'Work' },
  { id: 'pan-work-tell', label: 'pan work tell', description: 'Send message to running agent', insert: 'pan work tell ', category: 'Work' },
  { id: 'pan-work-kill', label: 'pan work kill', description: 'Kill an agent', insert: 'pan work kill ', category: 'Work' },
  { id: 'pan-work-pending', label: 'pan work pending', description: 'Show completed work awaiting review', insert: 'pan work pending', category: 'Work' },
  { id: 'pan-work-approve', label: 'pan work approve', description: 'Approve agent work and merge MR', insert: 'pan work approve ', category: 'Work' },
  { id: 'pan-work-list', label: 'pan work list', description: 'List issues from configured trackers', insert: 'pan work list', category: 'Work' },
  { id: 'pan-work-triage', label: 'pan work triage', description: 'Triage secondary tracker issues', insert: 'pan work triage ', category: 'Work' },
  { id: 'pan-work-plan', label: 'pan work plan', description: 'Create execution plan before spawning', insert: 'pan work plan ', category: 'Work' },
  { id: 'pan-work-recover', label: 'pan work recover', description: 'Recover crashed agents', insert: 'pan work recover ', category: 'Work' },
  { id: 'pan-work-cv', label: 'pan work cv', description: 'View agent CVs and rankings', insert: 'pan work cv ', category: 'Work' },
  { id: 'pan-work-reopen', label: 'pan work reopen', description: 'Reopen a completed issue', insert: 'pan work reopen ', category: 'Work' },
  { id: 'pan-work-request-review', label: 'pan work request-review', description: 'Request re-review after fixing feedback', insert: 'pan work request-review ', category: 'Work' },
  { id: 'pan-work-reset-review', label: 'pan work reset-review', description: 'Reset review/test/merge cycles', insert: 'pan work reset-review ', category: 'Work' },
  { id: 'pan-work-reset-session', label: 'pan work reset-session', description: 'Clear saved Claude session', insert: 'pan work reset-session ', category: 'Work' },
  { id: 'pan-work-wipe', label: 'pan work wipe', description: 'Deep wipe: completely reset all state', insert: 'pan work wipe ', category: 'Work' },
  { id: 'pan-work-shadow', label: 'pan work shadow', description: 'Show shadow state details', insert: 'pan work shadow ', category: 'Work' },
  { id: 'pan-work-sync', label: 'pan work sync', description: 'Sync shadow state to tracker', insert: 'pan work sync ', category: 'Work' },
  { id: 'pan-work-refresh', label: 'pan work refresh', description: 'Refresh tracker status cache', insert: 'pan work refresh ', category: 'Work' },
  { id: 'pan-work-sync-main', label: 'pan work sync-main', description: 'Sync latest main into feature branch', insert: 'pan work sync-main ', category: 'Work' },
  { id: 'pan-work-close-out', label: 'pan work close-out', description: 'Close out a completed issue', insert: 'pan work close-out ', category: 'Work' },
  { id: 'pan-work-hook', label: 'pan work hook', description: 'FPP hooks: check, push, pop, clear', insert: 'pan work hook ', category: 'Work' },
  { id: 'pan-work-context', label: 'pan work context', description: 'Context engineering: state, checkpoint', insert: 'pan work context ', category: 'Work' },
  { id: 'pan-work-health', label: 'pan work health', description: 'Health monitoring: check, status, ping', insert: 'pan work health ', category: 'Work' },
  { id: 'pan-work-tldr', label: 'pan work tldr', description: 'TLDR daemon management', insert: 'pan work tldr ', category: 'Work' },
  { id: 'pan-work-linear-states', label: 'pan work linear-states', description: 'Manage Linear workflow states', insert: 'pan work linear-states', category: 'Work' },
  { id: 'pan-work-linear-cleanup', label: 'pan work linear-cleanup', description: 'Clean up Linear custom states', insert: 'pan work linear-cleanup', category: 'Work' },

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

  // ─── Cloister ────────────────────────────────────────────────────────────────
  { id: 'pan-cloister-status', label: 'pan cloister status', description: 'Show Cloister service status', insert: 'pan cloister status', category: 'Cloister' },
  { id: 'pan-cloister-start', label: 'pan cloister start', description: 'Start Cloister monitoring', insert: 'pan cloister start', category: 'Cloister' },
  { id: 'pan-cloister-stop', label: 'pan cloister stop', description: 'Stop Cloister monitoring', insert: 'pan cloister stop', category: 'Cloister' },
  { id: 'pan-cloister-emergency-stop', label: 'pan cloister emergency-stop', description: 'Emergency stop — kill ALL agents', insert: 'pan cloister emergency-stop', category: 'Cloister' },

  // ─── Convoy ──────────────────────────────────────────────────────────────────
  { id: 'pan-convoy-start', label: 'pan convoy start', description: 'Start a new convoy', insert: 'pan convoy start ', category: 'Convoy' },
  { id: 'pan-convoy-status', label: 'pan convoy status', description: 'Show convoy status', insert: 'pan convoy status ', category: 'Convoy' },
  { id: 'pan-convoy-list', label: 'pan convoy list', description: 'List all convoys', insert: 'pan convoy list', category: 'Convoy' },
  { id: 'pan-convoy-stop', label: 'pan convoy stop', description: 'Stop a running convoy', insert: 'pan convoy stop ', category: 'Convoy' },

  // ─── Specialists ─────────────────────────────────────────────────────────────
  { id: 'pan-specialists-list', label: 'pan specialists list', description: 'Show all specialists with status', insert: 'pan specialists list', category: 'Specialists' },
  { id: 'pan-specialists-wake', label: 'pan specialists wake', description: 'Wake up a specialist agent', insert: 'pan specialists wake ', category: 'Specialists' },
  { id: 'pan-specialists-queue', label: 'pan specialists queue', description: 'Show pending specialist work', insert: 'pan specialists queue ', category: 'Specialists' },
  { id: 'pan-specialists-reset', label: 'pan specialists reset', description: 'Reset a specialist', insert: 'pan specialists reset ', category: 'Specialists' },
  { id: 'pan-specialists-clear-queue', label: 'pan specialists clear-queue', description: 'Clear specialist queue', insert: 'pan specialists clear-queue ', category: 'Specialists' },
  { id: 'pan-specialists-done', label: 'pan specialists done', description: 'Signal specialist completion', insert: 'pan specialists done', category: 'Specialists' },
  { id: 'pan-specialists-logs', label: 'pan specialists logs', description: 'View specialist run logs', insert: 'pan specialists logs', category: 'Specialists' },
  { id: 'pan-specialists-cleanup-logs', label: 'pan specialists cleanup-logs', description: 'Clean up old specialist logs', insert: 'pan specialists cleanup-logs', category: 'Specialists' },

  // ─── Project ─────────────────────────────────────────────────────────────────
  { id: 'pan-project-add', label: 'pan project add', description: 'Register a project', insert: 'pan project add ', category: 'Project' },
  { id: 'pan-project-list', label: 'pan project list', description: 'List all registered projects', insert: 'pan project list', category: 'Project' },
  { id: 'pan-project-show', label: 'pan project show', description: 'Show project details', insert: 'pan project show ', category: 'Project' },
  { id: 'pan-project-remove', label: 'pan project remove', description: 'Remove a project', insert: 'pan project remove ', category: 'Project' },
  { id: 'pan-project-init', label: 'pan project init', description: 'Initialize projects.yaml', insert: 'pan project init', category: 'Project' },

  // ─── Remote ──────────────────────────────────────────────────────────────────
  { id: 'pan-remote-status', label: 'pan remote status', description: 'Show Fly.io connection status', insert: 'pan remote status', category: 'Remote' },
  { id: 'pan-remote-init', label: 'pan remote init', description: 'Initialize Fly.io app', insert: 'pan remote init', category: 'Remote' },
  { id: 'pan-remote-resources', label: 'pan remote resources', description: 'Show RAM/disk usage across VMs', insert: 'pan remote resources', category: 'Remote' },
  { id: 'pan-remote-setup', label: 'pan remote setup', description: 'Setup Fly.io integration', insert: 'pan remote setup', category: 'Remote' },

  // ─── Data & Config ───────────────────────────────────────────────────────────
  { id: 'pan-db-snapshot', label: 'pan db snapshot', description: 'Create database snapshot', insert: 'pan db snapshot', category: 'Data' },
  { id: 'pan-db-seed', label: 'pan db seed', description: 'Seed database', insert: 'pan db seed ', category: 'Data' },
  { id: 'pan-beads-compact', label: 'pan beads compact', description: 'Compact beads database', insert: 'pan beads compact', category: 'Data' },
  { id: 'pan-beads-stats', label: 'pan beads stats', description: 'Show beads statistics', insert: 'pan beads stats', category: 'Data' },
  { id: 'pan-backup-list', label: 'pan backup list', description: 'List all backups', insert: 'pan backup list', category: 'Data' },
  { id: 'pan-backup-clean', label: 'pan backup clean', description: 'Remove old backups', insert: 'pan backup clean', category: 'Data' },
  { id: 'pan-restore', label: 'pan restore', description: 'Restore from backup', insert: 'pan restore ', category: 'Data' },
  { id: 'pan-config-shadow', label: 'pan config shadow', description: 'Configure shadow mode', insert: 'pan config shadow', category: 'Data' },
  { id: 'pan-inspect', label: 'pan inspect', description: 'Inspect workspace state', insert: 'pan inspect ', category: 'Data' },
  { id: 'pan-cost-today', label: 'pan cost today', description: 'Show cost tracking for today', insert: 'pan cost today', category: 'Data' },
  { id: 'pan-cost-sync', label: 'pan cost sync', description: 'Import cost events from WAL files', insert: 'pan cost sync', category: 'Data' },
  { id: 'pan-setup-hooks', label: 'pan setup hooks', description: 'Install/update git hooks', insert: 'pan setup hooks', category: 'Data' },
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
  const lastTextRef = useRef<string>('');

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

  // Debounced draft persistence + slash menu trigger.
  // Detecting '/' here (instead of via a keydown listener on the root element)
  // ensures the menu opens regardless of focus/selection timing — including
  // when '/' is the very first character typed in an empty editor.
  const handleChange = useCallback(() => {
    editor.read(() => {
      const text = $getRoot().getTextContent();
      const prev = lastTextRef.current;
      lastTextRef.current = text;
      onTextChange(text);

      // Trigger slash menu when a new '/' character is appended at the end
      if (text.length > prev.length && text.endsWith('/')) {
        onSlashKey();
      }

      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        saveDraft(conversationName, text);
      }, 300);
    });
  }, [editor, conversationName, onTextChange, onSlashKey]);

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

export function SlashMenu({ commands, filter, selectedIndex, onSelect, onClose, anchorRect }: SlashMenuProps) {
  const filtered = commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(filter.toLowerCase()) ||
      cmd.description.toLowerCase().includes(filter.toLowerCase()),
  );

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
      selected?.scrollIntoView?.({ block: 'nearest' });
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
            return (
              <button
                key={cmd.id}
                className={`${styles.slashMenuItem} ${globalIndex === selectedIndex ? styles.slashMenuItemSelected : ''}`}
                onClick={() => onSelect(cmd)}
                role="option"
                aria-selected={globalIndex === selectedIndex}
              >
                <span className={styles.slashMenuLabel}>{cmd.label}</span>
                <span className={styles.slashMenuDescription}>{cmd.description}</span>
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);
  const [filterText, setFilterText] = useState('');

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

      // Derive slash menu filter from text content (chars after the last '/').
      // This lets typed characters appear naturally in the editor while the
      // menu filters live as the user types.
      if (isSlashMenuOpen) {
        const slashIdx = t.lastIndexOf('/');
        if (slashIdx === -1) {
          // User backspaced past the '/' — close the menu
          setIsSlashMenuOpen(false);
          setSelectedIndex(0);
        } else {
          const newFilter = t.slice(slashIdx + 1);
          // If the filter contains a space or newline, the user has moved on — close
          if (/[\s]/.test(newFilter)) {
            setIsSlashMenuOpen(false);
            setSelectedIndex(0);
          } else {
            setFilterText(newFilter);
            setSelectedIndex(0);
          }
        }
      }
    },
    [onChange, isSlashMenuOpen],
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
    setFilterText('');
  }, []);

  const handleSlashSelect = useCallback(
    (command: SlashCommand) => {
      const editor = editorRef?.current;
      if (editor) {
        editor.update(() => {
          const root = $getRoot();
          const fullText = root.getTextContent();
          // Find the last '/' that triggered the menu and strip it + any filter chars after it
          const slashIdx = fullText.lastIndexOf('/');
          const textBefore = slashIdx >= 0 ? fullText.slice(0, slashIdx) : fullText;
          // Replace editor content: text before the slash trigger + the selected command
          root.clear();
          const para = $createParagraphNode();
          para.append($createTextNode(textBefore + command.insert));
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

  // Handle keyboard navigation in slash menu.
  // Only intercepts navigation/selection keys — character keys flow through
  // to the Lexical editor so they appear in the input, and the filter is
  // derived from the editor's text content in handleChange above.
  useEffect(() => {
    if (!isSlashMenuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const filtered = SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(filterText.toLowerCase()) ||
          cmd.description.toLowerCase().includes(filterText.toLowerCase()),
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0) setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0) setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0 && filtered[selectedIndex]) {
          handleSlashSelect(filtered[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleSlashClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length > 0 && filtered[selectedIndex]) {
          handleSlashSelect(filtered[selectedIndex]);
        }
      }
      // All other keys (characters, Backspace, etc.) flow through to Lexical
    };

    // Use capture phase so we intercept before Lexical's keydown handler
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isSlashMenuOpen, selectedIndex, filterText, handleSlashSelect, handleSlashClose]);

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
      {isSlashMenuOpen && (
        <SlashMenu
          commands={SLASH_COMMANDS}
          filter={filterText}
          selectedIndex={selectedIndex}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
          anchorRect={menuAnchorRect}
        />
      )}
    </div>
  );
}
