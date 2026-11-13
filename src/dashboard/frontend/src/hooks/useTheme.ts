import { create } from 'zustand';
import { isMobileShellPath, readAppearance, resolveAppearance } from '../lib/appearance';
import { isNativeShell } from '../lib/nativeShell';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'overdeck.ui.theme';

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: Theme, suppressTransitions = false) {
  const html = document.documentElement;
  if (suppressTransitions) {
    html.classList.add('no-transitions');
  }
  html.classList.toggle('dark', theme === 'dark');
  if (suppressTransitions) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        html.classList.remove('no-transitions');
      });
    });
  }
}

// Sync the theme to the server so newly spawned tmux sessions stamp their
// pane background to match — that's what lets Claude Code's `theme: auto`
// detect the dashboard theme at startup, even when started headless.
function syncThemeToServer(theme: Theme) {
  if (isNativeShell()) return;
  try {
    void fetch('/api/settings/ui-theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).catch(() => {});
  } catch {
    // fetch unavailable (tests) — theme sync is best-effort
  }
}

/**
 * The `/m` web shell owns its theme through the phone appearance (PAN-5208 D-4): on those paths
 * this module neither applies nor syncs the desktop theme at load, so the `index.html` pre-paint
 * stays in place while the lazy `MobileApp` chunk loads, and `useMobileAppearance` takes over.
 */
const mobileWebShell = !isNativeShell() && typeof window !== 'undefined' && isMobileShellPath(window.location.pathname);

function initialTheme(): Theme {
  if (!mobileWebShell) return getStoredTheme();
  const systemDark = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveAppearance(readAppearance(), systemDark);
}

if (!mobileWebShell) {
  applyTheme(getStoredTheme());
  // Only clients with an explicitly chosen theme may push it to the server on
  // load. Fresh profiles (Playwright UAT runs, e2e, incognito) have no stored
  // key and default to dark — letting them sync would silently clobber the
  // user's choice and spawn wrong-theme sessions.
  if (localStorage.getItem(STORAGE_KEY) !== null) {
    syncThemeToServer(getStoredTheme());
  }
}

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  /** Applies the theme for this page only: no storage write, no server sync (the `/m` shell, PAN-5208 D-3). */
  setLocalTheme: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  resolvedTheme: initialTheme(),

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme, true);
    localStorage.setItem(STORAGE_KEY, newTheme);
    syncThemeToServer(newTheme);
    set({ theme: newTheme, resolvedTheme: newTheme });
  },

  setTheme: (theme: Theme) => {
    applyTheme(theme, true);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable or full: the theme still applies for this session.
    }
    syncThemeToServer(theme);
    set({ theme, resolvedTheme: theme });
  },

  setLocalTheme: (theme: Theme) => {
    applyTheme(theme, true);
    set({ theme, resolvedTheme: theme });
  },
}));
