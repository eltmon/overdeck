import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useColorTheme } from '../../../hooks/useColorTheme';
import type { ColorTheme, ColorThemeType } from '@overdeck/contracts';
import type { EditorMode } from '../../../lib/colorThemeEditor';
import { ColorThemeEditor } from './ColorThemeEditor';
import { ColorThemeImportPreview } from './ColorThemeImportPreview';

/** Light and dark color theme pickers, rendered under the Overdeck Theme cards (PAN-4644). */
export function ColorThemeSection() {
  const themes = useColorTheme((s) => s.themes);
  const selection = useColorTheme((s) => s.selection);
  const select = useColorTheme((s) => s.select);
  const previewImport = useColorTheme((s) => s.previewImport);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ themes: ColorTheme[]; warnings: string[] } | null>(null);
  const [editing, setEditing] = useState<{ source: ColorTheme; mode: EditorMode } | null>(null);

  const handleChange = async (mode: ColorThemeType, id: string) => {
    try {
      await select(mode, id);
    } catch (err) {
      toast.error(`Failed to save color theme: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFileChosen = async (file: File) => {
    try {
      const result = await previewImport(file);
      setPreview(result);
    } catch (err) {
      toast.error(`Failed to preview theme import: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="mb-6">
      <span className="text-sm font-medium text-foreground">Color theme</span>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3">
        Choose the terminal, syntax, and UI colors for each mode. Import a VS Code theme (.json) or
        extension package (.vsix), duplicate and edit any theme below, or hand-edit a file in{' '}
        <code className="text-[11px]">~/.overdeck/themes/</code>.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-medium text-muted-foreground mb-1">Light mode</span>
          <select
            value={selection.light}
            data-testid="color-theme-light"
            onChange={(e) => void handleChange('light', e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            {themes.filter((t) => t.type === 'light').map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-muted-foreground mb-1">Dark mode</span>
          <select
            value={selection.dark}
            data-testid="color-theme-dark"
            onChange={(e) => void handleChange('dark', e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            {themes.filter((t) => t.type === 'dark').map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30"
      >
        Import VS Code theme
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.vsix"
        data-testid="color-theme-import-input"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFileChosen(file);
        }}
      />

      <ul className="mt-3 space-y-1" data-testid="color-theme-list">
        {themes.map((t) => (
          <li
            key={t.id}
            data-testid={`color-theme-row-${t.id}`}
            className="flex items-center gap-2 text-xs"
          >
            <span className="text-foreground">{t.name}</span>
            <span className="text-muted-foreground">{t.type}</span>
            {t.builtin && <span className="text-muted-foreground">Built-in</span>}
            <button
              type="button"
              data-testid={`color-theme-duplicate-${t.id}`}
              disabled={editing !== null}
              onClick={() => setEditing({ source: t, mode: 'duplicate' })}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Duplicate and edit
            </button>
            {!t.builtin && (
              <button
                type="button"
                data-testid={`color-theme-edit-${t.id}`}
                disabled={editing !== null}
                onClick={() => setEditing({ source: t, mode: 'edit' })}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Edit
              </button>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <ColorThemeEditor
          key={`${editing.mode}:${editing.source.id}`}
          source={editing.source}
          mode={editing.mode}
          existingNames={themes.map((t) => t.name)}
          onDone={() => setEditing(null)}
        />
      )}

      {preview && (
        <ColorThemeImportPreview
          themes={preview.themes}
          warnings={preview.warnings}
          onDone={() => setPreview(null)}
        />
      )}
    </div>
  );
}
