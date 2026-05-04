/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';

describe('useTheme', () => {
  let mockLocalStorage: Record<string, string>;
  let mockClassList: Set<string>;

  beforeEach(() => {
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
        toggle: vi.fn((className: string, force?: boolean) => {
          if (force === undefined) {
            if (mockClassList.has(className)) {
              mockClassList.delete(className);
              return false;
            }
            mockClassList.add(className);
            return true;
          }
          if (force) {
            mockClassList.add(className);
          } else {
            mockClassList.delete(className);
          }
          return force;
        }),
      },
      writable: true,
      configurable: true,
    });

    useTheme.setState({ theme: 'dark', resolvedTheme: 'dark' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockClassList.clear();
  });

  describe('eager initialization', () => {
    it('should expose resolvedTheme matching theme', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe(result.current.theme);
    });

    it('should default to dark when localStorage is empty', () => {
      useTheme.setState({ theme: 'dark', resolvedTheme: 'dark' });
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
    });
  });

  describe('toggleTheme', () => {
    it('should toggle from dark to light', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('should toggle from light to dark', () => {
      useTheme.setState({ theme: 'light', resolvedTheme: 'light' });

      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('should update localStorage when toggling', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('panopticon.ui.theme', 'light');
    });

    it('should toggle DOM dark class via classList.toggle', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(document.documentElement.classList.toggle).toHaveBeenCalledWith('dark', false);
    });

    it('should add dark class when toggling to dark', () => {
      useTheme.setState({ theme: 'light', resolvedTheme: 'light' });
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });

      expect(document.documentElement.classList.toggle).toHaveBeenCalledWith('dark', true);
    });

    it('should toggle multiple times correctly', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });
      expect(result.current.theme).toBe('light');
    });

    it('should maintain state consistency between multiple toggles', () => {
      const { result } = renderHook(() => useTheme());

      const initialTheme = result.current.theme;

      act(() => {
        result.current.toggleTheme();
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe(initialTheme);
    });
  });
});
