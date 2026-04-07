import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  initTheme: () => void;
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  // Suppress transitions during theme switch to prevent flash
  html.classList.add('no-transitions');
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  // Remove no-transitions after two animation frames (allows repaint)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      html.classList.remove('no-transitions');
    });
  });
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: 'dark', // Default, will be overridden by initTheme()

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('panopticon.ui.theme', newTheme);
    set({ theme: newTheme });
  },

  initTheme: () => {
    const stored = localStorage.getItem('panopticon.ui.theme');
    const validStored: Theme | null = stored === 'light' || stored === 'dark' ? stored : null;
    const theme = validStored || 'dark';
    if (!validStored) {
      localStorage.setItem('panopticon.ui.theme', theme);
    }
    // Flash prevention script already set the class, but sync state with DOM
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  },
}));
