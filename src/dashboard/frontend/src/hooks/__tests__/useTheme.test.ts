/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';

describe('useTheme', () => {
  let mockLocalStorage: Record<string, string>;
  let mockClassList: Set<string>;
  let mockMatchMedia: { matches: boolean };

  beforeEach(() => {
    // Mock localStorage
    mockLocalStorage = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      length: 0,
      key: vi.fn(() => null),
    };

    // Mock document.documentElement.classList
    mockClassList = new Set<string>();
    Object.defineProperty(document.documentElement, 'classList', {
      value: {
        add: vi.fn((className: string) => {
          mockClassList.add(className);
        }),
        remove: vi.fn((className: string) => {
          mockClassList.delete(className);
        }),
        contains: vi.fn((className: string) => mockClassList.has(className)),
        toggle: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    // Mock window.matchMedia
    mockMatchMedia = { matches: false };
    global.window.matchMedia = vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? mockMatchMedia.matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockClassList.clear();
    // Reset Zustand store to avoid cross-test state leakage
    useTheme.setState({ theme: 'dark' });
  });

  describe('initTheme', () => {
    it('should initialize with dark theme when localStorage has dark', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'dark';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(mockClassList.has('light')).toBe(false);
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should initialize with light theme when localStorage has light', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(result.current.theme).toBe('light');
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should fall back to OS preference (dark) when localStorage is empty', () => {
      mockMatchMedia.matches = true; // OS prefers dark

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(localStorage.setItem).toHaveBeenCalledWith('panopticon.ui.theme', 'dark');
    });

    it('should default to dark when localStorage is empty regardless of OS preference', () => {
      mockMatchMedia.matches = false; // OS prefers light, but we default to dark

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(localStorage.setItem).toHaveBeenCalledWith('panopticon.ui.theme', 'dark');
    });

    it('should remove dark class from DOM when theme is light', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should add dark class to DOM when theme is dark', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'dark';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should persist theme to localStorage when initializing from OS preference', () => {
      mockMatchMedia.matches = true; // OS prefers dark

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('panopticon.ui.theme', 'dark');
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from dark to light', () => {
      mockMatchMedia.matches = true; // OS prefers dark
      const { result } = renderHook(() => useTheme());

      // Initialize with dark theme
      act(() => {
        result.current.initTheme();
      });

      // Toggle to light
      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
    });

    it('should toggle from light to dark', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      // Initialize with light theme
      act(() => {
        result.current.initTheme();
      });

      // Toggle to dark
      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
    });

    it('should update localStorage when toggling to light', () => {
      mockMatchMedia.matches = true; // OS prefers dark so init → dark
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
        result.current.toggleTheme();
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('panopticon.ui.theme', 'light');
    });

    it('should update localStorage when toggling to dark', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
        result.current.toggleTheme();
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('panopticon.ui.theme', 'dark');
    });

    it('should remove dark class from DOM when toggling to light', () => {
      mockMatchMedia.matches = true; // OS prefers dark so init → dark
      mockClassList.add('dark');
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
        result.current.toggleTheme();
      });

      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should add dark class to DOM when toggling to dark', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
        result.current.toggleTheme();
      });

      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });

    it('should toggle multiple times correctly', () => {
      mockMatchMedia.matches = true; // OS prefers dark so init → dark
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      // Toggle to light
      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('light');

      // Toggle back to dark
      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('dark');

      // Toggle to light again
      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('light');
    });
  });

  describe('Edge cases', () => {
    it('should handle invalid localStorage value by falling back to OS preference', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'invalid-theme';
      mockMatchMedia.matches = true; // OS prefers dark

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(result.current.theme).toBe('dark');
    });

    it('should default to dark when no localStorage and OS has no preference', () => {
      mockMatchMedia.matches = false;

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      expect(result.current.theme).toBe('dark'); // Always defaults to dark when no stored preference
    });

    it('should maintain state consistency between multiple toggles', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      const initialTheme = result.current.theme;

      // Toggle twice should return to initial state
      act(() => {
        result.current.toggleTheme();
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe(initialTheme);
    });
  });

  describe('Integration with CSS', () => {
    it('should work with Tailwind dark mode class strategy', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'light';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      // Light mode removes 'dark' class (Tailwind darkMode: 'class' uses 'dark' class)
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith('dark');
    });

    it('should add dark class for dark mode (Tailwind default)', () => {
      mockLocalStorage['panopticon.ui.theme'] = 'dark';

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.initTheme();
      });

      // Dark mode adds 'dark' class
      expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
    });
  });
});
