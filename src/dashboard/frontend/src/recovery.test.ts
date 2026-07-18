import { afterEach, describe, expect, it, vi } from 'vitest';
import posthog from 'posthog-js';
import {
  captureRecoveryReload,
  hideOverlay,
  incrementRecoveryReloadCount,
  isModuleLoadError,
  isRecoveryReloadLoop,
  RootErrorBoundary,
  showOverlay,
} from './recovery';

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

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
  it('persists the reload count in session storage', () => {
    expect(incrementRecoveryReloadCount()).toBe(1);
    expect(incrementRecoveryReloadCount()).toBe(2);
    expect(sessionStorage.getItem('pan.recovery.reloadCount')).toBe('2');
  });

  it('marks the sixth consecutive recovery as a reload loop', () => {
    for (let reloadCount = 1; reloadCount <= 6; reloadCount++) {
      expect(incrementRecoveryReloadCount()).toBe(reloadCount);
    }

    expect(isRecoveryReloadLoop(5)).toBe(false);
    expect(isRecoveryReloadLoop(6)).toBe(true);
  });

  it('sends the recovery and loop events immediately with diagnostic properties', () => {
    sessionStorage.setItem('pan.recovery.reloadCount', '5');

    captureRecoveryReload({
      trigger: 'root_error_boundary',
      asset: '/assets/App.js',
      message: 'Failed to fetch dynamically imported module: /assets/App.js',
      stackHead: 'Error: chunk failed',
    });

    expect(posthog.capture).toHaveBeenNthCalledWith(
      1,
      'frontend_recovery_reload',
      expect.objectContaining({
        trigger: 'root_error_boundary',
        asset: '/assets/App.js',
        message: 'Failed to fetch dynamically imported module: /assets/App.js',
        stackHead: 'Error: chunk failed',
        reloadCount: 6,
        appVersion: expect.any(String),
      }),
      { send_instantly: true },
    );
    expect(posthog.capture).toHaveBeenNthCalledWith(
      2,
      'frontend_recovery_reload_loop',
      expect.objectContaining({ reloadCount: 6 }),
      { send_instantly: true },
    );
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
