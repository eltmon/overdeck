/**
 * Read side of the color theme selection (PAN-4644). Reachable from
 * `tmux.ts` via `terminal-background.ts` — must never import
 * `settings-api.ts` (that would create an import cycle; the write door
 * lives in `selection-write.ts` instead).
 */
import { builtinFor, type ColorTheme, type ColorThemeType } from '@overdeck/contracts';
import { loadGlobalConfigNoMigration } from '../config-yaml/load.js';
import { getColorTheme } from './store.js';

const warnedOnce = new Set<string>();

function warnOnce(mode: ColorThemeType, id: string, reason: string): void {
  const key = `${mode}:${id}`;
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(`[color-themes] ui.color_theme.${mode} "${id}" ${reason}; using ${builtinFor(mode).id}`);
}

async function resolveMode(mode: ColorThemeType, id: string | null): Promise<ColorTheme> {
  if (id === null) return builtinFor(mode);

  const theme = await getColorTheme(id);
  if (theme === undefined) {
    warnOnce(mode, id, 'not found');
    return builtinFor(mode);
  }
  if (theme.type !== mode) {
    warnOnce(mode, id, `is a ${theme.type} theme`);
    return builtinFor(mode);
  }
  return theme;
}

/** Resolves the active theme for each mode, falling back to the built-in on a null, missing, or wrong-type id. */
export async function resolveColorThemeSelection(): Promise<{ light: ColorTheme; dark: ColorTheme }> {
  const { config } = await loadGlobalConfigNoMigration();
  const [light, dark] = await Promise.all([
    resolveMode('light', config.ui.colorTheme.light),
    resolveMode('dark', config.ui.colorTheme.dark),
  ]);
  return { light, dark };
}
