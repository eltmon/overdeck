/**
 * Last-known dashboard UI theme, synced from the frontend via
 * PUT /api/settings/ui-theme and read at tmux session spawn.
 *
 * Why this exists: Claude Code's `theme: auto` queries the terminal
 * background (OSC 11) once at startup. Agents start headless — no client is
 * attached, nobody answers, and Claude falls back to dark forever. tmux
 * answers the query itself when the pane background colour is set
 * explicitly, so stamping new sessions with the dashboard's background lets
 * Claude detect the right theme with no viewer attached (conv 2547).
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from './paths.js';

export type UiTheme = 'dark' | 'light';

/**
 * Terminal pane backgrounds. Must match XTERM_BG in
 * src/dashboard/frontend/src/components/XTerminal.tsx — tmux answers
 * Claude's OSC 11 query with this colour, so it has to be the same
 * background xterm.js actually renders.
 */
export const TERMINAL_BG: Record<UiTheme, string> = {
  dark: '#1a1a2e',
  light: '#ffffff',
};

function uiThemeFile(): string {
  return join(getOverdeckHome(), 'ui-theme.json');
}

export async function getUiTheme(): Promise<UiTheme> {
  try {
    const parsed = JSON.parse(await readFile(uiThemeFile(), 'utf-8')) as { theme?: unknown };
    return parsed.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Sync variant for launcher-script generation (spawn-time only, tiny file). */
export function getUiThemeSync(): UiTheme {
  try {
    const parsed = JSON.parse(readFileSync(uiThemeFile(), 'utf-8')) as { theme?: unknown };
    return parsed.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * COLORFGBG value ("<fg>;<bg>" ANSI indices) for a theme. Claude Code's
 * `theme: auto` falls back to this env var when its OSC 11 background query
 * goes unanswered — bg 7/9–15 reads as light, 0–6/8 as dark.
 */
export function colorFgBgForTheme(theme: UiTheme): string {
  return theme === 'light' ? '0;15' : '15;0';
}

export async function setUiTheme(theme: UiTheme): Promise<void> {
  await mkdir(getOverdeckHome(), { recursive: true });
  await writeFile(uiThemeFile(), JSON.stringify({ theme }) + '\n', 'utf-8');
}
