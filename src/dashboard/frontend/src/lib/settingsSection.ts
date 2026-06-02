/**
 * Settings-section deep-linking (PAN-1600).
 *
 * Other surfaces (e.g. the app-bar Low-cost mode pill) ask the Settings page to
 * scroll to a specific section. Two cases must both work:
 *   1. Settings isn't mounted yet → the page reads the pending intent on mount.
 *   2. Settings is already open → the page reacts to the live event.
 * Using both a sessionStorage intent AND a window event covers both reliably.
 */

export const SETTINGS_SECTION_INTENT_KEY = 'panopticon.settingsSection';
export const SETTINGS_SECTION_EVENT = 'panopticon:settings-section';

/** Request that the Settings page scroll to `sectionId`, navigating if needed. */
export function requestSettingsSection(sectionId: string): void {
  try {
    sessionStorage.setItem(SETTINGS_SECTION_INTENT_KEY, sectionId);
  } catch {
    // sessionStorage unavailable (private mode) — the live event still works.
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EVENT, { detail: sectionId }));
}

/** Read and clear any pending section intent (called by Settings on mount). */
export function consumePendingSettingsSection(): string | null {
  try {
    const id = sessionStorage.getItem(SETTINGS_SECTION_INTENT_KEY);
    if (id) sessionStorage.removeItem(SETTINGS_SECTION_INTENT_KEY);
    return id;
  } catch {
    return null;
  }
}
