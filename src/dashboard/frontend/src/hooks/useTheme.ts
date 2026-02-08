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
    // Read from localStorage, default to dark
    const stored = localStorage.getItem('panopticon.ui.theme');
    const validStored: Theme | null = stored === 'light' || stored === 'dark' ? stored : null;
    const theme = validStored || 'dark';

    // Persist to localStorage if not already valid (first visit or invalid value)
    if (!validStored) {
      localStorage.setItem('panopticon.ui.theme', theme);
    }

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
