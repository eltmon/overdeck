/**
 * The phone's appearance setting (PAN-5041): System / Light / Dark, held in `localStorage` under
 * `overdeck.appearance`. `installAppearance` applies it immediately, on every write, and on every
 * system-appearance change, to the dashboard theme, the status bar, and the native chrome via the
 * `OverdeckAppearance` plugin.
 *
 * Storage errors read as `system` and writes fail silently, matching `notificationPrefs.ts`'s
 * `readStorage`/`writeStorage`.
 */
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { useSyncExternalStore } from 'react';

import { useTheme } from '../../../../src/dashboard/frontend/src/hooks/useTheme';
import { OverdeckAppearance } from '../native/appearance';

export type Appearance = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_KEY = 'overdeck.appearance';
export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the in-memory state still applies for this launch.
  }
}

function isAppearance(value: string | null): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readAppearance(): Appearance {
  const stored = readStorage(APPEARANCE_KEY);
  return isAppearance(stored) ? stored : 'system';
}

const changeListeners = new Set<() => void>();

/** Returns the uninstaller. */
export function onAppearanceChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of changeListeners) listener();
}

export function writeAppearance(appearance: Appearance): void {
  writeStorage(APPEARANCE_KEY, appearance);
  notify();
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(onAppearanceChange, readAppearance);
}

export function resolveAppearance(appearance: Appearance, systemDark: boolean): ResolvedTheme {
  if (appearance === 'light') return 'light';
  if (appearance === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export interface AppearanceDeps {
  setTheme(theme: ResolvedTheme): void;
  setStatusBar(theme: ResolvedTheme): void;
  setNative(appearance: Appearance): void;
  media: {
    matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
  };
}

/** Applies now, then on every appearance write and every system-appearance change. Returns the uninstaller. */
export function installAppearance(deps: AppearanceDeps): () => void {
  const apply = () => {
    const theme = resolveAppearance(readAppearance(), deps.media.matches);
    deps.setTheme(theme);
    deps.setStatusBar(theme);
  };

  apply();
  deps.setNative(readAppearance());

  const onChange = () => {
    apply();
    deps.setNative(readAppearance());
  };
  const unsubscribeChange = onAppearanceChange(onChange);

  const onMediaChange = () => apply();
  deps.media.addEventListener('change', onMediaChange);

  return () => {
    unsubscribeChange();
    deps.media.removeEventListener('change', onMediaChange);
  };
}

/** Production deps: `useTheme`, `SystemBars`, `OverdeckAppearance` and `matchMedia('(prefers-color-scheme: dark)')`. */
export function defaultAppearanceDeps(): AppearanceDeps {
  return {
    setTheme: (theme) => useTheme.getState().setTheme(theme),
    setStatusBar: (theme) => {
      void SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch((e: unknown) => {
        console.warn('[appearance] status bar set failed', e);
      });
    },
    setNative: (appearance) => {
      void OverdeckAppearance.set({ appearance }).catch((e: unknown) => {
        console.warn('[appearance] native set failed', e);
      });
    },
    media: window.matchMedia('(prefers-color-scheme: dark)'),
  };
}
