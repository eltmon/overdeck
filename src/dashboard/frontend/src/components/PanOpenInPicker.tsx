import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { EDITORS, type EditorId, WS_METHODS } from '@panctl/contracts';
import { getTransport, type PanRpcProtocolClient } from '../lib/wsTransport';
import { getPreferredEditor, setPreferredEditor } from '../editorPreferences';
import { EDITOR_OPEN_FAVORITE_KEY_LABEL, useEditorOpenFavoriteShortcut } from '../lib/keybindings';
import { editorIconFor } from './EditorIcons';
import { toast } from 'sonner';

interface PanOpenInPickerProps {
  /**
   * The cwd to open when the user clicks the picker. Pass `null` to fall back
   * to the server-resolved `defaultCwd` (the "devroot" — `~/Projects` if it
   * exists, else `$HOME`).
   */
  openInCwd: string | null;
  /**
   * Icon-only rendering for tight contexts (e.g. ConversationPanel header
   * where the picker sits next to other icon-only action buttons). The
   * editor label is hidden; the icon button keeps its tooltip and dropdown.
   */
  compact?: boolean;
}

const EDITOR_LABELS: Record<EditorId, string> = Object.fromEntries(
  EDITORS.map((e) => [e.id, e.label]),
) as Record<EditorId, string>;

export function PanOpenInPicker({ openInCwd, compact = false }: PanOpenInPickerProps) {
  const [availableEditors, setAvailableEditors] = useState<EditorId[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<EditorId | null>(getPreferredEditor);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const effectiveCwd = openInCwd ?? defaultCwd;
  useEditorOpenFavoriteShortcut(effectiveCwd);

  useEffect(() => {
    let cancelled = false;
    getTransport()
      .request((client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.getAvailableEditors](),
      )
      .then((result) => {
        if (cancelled) return;
        const { editors, defaultCwd: serverDefaultCwd } = result as {
          editors: readonly EditorId[];
          defaultCwd: string;
        };
        setAvailableEditors([...editors]);
        setDefaultCwd(serverDefaultCwd);
        if (!preferred && editors.length > 0) {
          setPreferred(editors[0]!);
        }
      })
      .catch(() => {
        // Server may not support this RPC yet
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleOpen = useCallback(
    async (editorId: EditorId) => {
      if (!effectiveCwd) return;
      setPreferredEditor(editorId);
      setPreferred(editorId);
      setOpen(false);
      try {
        await getTransport().request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.shellOpenInEditor]({
            cwd: effectiveCwd,
            editor: editorId,
          }),
        );
      } catch (err) {
        toast.error(`Failed to open in ${EDITOR_LABELS[editorId]}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [effectiveCwd],
  );

  if (availableEditors.length === 0) return null;

  const primaryEditor = preferred && availableEditors.includes(preferred)
    ? preferred
    : availableEditors[0]!;
  const PrimaryIcon = editorIconFor(primaryEditor);
  const disabled = !effectiveCwd;
  const tooltipCwd = effectiveCwd ?? '(no cwd available)';

  return (
    <div className="relative inline-flex" ref={dropdownRef}>
      <button
        onClick={() => handleOpen(primaryEditor)}
        disabled={disabled}
        className={`flex items-center gap-1 py-0.5 text-[10px] rounded-l transition-colors bg-card text-primary hover:text-primary/80 border border-border disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'px-1' : 'px-1.5'}`}
        title={`Open ${tooltipCwd} in ${EDITOR_LABELS[primaryEditor]} (${EDITOR_OPEN_FAVORITE_KEY_LABEL})`}
        aria-label={`Open in ${EDITOR_LABELS[primaryEditor]}`}
      >
        <PrimaryIcon className="w-2.5 h-2.5" />
        {!compact && EDITOR_LABELS[primaryEditor]}
      </button>
      {availableEditors.length > 1 && (
        <button
          onClick={() => setOpen(!open)}
          disabled={disabled}
          className="flex items-center px-0.5 py-0.5 text-[10px] rounded-r transition-colors bg-card text-muted-foreground hover:text-foreground border border-l-0 border-border disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Choose editor"
        >
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
      )}
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded shadow-lg py-1">
          {availableEditors.map((editorId) => {
            const Icon = editorIconFor(editorId);
            return (
              <button
                key={editorId}
                onClick={() => handleOpen(editorId)}
                className={`flex w-full items-center gap-2 text-left px-3 py-1 text-[11px] hover:bg-accent transition-colors ${
                  editorId === primaryEditor ? 'text-primary font-medium' : 'text-foreground'
                }`}
              >
                <Icon className="w-3 h-3 shrink-0" />
                {EDITOR_LABELS[editorId]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
