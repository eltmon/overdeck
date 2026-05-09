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

applyTheme(getStoredTheme());

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
    set({ theme: newTheme, resolvedTheme: newTheme });
  },
}));
