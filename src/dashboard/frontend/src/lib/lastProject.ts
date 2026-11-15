/**
 * lastProject — remembers the last project selected in the Command Deck
 * (PAN-5335 WI-5) so a fresh load of a non-project route (e.g. /activity)
 * restores it instead of opening to no project.
 */

import { NO_PROJECT_KEY } from '../components/CommandDeck/projectsData';

export const LAST_PROJECT_STORAGE_KEY = 'overdeck.ui.lastProjectKey';

export function readLastProjectKey(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastProjectKey(key: string): void {
  try {
    window.localStorage.setItem(LAST_PROJECT_STORAGE_KEY, key);
  } catch {
    // ignore
  }
}

export function clearLastProjectKey(): void {
  try {
    window.localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * D-5 read rule: an explicit route project always wins. A bare /command-deck
 * or a /conv/:id route carries no project of its own and should not inherit
 * one from storage. Anything else (e.g. /activity) falls back to storage.
 */
export function initialProjectKey(input: {
  routeProject: string | null;
  pathname: string;
  stored: string | null;
}): { key: string | null; fromStorage: boolean } {
  if (input.routeProject) return { key: input.routeProject, fromStorage: false };
  if (input.pathname === '/command-deck' || input.pathname.startsWith('/conv/')) {
    return { key: null, fromStorage: false };
  }
  return { key: input.stored, fromStorage: input.stored !== null };
}

/** D-5 validation: a storage-derived selection must still exist. */
export function isKnownProjectKey(key: string, registered: ReadonlyArray<{ key: string; name: string }>): boolean {
  if (key === NO_PROJECT_KEY) return true;
  return registered.some((p) => p.key === key || p.name === key);
}
