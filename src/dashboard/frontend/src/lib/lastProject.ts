/**
 * lastProject — remembers the last project selected in the Command Deck
 * (PAN-5335 WI-5) so a fresh load of a non-project route (e.g. /activity)
 * restores it instead of opening to no project.
 */

import { isRealProjectKey, NO_PROJECT_KEY } from '../components/CommandDeck/projectsData';
import { ALL_PROJECTS_KEY } from './deckKeys';

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

/**
 * PAN-5343 H-D16: whether the All projects deck was the last selection. Kept
 * apart from the last project key so "This project" can still restore the
 * last real project.
 */
export const ALL_PROJECTS_DECK_STORAGE_KEY = 'overdeck.ui.allProjectsDeck';

export function readAllProjectsDeck(): boolean {
  try {
    return window.localStorage.getItem(ALL_PROJECTS_DECK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAllProjectsDeck(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(ALL_PROJECTS_DECK_STORAGE_KEY, '1');
    else window.localStorage.removeItem(ALL_PROJECTS_DECK_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * PAN-5343 H-D16: persist a deck selection. The All deck sets its own flag and
 * never overwrites the last project; any other deck clears the flag and
 * becomes the last project.
 */
export function rememberDeckSelection(key: string): void {
  if (key === ALL_PROJECTS_KEY) {
    writeAllProjectsDeck(true);
    return;
  }
  writeAllProjectsDeck(false);
  writeLastProjectKey(key);
}

/**
 * PAN-5343 H-D13: the project a new conversation from this deck belongs to —
 * the deck's own project, or in the All projects deck the last real project.
 * Undefined means unscoped.
 */
export function newConversationProjectKey(deckKey: string | null): string | undefined {
  const key = deckKey === ALL_PROJECTS_KEY ? readLastProjectKey() : deckKey;
  return isRealProjectKey(key) ? key : undefined;
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
 * carries no project of its own and should not inherit one from storage. A
 * /conv/:id route returns to the All projects deck when it was the last
 * selection (PAN-5343 H-D16), else no project. Anything else (e.g. /activity)
 * falls back to the All projects deck, then to the stored project.
 */
export function initialProjectKey(input: {
  routeProject: string | null;
  pathname: string;
  stored: string | null;
  allProjectsDeck: boolean;
}): { key: string | null; fromStorage: boolean } {
  if (input.routeProject) return { key: input.routeProject, fromStorage: false };
  if (input.pathname === '/command-deck') return { key: null, fromStorage: false };
  if (input.allProjectsDeck) return { key: ALL_PROJECTS_KEY, fromStorage: false };
  if (input.pathname.startsWith('/conv/')) return { key: null, fromStorage: false };
  return { key: input.stored, fromStorage: input.stored !== null };
}

/** D-5 validation: a storage-derived selection must still exist. */
export function isKnownProjectKey(key: string, registered: ReadonlyArray<{ key: string; name: string }>): boolean {
  if (key === NO_PROJECT_KEY || key === ALL_PROJECTS_KEY) return true;
  return registered.some((p) => p.key === key || p.name === key);
}
