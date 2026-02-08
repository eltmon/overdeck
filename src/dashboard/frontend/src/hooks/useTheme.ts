import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  initTheme: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: 'dark', // Default, will be overridden by initTheme()

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';

    // Update DOM
    if (newTheme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }

    // Persist to localStorage
    localStorage.setItem('panopticon.ui.theme', newTheme);

    // Update state
    set({ theme: newTheme });
  },

  initTheme: () => {
    // Read from localStorage, fall back to OS preference
    const stored = localStorage.getItem('panopticon.ui.theme') as Theme | null;
    const osPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = stored || osPreference;

    // Update DOM
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }

    // Update state
    set({ theme });
  },
}));
