import { effectiveTerminalPalette } from '@overdeck/contracts';
import { getUiTheme, TERMINAL_BG } from '../ui-theme.js';
import { resolveColorThemeSelection } from './selection.js';

/**
 * The effective terminal background for a new tmux session's window-style
 * stamp: the active color theme's terminal background for the current
 * mode. Falls back to `TERMINAL_BG` on any error — a dashboard with no
 * color theme set still gets a correct background.
 */
export async function resolveTerminalBackground(): Promise<string> {
  let mode: 'light' | 'dark';
  try {
    mode = await getUiTheme();
  } catch {
    return TERMINAL_BG.dark;
  }

  try {
    const selection = await resolveColorThemeSelection();
    return effectiveTerminalPalette(selection[mode]).background;
  } catch {
    return TERMINAL_BG[mode];
  }
}
