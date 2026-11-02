import { readableForeground, type ColorTheme } from '@overdeck/contracts';

// The documented UI token subset (PRD "UI token table"). Signal/state tokens
// (--destructive*, --info*, --success*, --warning*, --signal-*, --state-*)
// are never in this list and are never touched here.
export const ALL_UI_PROPS = [
  '--background', '--muted', '--secondary', '--accent',
  '--card', '--popover',
  '--border', '--input',
  '--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground', '--accent-foreground',
  '--body-foreground', '--faint-foreground',
  '--muted-foreground',
  '--primary', '--ring', '--primary-ink', '--primary-foreground',
  '--surface-overlay', '--surface-overlay-field', '--border-overlay', '--overlay-scrim',
] as const;

/** The property→value pairs a theme's `ui` group maps to — the pure half of `applyUiTokens`. */
export function uiTokenStyles(theme: ColorTheme): Record<string, string> {
  const result: Record<string, string> = {};
  const set = (prop: string, value: string) => {
    result[prop] = value;
  };

  const ui = theme.ui;
  if (ui === undefined) return result;

  if (ui.background !== undefined) {
    set('--background', ui.background);
    set('--muted', 'color-mix(in srgb, var(--foreground) 5%, var(--background))');
    set('--secondary', 'color-mix(in srgb, var(--foreground) 6%, var(--background))');
    set('--accent', 'color-mix(in srgb, var(--foreground) 8%, var(--background))');
  }
  if (ui.surface !== undefined) {
    set('--card', ui.surface);
    set('--popover', ui.surface);
  }
  if (ui.border !== undefined) {
    set('--border', ui.border);
    set('--input', ui.border);
  }
  if (ui.foreground !== undefined) {
    set('--foreground', ui.foreground);
    set('--card-foreground', ui.foreground);
    set('--popover-foreground', ui.foreground);
    set('--secondary-foreground', ui.foreground);
    set('--accent-foreground', ui.foreground);
    set('--body-foreground', 'color-mix(in srgb, var(--foreground) 85%, var(--background))');
    set('--faint-foreground', 'color-mix(in srgb, var(--foreground) 45%, var(--background))');
  }
  if (ui.muted !== undefined) {
    set('--muted-foreground', ui.muted);
  }
  if (ui.accent !== undefined) {
    set('--primary', ui.accent);
    set('--ring', ui.accent);
    set('--primary-ink', ui.accent);
    set('--primary-foreground', readableForeground(ui.accent));
  }
  if (ui.overlay !== undefined) {
    set('--surface-overlay', ui.overlay);
  } else if (ui.background !== undefined) {
    set('--surface-overlay', theme.type === 'light'
      ? 'color-mix(in srgb, var(--background), white 70%)'
      : 'color-mix(in srgb, var(--background), var(--foreground) 6%)');
  }
  if (ui.background !== undefined) set('--surface-overlay-field', 'var(--background)');
  if (ui.border !== undefined) set('--border-overlay', ui.border);

  return result;
}
