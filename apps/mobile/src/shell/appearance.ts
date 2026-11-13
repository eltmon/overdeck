/**
 * The phone's appearance setting (PAN-5041): System / Light / Dark, held in `localStorage` under
 * `overdeck.appearance`. `installAppearance` applies it immediately, on every write, and on every
 * system-appearance change, to the dashboard theme, the status bar, and the native chrome via the
 * `OverdeckAppearance` plugin.
 *
 * The store itself (key, read, write, subscribe, resolve) lives in the frontend leaf module
 * `src/dashboard/frontend/src/lib/appearance.ts`, shared with the `/m` web shell (PAN-5208); this
 * module re-exports it and keeps only the native side effects.
 */
import { SystemBars, SystemBarsStyle } from '@capacitor/core';

import { useTheme } from '../../../../src/dashboard/frontend/src/hooks/useTheme';
import {
  type Appearance,
  onAppearanceChange,
  readAppearance,
  resolveAppearance,
  type ResolvedTheme,
} from '../../../../src/dashboard/frontend/src/lib/appearance';
import { OverdeckAppearance } from '../native/appearance';

export {
  APPEARANCE_KEY,
  APPEARANCES,
  type Appearance,
  onAppearanceChange,
  readAppearance,
  resolveAppearance,
  type ResolvedTheme,
  useAppearance,
  writeAppearance,
} from '../../../../src/dashboard/frontend/src/lib/appearance';

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
