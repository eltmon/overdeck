/**
 * The `/m` web shell's appearance controller (PAN-5208 D-6): applies the phone appearance
 * (System / Light / Dark from `lib/appearance.ts`) now, on every write, and on every OS
 * light/dark change, through `useTheme.setLocalTheme` — so it never writes the desktop
 * dashboard's `overdeck.ui.theme` and never sends a request. A no-op in the phone app, where
 * `ShellApp`'s `installAppearance` owns the theme (PAN-5041).
 */
import { useLayoutEffect } from 'react';

import { useTheme } from '../../hooks/useTheme';
import { onAppearanceChange, readAppearance, resolveAppearance } from '../../lib/appearance';
import { isNativeShell } from '../../lib/nativeShell';

export function useMobileAppearance(): void {
  useLayoutEffect(() => {
    if (isNativeShell() || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => useTheme.getState().setLocalTheme(resolveAppearance(readAppearance(), media.matches));
    apply();
    const off = onAppearanceChange(apply);
    media.addEventListener('change', apply);
    return () => {
      off();
      media.removeEventListener('change', apply);
    };
  }, []);
}
