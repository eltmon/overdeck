import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APPEARANCE_KEY,
  installAppearance,
  onAppearanceChange,
  readAppearance,
  resolveAppearance,
  writeAppearance,
  type AppearanceDeps,
} from '../appearance';

function fakeDeps(matches: boolean) {
  const listeners = new Set<() => void>();
  const media: AppearanceDeps['media'] = {
    get matches() {
      return matches;
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const deps: AppearanceDeps = {
    setTheme: vi.fn(),
    setStatusBar: vi.fn(),
    setNative: vi.fn(),
    media,
  };
  const fireChange = (newMatches: boolean) => {
    matches = newMatches;
    for (const listener of listeners) listener();
  };
  return { deps, fireChange };
}

beforeEach(() => {
  localStorage.clear();
});

describe('readAppearance', () => {
  it("reads 'system' when missing or invalid", () => {
    expect(readAppearance()).toBe('system');
    localStorage.setItem(APPEARANCE_KEY, 'not-a-real-appearance');
    expect(readAppearance()).toBe('system');
  });

  it("reads 'system' without throwing when localStorage throws", () => {
    const original = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('storage unavailable');
    };
    expect(() => readAppearance()).not.toThrow();
    expect(readAppearance()).toBe('system');
    localStorage.getItem = original;
  });
});

describe('writeAppearance', () => {
  it('persists the value and notifies listeners once', () => {
    const listener = vi.fn();
    const unsubscribe = onAppearanceChange(listener);

    writeAppearance('light');

    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('resolveAppearance', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
  ] as const)('resolveAppearance(%s, %s) -> %s', (appearance, systemDark, expected) => {
    expect(resolveAppearance(appearance, systemDark)).toBe(expected);
  });
});

describe('installAppearance', () => {
  it("ac3: applies setTheme, setStatusBar and setNative for a stored 'light' appearance", () => {
    writeAppearance('light');
    const { deps } = fakeDeps(false);

    installAppearance(deps);

    expect(deps.setTheme).toHaveBeenCalledWith('light');
    expect(deps.setStatusBar).toHaveBeenCalledWith('light');
    expect(deps.setNative).toHaveBeenCalledWith('light');
  });

  it("ac4: a system-appearance change to dark calls setTheme('dark') when stored appearance is 'system'", () => {
    writeAppearance('system');
    const { deps, fireChange } = fakeDeps(false);

    installAppearance(deps);
    vi.mocked(deps.setTheme).mockClear();

    fireChange(true);

    expect(deps.setTheme).toHaveBeenCalledWith('dark');
  });

  it("ac4: a system-appearance change does not call setTheme('dark') when stored appearance is 'light'", () => {
    writeAppearance('light');
    const { deps, fireChange } = fakeDeps(false);

    installAppearance(deps);
    vi.mocked(deps.setTheme).mockClear();

    fireChange(true);

    expect(deps.setTheme).not.toHaveBeenCalledWith('dark');
  });

  it('ac5: the uninstaller removes the media listener and later writes no longer call setTheme', () => {
    writeAppearance('system');
    const { deps, fireChange } = fakeDeps(false);

    const uninstall = installAppearance(deps);
    uninstall();
    vi.mocked(deps.setTheme).mockClear();

    fireChange(true);
    writeAppearance('dark');

    expect(deps.setTheme).not.toHaveBeenCalled();
  });
});
