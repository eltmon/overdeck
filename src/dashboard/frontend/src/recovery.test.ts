import { afterEach, describe, expect, it, vi } from 'vitest';
import { isModuleLoadError, RootErrorBoundary } from './recovery';

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('isModuleLoadError', () => {
  it('matches the common dynamic-import failure messages', () => {
    const messages = [
      'Failed to fetch dynamically imported module: https://pan.localhost/assets/Foo-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'module script failed',
    ];
    for (const message of messages) {
      expect(isModuleLoadError(new Error(message)), message).toBe(true);
      expect(isModuleLoadError(message), message).toBe(true);
    }
  });

  it('ignores unrelated errors', () => {
    expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isModuleLoadError('some render bug')).toBe(false);
    expect(isModuleLoadError(undefined)).toBe(false);
    expect(isModuleLoadError(null)).toBe(false);
    expect(isModuleLoadError({})).toBe(false);
  });
});

describe('RootErrorBoundary recovery policy', () => {
  it('leaves generic render crashes on the in-app fallback without auto-reloading', () => {
    const boundary = new RootErrorBoundary({ children: null });

    boundary.componentDidCatch(new Error('Cannot read properties of undefined'));

    expect(document.getElementById('pan-recovery-overlay')).toBeNull();
    expect(sessionStorage.getItem('pan.recovery.lastCrashReload')).toBeNull();
  });

  it('still starts self-recovery for module load errors', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const boundary = new RootErrorBoundary({ children: null });

    boundary.componentDidCatch(new Error('Failed to fetch dynamically imported module: /assets/App.js'));

    expect(document.getElementById('pan-recovery-overlay')).not.toBeNull();
  });
});
