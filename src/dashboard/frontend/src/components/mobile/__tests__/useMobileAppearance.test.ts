import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useTheme } from '../../../hooks/useTheme';
import { APPEARANCE_KEY, writeAppearance } from '../../../lib/appearance';
import { useMobileAppearance } from '../useMobileAppearance';

type ChangeListener = () => void;

/** A controllable `(prefers-color-scheme: dark)` media query. */
function stubColorScheme(initialDark: boolean) {
  const listeners = new Set<ChangeListener>();
  const media = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_type: string, listener: ChangeListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: ChangeListener) => listeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return {
    setDark(dark: boolean) {
      media.matches = dark;
      for (const listener of listeners) listener();
    },
  };
}

function htmlIsDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

describe('useMobileAppearance (PAN-5208)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useTheme.setState({ theme: 'light', resolvedTheme: 'light' });
    fetchSpy = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    delete (globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__;
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
  });

  it('ac3: applies a stored dark appearance and follows later writes', () => {
    stubColorScheme(false);
    localStorage.setItem(APPEARANCE_KEY, 'dark');
    const { unmount } = renderHook(() => useMobileAppearance());
    expect(htmlIsDark()).toBe(true);
    expect(useTheme.getState().resolvedTheme).toBe('dark');

    act(() => writeAppearance('light'));
    expect(htmlIsDark()).toBe(false);
    expect(useTheme.getState().resolvedTheme).toBe('light');
    unmount();

    expect(localStorage.getItem('overdeck.ui.theme')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ac3: re-resolves System on an OS light/dark change', () => {
    const scheme = stubColorScheme(false);
    localStorage.setItem(APPEARANCE_KEY, 'system');
    const { unmount } = renderHook(() => useMobileAppearance());
    expect(htmlIsDark()).toBe(false);

    act(() => scheme.setDark(true));
    expect(htmlIsDark()).toBe(true);
    unmount();

    expect(localStorage.getItem('overdeck.ui.theme')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ac4: does nothing in the phone app', () => {
    (globalThis as { __OVERDECK_NATIVE__?: boolean }).__OVERDECK_NATIVE__ = true;
    stubColorScheme(true);
    localStorage.setItem(APPEARANCE_KEY, 'dark');
    const { unmount } = renderHook(() => useMobileAppearance());

    expect(htmlIsDark()).toBe(false);
    expect(useTheme.getState().resolvedTheme).toBe('light');
    act(() => writeAppearance('dark'));
    expect(htmlIsDark()).toBe(false);
    unmount();

    expect(localStorage.getItem('overdeck.ui.theme')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
