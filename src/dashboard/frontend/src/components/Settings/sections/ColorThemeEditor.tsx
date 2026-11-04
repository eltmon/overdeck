import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ColorTheme } from '@overdeck/contracts';
import { useColorTheme } from '../../../hooks/useColorTheme';
import {
  draftPreviewTheme,
  draftToFile,
  EDITABLE_TERMINAL_KEYS,
  EDITABLE_UI_KEYS,
  pickerValue,
  revertEdit,
  setEdit,
  SYNTAX_SCOPES,
  createDraft,
  type EditorMode,
  type ThemeDraft,
} from '../../../lib/colorThemeEditor';
import { ColorThemeEditorPreview } from './ColorThemeEditorPreview';

type Group = 'terminal' | 'ui' | 'syntax';

interface PickerRowProps {
  draft: ThemeDraft;
  group: Group;
  theKey: string;
  label: string;
  onChange: (group: Group, key: string, color: string) => void;
  onRevert: (group: Group, key: string) => void;
}

function PickerRow({ draft, group, theKey, label, onChange, onRevert }: PickerRowProps) {
  const { value, isSet, isEdited } = pickerValue(draft, group, theKey);
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-32 shrink-0 text-xs text-foreground">{label}</span>
      <input
        type="color"
        data-testid={`color-theme-editor-${group}-${theKey}`}
        value={value}
        onChange={(e) => onChange(group, theKey, e.target.value)}
        className="h-5 w-8 shrink-0 rounded-sm border border-border"
      />
      <span className="text-xs text-muted-foreground">{value}</span>
      {!isSet && <span className="text-xs text-muted-foreground">Not set</span>}
      {isEdited && (
        <button
          type="button"
          data-testid={`color-theme-editor-revert-${group}-${theKey}`}
          onClick={() => onRevert(group, theKey)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Revert
        </button>
      )}
    </div>
  );
}

interface ColorThemeEditorProps {
  source: ColorTheme;
  mode: EditorMode;
  existingNames: string[];
  onDone: () => void;
}

/** Inline duplicate-and-edit panel for a color theme (PAN-4660): pickers on the left, live preview on the right. */
export function ColorThemeEditor({ source, mode, existingNames, onDone }: ColorThemeEditorProps) {
  const [draft, setDraft] = useState(() => createDraft(source, mode, existingNames));
  const [saving, setSaving] = useState(false);
  const saveImported = useColorTheme((s) => s.saveImported);
  const updateTheme = useColorTheme((s) => s.updateTheme);

  const previewTheme = useMemo(() => draftPreviewTheme(draft), [draft]);

  const handleChange = (group: Group, key: string, color: string) => {
    setDraft((d) => setEdit(d, group, key, color));
  };

  const handleRevert = (group: Group, key: string) => {
    setDraft((d) => revertEdit(d, group, key));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const file = draftToFile(draft);
      if (mode === 'duplicate') {
        await saveImported(file);
      } else {
        await updateTheme(source.id, file);
      }
      toast.success(`Saved color theme "${draft.name.trim()}"`);
      onDone();
    } catch (err) {
      toast.error(`Failed to save color theme: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="color-theme-editor">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-foreground">
          {mode === 'duplicate' ? `Duplicate of ${source.name}` : `Editing ${source.name}`}
        </span>
        <span className="text-xs text-muted-foreground">{source.type}</span>
      </div>

      <label className="mt-2 block">
        <span className="block text-xs font-medium text-muted-foreground mb-1">Name</span>
        <input
          type="text"
          data-testid="color-theme-editor-name"
          maxLength={80}
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
        />
      </label>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="text-xs font-medium text-foreground">Terminal</div>
          {EDITABLE_TERMINAL_KEYS.map((key) => (
            <PickerRow key={key} draft={draft} group="terminal" theKey={key} label={key} onChange={handleChange} onRevert={handleRevert} />
          ))}

          <div className="mt-3 text-xs font-medium text-foreground">Interface</div>
          {EDITABLE_UI_KEYS.map((key) => (
            <PickerRow key={key} draft={draft} group="ui" theKey={key} label={key} onChange={handleChange} onRevert={handleRevert} />
          ))}

          <div className="mt-3 text-xs font-medium text-foreground">Syntax</div>
          {SYNTAX_SCOPES.map(({ key, label }) => (
            <PickerRow key={key} draft={draft} group="syntax" theKey={key} label={label} onChange={handleChange} onRevert={handleRevert} />
          ))}
        </div>

        <ColorThemeEditorPreview theme={previewTheme} />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="color-theme-editor-save"
          onClick={() => void handleSave()}
          disabled={saving || draft.name.trim() === ''}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          data-testid="color-theme-editor-cancel"
          onClick={onDone}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
