import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureException } from './lib/telemetry';
import {
  captureRecoveryReload,
  hideOverlay,
  isModuleLoadError,
  recordRecoveryReload,
  RootErrorBoundary,
  sameOriginResourceUrl,
  showOverlay,
} from './recovery';

vi.mock('./lib/telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/telemetry')>();
  return { ...actual, captureException: vi.fn() };
});

const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.clearAllMocks();
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
  it('accepts same-origin scripts, stylesheets, and message URLs', () => {
    const script = document.createElement('script');
    script.src = '/assets/app.js';
    const link = document.createElement('link');
    link.href = `${window.location.origin}/assets/app.css`;

    expect(sameOriginResourceUrl(script)).toBe(`${window.location.origin}/assets/app.js`);
    expect(sameOriginResourceUrl(link)).toBe(`${window.location.origin}/assets/app.css`);
    expect(sameOriginResourceUrl('/assets/chunk.js')).toBe(`${window.location.origin}/assets/chunk.js`);
  });

  it('ignores blocked cross-origin scripts such as PostHog remote config', () => {
    const script = document.createElement('script');
    script.src = 'https://us-assets.i.posthog.com/array/key/config.js';
    const link = document.createElement('link');
    link.href = 'https://example.com/fonts/DMSans-Variable.woff2';

    expect(sameOriginResourceUrl(script)).toBeNull();
    expect(sameOriginResourceUrl(link)).toBeNull();
    expect(sameOriginResourceUrl('https://example.com/assets/chunk.js')).toBeNull();
  });

  it('accepts the self-hosted font path as a same-origin resource', () => {
    const link = document.createElement('link');
    link.href = `${window.location.origin}/fonts/DMSans-Variable.woff2`;

    expect(sameOriginResourceUrl(link)).toBe(`${window.location.origin}/fonts/DMSans-Variable.woff2`);
  });
});

describe('recovery reload circuit breaker', () => {
  it('persists the count, stops after three consecutive reloads, and resets outside the window', () => {
    expect(recordRecoveryReload(1_000)).toEqual({ count: 1, shouldReload: true });
    expect(recordRecoveryReload(2_000)).toEqual({ count: 2, shouldReload: true });
    expect(recordRecoveryReload(3_000)).toEqual({ count: 3, shouldReload: true });
    expect(recordRecoveryReload(4_000)).toEqual({ count: 4, shouldReload: false });
    expect(sessionStorage.getItem('pan.recovery.reloadCount')).toBe('4');
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

describe('recovery reload telemetry', () => {
  it('sends the accepted resource URL and recorded reload count immediately', () => {
    const script = document.createElement('script');
    script.src = '/assets/App.js';
    const resource = sameOriginResourceUrl(script) ?? undefined;
    const decision = recordRecoveryReload(1_000);

    captureRecoveryReload({
      trigger: 'asset_load_error',
      resource,
      message: 'Module asset failed to load',
    }, decision);

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Module asset failed to load' }),
      {
        action: 'frontend_recovery_reload',
        trigger: 'asset_load_error',
        reload_count: '1-2',
        should_reload: true,
      },
    );
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('sends loop telemetry immediately when the circuit breaker trips', () => {
    recordRecoveryReload(1_000);
    recordRecoveryReload(2_000);
    recordRecoveryReload(3_000);
    const decision = recordRecoveryReload(4_000);

    captureRecoveryReload({
      trigger: 'root_error_boundary',
      resource: `${window.location.origin}/assets/App.js`,
      message: 'Failed to fetch dynamically imported module: /assets/App.js',
      stackHead: 'Error: chunk failed',
    }, decision);

    expect(captureException).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ stack: 'Error: chunk failed' }),
      expect.objectContaining({
        action: 'frontend_recovery_reload',
        trigger: 'root_error_boundary',
        reload_count: '3-5',
        should_reload: false,
      }),
    );
    expect(captureException).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ stack: 'Error: chunk failed' }),
      expect.objectContaining({ action: 'frontend_recovery_reload_loop', reload_count: '3-5' }),
    );
  });
});

describe('RootErrorBoundary recovery policy', () => {
  it('leaves generic render crashes on the in-app fallback without auto-reloading', () => {
    const boundary = new RootErrorBoundary({ children: null });

    boundary.componentDidCatch(new Error('Cannot read properties of undefined'));

    expect(document.getElementById('pan-recovery-overlay')).toBeNull();
    expect(sessionStorage.getItem('pan.recovery.lastCrashReload')).toBeNull();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { action: 'frontend_unhandled_error', trigger: 'root_error_boundary' },
    );
  });

  it('still starts self-recovery for module load errors', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    const boundary = new RootErrorBoundary({ children: null });

    boundary.componentDidCatch(new Error('Failed to fetch dynamically imported module: /assets/App.js'));

    expect(document.getElementById('pan-recovery-overlay')).not.toBeNull();
  });
});
