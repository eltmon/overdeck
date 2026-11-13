/**
 * The phone appearance setting shared by `/m` and the phone app (PAN-5041, PAN-5208): System /
 * Light / Dark, held in `localStorage` under `overdeck.appearance`. The phone app's
 * `apps/mobile/src/shell/appearance.ts` re-exports this store and adds the native side effects;
 * the `/m` web shell applies it through `components/mobile/useMobileAppearance.ts`.
 *
 * Leaf module: never import `hooks/useTheme` here (`useTheme` imports this module).
 *
 * Storage read errors read as `system`. A failed write keeps the choice in memory, so it still
 * applies until the page reloads.
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

/** Returns false when storage is unavailable or full. */
function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The last choice whose storage write failed: it still applies for this page's lifetime. */
let unsavedAppearance: Appearance | null = null;

function isAppearance(value: string | null): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readAppearance(): Appearance {
  if (unsavedAppearance !== null) return unsavedAppearance;
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
  unsavedAppearance = writeStorage(APPEARANCE_KEY, appearance) ? null : appearance;
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
