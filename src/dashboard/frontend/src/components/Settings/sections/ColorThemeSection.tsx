import { toast } from 'sonner';
import { useColorTheme } from '../../../hooks/useColorTheme';
import type { ColorThemeType } from '@overdeck/contracts';

/** Light and dark color theme pickers, rendered under the Overdeck Theme cards (PAN-4644). */
export function ColorThemeSection() {
  const themes = useColorTheme((s) => s.themes);
  const selection = useColorTheme((s) => s.selection);
  const select = useColorTheme((s) => s.select);

  const handleChange = async (mode: ColorThemeType, id: string) => {
    try {
      await select(mode, id);
    } catch (err) {
      toast.error(`Failed to save color theme: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="mb-6">
      <span className="text-sm font-medium text-foreground">Color theme</span>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3">
        Choose the terminal, syntax, and UI colors for each mode. Import a VS Code theme or hand-edit a
        file in <code className="text-[11px]">~/.overdeck/themes/</code>.
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
    </div>
  );
}
