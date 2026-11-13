/**
 * The phone appearance setting shared by `/m` and the phone app (PAN-5041, PAN-5208): System /
 * Light / Dark, held in `localStorage` under `overdeck.appearance`. The phone app's
 * `apps/mobile/src/shell/appearance.ts` re-exports this store and adds the native side effects;
 * the `/m` web shell applies it through `components/mobile/useMobileAppearance.ts`.
 *
 * Leaf module: never import `hooks/useTheme` here (`useTheme` imports this module).
 *
 * Storage errors read as `system` and writes fail silently, matching `notificationPrefs.ts`'s
 * `readStorage`/`writeStorage`.
 */
import { useSyncExternalStore } from 'react';

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

/** True for every path the `/m` shell serves. */
export function isMobileShellPath(pathname: string): boolean {
  return pathname === '/m' || pathname.startsWith('/m/');
}
