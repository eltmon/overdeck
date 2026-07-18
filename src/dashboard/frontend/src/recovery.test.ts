import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hideOverlay,
  isModuleLoadError,
  recordRecoveryReload,
  RootErrorBoundary,
  sameOriginResourceUrl,
  showOverlay,
} from './recovery';

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('isModuleLoadError', () => {
  it('matches the common dynamic-import failure messages', () => {
    const messages = [
      'Failed to fetch dynamically imported module: https://overdeck.localhost/assets/Foo-abc.js',
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

describe('sameOriginResourceUrl', () => {
  it('accepts same-origin scripts and stylesheets', () => {
    const script = document.createElement('script');
    script.src = '/assets/app.js';
    const link = document.createElement('link');
    link.href = `${window.location.origin}/assets/app.css`;

    expect(sameOriginResourceUrl(script)).toBe(`${window.location.origin}/assets/app.js`);
    expect(sameOriginResourceUrl(link)).toBe(`${window.location.origin}/assets/app.css`);
  });

  it('ignores blocked cross-origin scripts such as PostHog remote config', () => {
    const script = document.createElement('script');
    script.src = 'https://us-assets.i.posthog.com/array/key/config.js';
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans';

    expect(sameOriginResourceUrl(script)).toBeNull();
    expect(sameOriginResourceUrl(link)).toBeNull();
  });
});

describe('recovery reload circuit breaker', () => {
  it('stops after three consecutive reloads and resets outside the recovery window', () => {
    expect(recordRecoveryReload(1_000)).toEqual({ count: 1, shouldReload: true });
    expect(recordRecoveryReload(2_000)).toEqual({ count: 2, shouldReload: true });
    expect(recordRecoveryReload(3_000)).toEqual({ count: 3, shouldReload: true });
    expect(recordRecoveryReload(4_000)).toEqual({ count: 4, shouldReload: false });
    expect(recordRecoveryReload(20_000)).toEqual({ count: 1, shouldReload: true });
  });
});

describe('bundle-independent boot watchdog', () => {
  it('shares the same-origin guard and reload circuit breaker', () => {
    expect(INDEX_HTML).toContain("return url.origin === window.location.origin ? url.href : null;");
    expect(INDEX_HTML).toContain("var reloadCountKey = 'pan.recovery.reloadCount';");
    expect(INDEX_HTML).toContain('var maxConsecutiveReloads = 3;');
    expect(INDEX_HTML).toContain('showManualRecovery();');
  });
});

describe('recovery overlay', () => {
  it('shows, updates, and hides the overlay idempotently', () => {
    showOverlay('Reconnecting to the dashboard…');
    expect(document.getElementById('pan-recovery-overlay')?.textContent).toContain('Reconnecting to the dashboard…');

    showOverlay('Server unreachable — Retry', { label: 'Retry', onClick: () => undefined });
    expect(document.querySelectorAll('#pan-recovery-overlay')).toHaveLength(1);
    expect(document.getElementById('pan-recovery-overlay')?.textContent).toContain('Server unreachable — Retry');
    expect(document.querySelector('button')?.textContent).toBe('Retry');

    hideOverlay();
    hideOverlay();
    expect(document.getElementById('pan-recovery-overlay')).toBeNull();
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
