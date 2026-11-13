import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APPEARANCE_KEY,
  isMobileShellPath,
  onAppearanceChange,
  readAppearance,
  resolveAppearance,
  writeAppearance,
} from '../appearance';

describe('phone appearance store (PAN-5208)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads system when nothing is stored', () => {
    expect(readAppearance()).toBe('system');
  });

  it('reads system for an invalid stored value', () => {
    localStorage.setItem(APPEARANCE_KEY, 'blue');
    expect(readAppearance()).toBe('system');
  });

  it('reads system when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(readAppearance()).toBe('system');
  });

  it('writeAppearance stores the value and notifies a listener once; unsubscribe stops it', () => {
    const listener = vi.fn();
    const off = onAppearanceChange(listener);
    writeAppearance('light');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light');
    expect(readAppearance()).toBe('light');
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    writeAppearance('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resolves system through the OS setting', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });

  it('isMobileShellPath matches only the /m shell paths', () => {
    for (const path of ['/m', '/m/', '/m/pipeline']) expect(isMobileShellPath(path)).toBe(true);
    for (const path of ['/', '/mobile', '/settings']) expect(isMobileShellPath(path)).toBe(false);
  });
});
