/**
 * PAN-2908 · C-SIMPLE — Simple/Advanced UI mode + simple-issue navigation.
 *
 * One global mode, persisted per browser. Simple is the default for fresh
 * profiles; existing users (who already have dashboard localStorage footprint)
 * keep Advanced until they toggle — no jarring surprise mid-rollout.
 *
 * Simple mode reuses the SAME issue URL (/issues/:id): when mode is simple,
 * App's issue-route handler opens the simple issue page instead of the drawer.
 */
import { create } from 'zustand';

export type UiMode = 'simple' | 'advanced';

const MODE_KEY = 'overdeck:ui-mode';
const LEGACY_FOOTPRINT_KEY = 'overdeck:last-tab';

function initialMode(): UiMode {
  if (typeof window === 'undefined') return 'advanced';
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    if (stored === 'simple' || stored === 'advanced') return stored;
    // Fresh profiles default to simple; anyone with an existing dashboard
    // footprint stays advanced until they opt in.
    return window.localStorage.getItem(LEGACY_FOOTPRINT_KEY) ? 'advanced' : 'simple';
  } catch {
    return 'advanced';
  }
}

interface UiModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  /** Simple-mode issue navigation (independent of the advanced drawer). */
  simpleIssueId: string | null;
  openSimpleIssue: (issueId: string) => void;
  closeSimpleIssue: () => void;
}

export const useUiMode = create<UiModeState>((set) => ({
  mode: initialMode(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // storage unavailable — mode just resets next load
    }
    set({ mode });
  },
  simpleIssueId: null,
  openSimpleIssue: (issueId) => set({ simpleIssueId: issueId }),
  closeSimpleIssue: () => set({ simpleIssueId: null }),
}));

/** Sync the simple-issue page to the canonical /issues/:id URL. */
export function syncSimpleIssueUrl(issueId: string | null) {
  if (typeof window === 'undefined') return;
  const target = issueId ? `/issues/${encodeURIComponent(issueId)}` : '/';
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target);
  }
}
