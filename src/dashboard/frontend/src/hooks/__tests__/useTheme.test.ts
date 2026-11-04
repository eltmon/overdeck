import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { installStrictFetchMock } from '../../test-utils/strictFetchMock';
import { useTheme } from '../useTheme';

describe('useTheme', () => {
  let mockLocalStorage: Record<string, string>;
  let mockClassList: Set<string>;
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

  beforeEach(() => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/settings/ui-theme') {
        return Response.json({ ok: true });
      }
      return undefined;
    });
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

  afterEach(async () => {
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
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

      expect(localStorage.setItem).toHaveBeenCalledWith('overdeck.ui.theme', 'light');
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

  describe('setTheme', () => {
    it('ac1: sets light theme, clears the dark class, persists to localStorage, and resolves to light', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(localStorage.getItem('overdeck.ui.theme')).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('ac3: syncs the theme to the server with a PUT when outside the native shell', () => {
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('dark');
      });

      expect(fetchControl.fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchControl.fetchMock.mock.calls[0]?.[0]).toBe('/api/settings/ui-theme');
      expect(fetchControl.fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    });

    it('still applies the theme and updates state when localStorage.setItem throws', () => {
      vi.mocked(localStorage.setItem).mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setTheme('light');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(result.current.theme).toBe('light');
      expect(result.current.resolvedTheme).toBe('light');
      expect(fetchControl.fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('native shell', () => {
    afterEach(() => {
      delete (globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__;
    });

    it('ac2: never syncs to the server, on module load with a stored theme or on setTheme', async () => {
      mockLocalStorage['overdeck.ui.theme'] = 'dark';
      (globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__ = true;

      vi.resetModules();
      const native = await import('../useTheme');

      act(() => {
        native.useTheme.getState().setTheme('dark');
      });

      expect(fetchControl.fetchMock).not.toHaveBeenCalled();
    });
  });
});
