import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { effectiveTerminalPalette, type ColorTheme, type TerminalPalette } from '@overdeck/contracts';
import { useColorTheme } from '../../../hooks/useColorTheme';
import { ensureSyntaxTheme, highlight, syntaxThemeName } from '../../../lib/syntaxTheme';

const ANSI_KEYS: Array<keyof TerminalPalette> = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

const UI_KEYS: Array<keyof NonNullable<ColorTheme['ui']>> = ['background', 'surface', 'overlay', 'border', 'foreground', 'muted', 'accent'];

const SAMPLE_CODE = 'function greet(name: string) {\n  return `Hello, ${name}!`;\n}';

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span
      title={`${label}: ${color}`}
      className="inline-block h-4 w-4 rounded-sm border border-border"
      style={{ backgroundColor: color }}
    />
  );
}

function ThemePreviewCard({ theme }: { theme: ColorTheme }) {
  const [sampleHtml, setSampleHtml] = useState<string | null>(null);
  const palette = effectiveTerminalPalette(theme);

  useEffect(() => {
    let cancelled = false;
    void ensureSyntaxTheme(theme).then((name) => highlight(SAMPLE_CODE, 'ts', name)).then((html) => {
      if (!cancelled) setSampleHtml(html);
    }).catch(() => { /* registration or highlighting failed; keep the unhighlighted sample */ });
    return () => { cancelled = true; };
  }, [theme]);

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{theme.name}</span>
        <span className="text-xs text-muted-foreground">{theme.type}</span>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <Swatch color={palette.background} label="background" />
        <Swatch color={palette.foreground} label="foreground" />
        {ANSI_KEYS.map((key) => <Swatch key={key} color={palette[key]} label={key} />)}
      </div>

      {theme.ui !== undefined && (
        <div className="mt-2 flex items-center gap-1">
          {UI_KEYS.filter((key) => theme.ui?.[key] !== undefined).map((key) => (
            <Swatch key={key} color={theme.ui![key]!} label={`ui.${key}`} />
          ))}
        </div>
      )}

      {sampleHtml && (
        <div
          className="mt-2 text-xs"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: sampleHtml }}
        />
      )}
    </div>
  );
}

interface ColorThemeImportPreviewProps {
  themes: ColorTheme[];
  warnings: string[];
  onDone: () => void;
}

/** Previews one or more mapped VS Code themes before anything is saved (PAN-4644). */
export function ColorThemeImportPreview({ themes, warnings, onDone }: ColorThemeImportPreviewProps) {
  const saveImported = useColorTheme((s) => s.saveImported);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const theme of themes) {
        // eslint-disable-next-line no-await-in-loop
        await saveImported(theme);
        toast.success(`Saved color theme "${theme.name}"`);
      }
      onDone();
    } catch (err) {
      toast.error(`Failed to save color theme: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3" data-testid="color-theme-import-preview">
      <div className="space-y-2">
        {themes.map((theme) => <ThemePreviewCard key={syntaxThemeName(theme) + theme.name} theme={theme} />)}
      </div>

      {warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-muted-foreground" data-testid="color-theme-import-warnings">
          {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/30 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
