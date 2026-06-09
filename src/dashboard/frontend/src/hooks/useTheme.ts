import { create } from 'zustand';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'panopticon.ui.theme';

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

applyTheme(getStoredTheme());
syncThemeToServer(getStoredTheme());

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: getStoredTheme(),
  resolvedTheme: getStoredTheme(),

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme, true);
    localStorage.setItem(STORAGE_KEY, newTheme);
    syncThemeToServer(newTheme);
    set({ theme: newTheme, resolvedTheme: newTheme });
  },
}));
