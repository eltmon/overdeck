import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { BUILTIN_COLOR_THEMES, type ColorTheme } from '@overdeck/contracts';
import { installStrictFetchMock } from '../../test-utils/strictFetchMock';
import { useTheme } from '../useTheme';
import { useColorTheme } from '../useColorTheme';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function theme(overrides: Partial<ColorTheme> & { id: string; type: 'light' | 'dark' }): ColorTheme {
  return { builtin: false, name: overrides.id, ...overrides };
}

const defaultActive = () => ({ light: BUILTIN_COLOR_THEMES['overdeck-light'], dark: BUILTIN_COLOR_THEMES['overdeck-dark'] });

describe('useColorTheme', () => {
  let mockLocalStorage: Record<string, string>;
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

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

    document.documentElement.removeAttribute('style');
    useTheme.setState({ theme: 'dark', resolvedTheme: 'dark' });
    useColorTheme.setState({ themes: [], selection: { light: 'overdeck-light', dark: 'overdeck-dark' }, warnings: [], active: defaultActive(), loaded: false });
  });

  afterEach(async () => {
    await fetchControl?.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    document.documentElement.removeAttribute('style');
  });

  it('ac1: toggling dark to light updates --background to the light theme value', async () => {
    const dark = theme({ id: 'dark-x', type: 'dark', ui: { background: '#10141c' } });
    const light = theme({ id: 'light-x', type: 'light', ui: { background: '#fcfcfc' } });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({ themes: [dark, light], selection: { light: 'light-x', dark: 'dark-x' }, warnings: [] });
      }
      return undefined;
    });

    const { result } = renderHook(() => useColorTheme());
    await act(async () => {
      await result.current.reconcileFromServer();
    });
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#10141c');

    await act(async () => {
      useTheme.setState({ theme: 'light', resolvedTheme: 'light' });
    });
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#fcfcfc');
  });

  it('ac2: toggling to a theme with no ui group removes the inline --background', async () => {
    const dark = theme({ id: 'dark-x', type: 'dark', ui: { background: '#10141c' } });
    const light = theme({ id: 'light-x', type: 'light' });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({ themes: [dark, light], selection: { light: 'light-x', dark: 'dark-x' }, warnings: [] });
      }
      return undefined;
    });

    const { result } = renderHook(() => useColorTheme());
    await act(async () => {
      await result.current.reconcileFromServer();
    });
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#10141c');

    await act(async () => {
      useTheme.setState({ theme: 'light', resolvedTheme: 'light' });
    });
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('');
  });

  it('ac3: switching to a theme without a ui group removes every token the previous theme set', async () => {
    const full = theme({
      id: 'full', type: 'dark',
      ui: { background: '#10141c', surface: '#15192a', border: '#2a2f45', foreground: '#eaeaea', muted: '#9aa0b4', accent: '#5a8dee' },
    });
    const bare = theme({ id: 'bare', type: 'light' });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({ themes: [full, bare], selection: { light: 'bare', dark: 'full' }, warnings: [] });
      }
      return undefined;
    });

    const { result } = renderHook(() => useColorTheme());
    await act(async () => {
      await result.current.reconcileFromServer();
    });
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#5a8dee');

    await act(async () => {
      useTheme.setState({ theme: 'light', resolvedTheme: 'light' });
    });

    for (const prop of ['--background', '--card', '--border', '--foreground', '--muted-foreground', '--primary', '--ring', '--primary-ink', '--primary-foreground']) {
      expect(document.documentElement.style.getPropertyValue(prop)).toBe('');
    }
  });

  it('ac4: a theme with all six ui keys never sets a signal/state token', async () => {
    const full = theme({
      id: 'full', type: 'dark',
      ui: { background: '#10141c', surface: '#15192a', border: '#2a2f45', foreground: '#eaeaea', muted: '#9aa0b4', accent: '#5a8dee' },
    });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({ themes: [full], selection: { light: 'overdeck-light', dark: 'full' }, warnings: [] });
      }
      return undefined;
    });

    const { result } = renderHook(() => useColorTheme());
    await act(async () => {
      await result.current.reconcileFromServer();
    });

    for (const prop of ['--state-live', '--success', '--warning', '--destructive', '--signal-live', '--signal-idle']) {
      expect(document.documentElement.style.getPropertyValue(prop)).toBe('');
    }
  });

  it('ac5: reconcileFromServer applies the server selection and sends no PUT or POST', async () => {
    const dark = theme({ id: 'ayu-dark', type: 'dark', ui: { accent: '#e6b450' } });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({ themes: [dark], selection: { light: 'overdeck-light', dark: 'ayu-dark' }, warnings: [] });
      }
      return undefined;
    });

    const { result } = renderHook(() => useColorTheme());
    await act(async () => {
      await result.current.reconcileFromServer();
    });

    expect(result.current.selection).toEqual({ light: 'overdeck-light', dark: 'ayu-dark' });
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#e6b450');
    expect(fetchControl.fetchMock.mock.calls.every(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('select PUTs { mode, id } and applies the theme when it matches the current mode', async () => {
    const ayuDark = theme({ id: 'ayu-dark', type: 'dark', ui: { accent: '#e6b450' } });
    useColorTheme.setState({ themes: [ayuDark] });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/color-themes/selection') {
        return Response.json({ selection: { light: 'overdeck-light', dark: 'ayu-dark' } });
      }
      return undefined;
    });

    const { result } = renderHook(() => useColorTheme());
    await act(async () => {
      await result.current.select('dark', 'ayu-dark');
    });

    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#e6b450');
    const putCall = fetchControl.fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toEqual({ mode: 'dark', id: 'ayu-dark' });
  });
});
