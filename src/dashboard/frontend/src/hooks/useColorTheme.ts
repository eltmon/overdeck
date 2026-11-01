import { create } from 'zustand';
import {
  BUILTIN_COLOR_THEMES,
  effectiveTerminalPalette,
  readableForeground,
  type ColorTheme,
  type ColorThemeType,
  type TerminalPalette,
} from '@overdeck/contracts';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport.js';
import { useTheme } from './useTheme.js';

const STORAGE_KEY = 'overdeck.ui.colorThemes.active';

interface ActiveThemes {
  light: ColorTheme;
  dark: ColorTheme;
}

function defaultActive(): ActiveThemes {
  return { light: BUILTIN_COLOR_THEMES['overdeck-light'], dark: BUILTIN_COLOR_THEMES['overdeck-dark'] };
}

function getStoredActive(): ActiveThemes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultActive();
    const parsed = JSON.parse(raw) as Partial<ActiveThemes>;
    return {
      light: parsed.light ?? BUILTIN_COLOR_THEMES['overdeck-light'],
      dark: parsed.dark ?? BUILTIN_COLOR_THEMES['overdeck-dark'],
    };
  } catch {
    return defaultActive();
  }
}

function storeActive(active: ActiveThemes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    // best-effort — a blocked/full localStorage must not break theming
  }
}

// The documented UI token subset (PRD "UI token table"). Signal/state tokens
// (--destructive*, --info*, --success*, --warning*, --signal-*, --state-*)
// are never in this list and are never touched here.
const ALL_UI_PROPS = [
  '--background', '--muted', '--secondary', '--accent',
  '--card', '--popover',
  '--border', '--input',
  '--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground', '--accent-foreground',
  '--body-foreground', '--faint-foreground',
  '--muted-foreground',
  '--primary', '--ring', '--primary-ink', '--primary-foreground',
] as const;

/** Applies (or clears) the active theme's `ui` tokens as inline styles on `<html>`, which beat every stylesheet selector. */
function applyUiTokens(theme: ColorTheme): void {
  const html = document.documentElement;
  for (const prop of ALL_UI_PROPS) html.style.removeProperty(prop);

  const ui = theme.ui;
  if (ui === undefined) return;

  const set = (prop: string, value: string) => html.style.setProperty(prop, value);

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
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface ColorThemeState {
  themes: ColorTheme[];
  selection: { light: string; dark: string };
  warnings: string[];
  active: ActiveThemes;
  loaded: boolean;
  reconcileFromServer: () => Promise<void>;
  select: (mode: ColorThemeType, id: string) => Promise<void>;
  previewImport: (file: File) => Promise<{ themes: ColorTheme[]; warnings: string[] }>;
  saveImported: (theme: unknown) => Promise<void>;
  activeTheme: (mode: ColorThemeType) => ColorTheme;
  terminalPalette: (mode: ColorThemeType) => TerminalPalette;
}

// First paint uses the last-known themes (no server round trip needed to
// render correctly), and never writes on load — only `select`/`saveImported`
// write to the server.
const initialActive = getStoredActive();
applyUiTokens(initialActive[useTheme.getState().resolvedTheme]);

export const useColorTheme = create<ColorThemeState>((set, get) => ({
  themes: [],
  selection: { light: initialActive.light.id, dark: initialActive.dark.id },
  warnings: [],
  active: initialActive,
  loaded: false,

  reconcileFromServer: async () => {
    try {
      const res = await fetch('/api/color-themes');
      if (!res.ok) return;
      const data = await res.json() as {
        themes: ColorTheme[];
        selection: { light: string; dark: string };
        warnings: string[];
      };
      const light = data.themes.find((t) => t.id === data.selection.light) ?? BUILTIN_COLOR_THEMES['overdeck-light'];
      const dark = data.themes.find((t) => t.id === data.selection.dark) ?? BUILTIN_COLOR_THEMES['overdeck-dark'];
      const active: ActiveThemes = { light, dark };
      storeActive(active);
      set({ themes: data.themes, selection: data.selection, warnings: data.warnings, active, loaded: true });
      applyUiTokens(active[useTheme.getState().resolvedTheme]);
    } catch {
      // Network unavailable — reconciliation is best-effort; the mirror stays.
    }
  },

  select: async (mode, id) => {
    const headers = await dashboardMutationJsonHeaders();
    const res = await fetch('/api/color-themes/selection', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ mode, id }),
    });
    const data = await res.json().catch(() => null) as { selection?: { light: string; dark: string }; error?: string } | null;
    if (!res.ok) throw new Error(data?.error ?? `Failed to save color theme selection (HTTP ${res.status})`);

    const state = get();
    const theme = state.themes.find((t) => t.id === id) ?? BUILTIN_COLOR_THEMES[mode === 'light' ? 'overdeck-light' : 'overdeck-dark'];
    const active: ActiveThemes = { ...state.active, [mode]: theme };
    storeActive(active);
    set({ selection: data?.selection ?? { ...state.selection, [mode]: id }, active });
    if (useTheme.getState().resolvedTheme === mode) applyUiTokens(theme);
  },

  previewImport: async (file) => {
    const headers = await dashboardMutationJsonHeaders();
    const contentBase64 = await fileToBase64(file);
    const res = await fetch('/api/color-themes/import/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fileName: file.name, contentBase64 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `Failed to preview import (HTTP ${res.status})`);
    return data as { themes: ColorTheme[]; warnings: string[] };
  },

  saveImported: async (theme) => {
    const headers = await dashboardMutationJsonHeaders();
    const res = await fetch('/api/color-themes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ theme }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.errors?.join('; ') ?? `Failed to save theme (HTTP ${res.status})`);
    await get().reconcileFromServer();
  },

  activeTheme: (mode) => get().active[mode],
  terminalPalette: (mode) => effectiveTerminalPalette(get().active[mode]),
}));

// A mode toggle must re-apply UI tokens for the newly active slot without a
// reload — the other slot's theme may have different (or no) `ui` colors.
useTheme.subscribe((state, prevState) => {
  if (state.resolvedTheme !== prevState.resolvedTheme) {
    applyUiTokens(useColorTheme.getState().active[state.resolvedTheme]);
  }
});
