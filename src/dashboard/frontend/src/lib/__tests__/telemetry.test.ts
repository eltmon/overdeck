import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

describe('frontend telemetry wrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not capture events before initialization', async () => {
    const { capture } = await import('../telemetry');

    capture('project_created', { mode: 'new' });

    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('never initializes PostHog when settings disable telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ telemetry: { enabled: false, installId: 'install-id' } }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.register).not.toHaveBeenCalled();
  });

  it('hard-disables automatic DOM, page, replay, survey, and exception capture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ telemetry: { enabled: true, installId: 'install-id' } }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.init.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
    }));
    expect(posthogMock.register).toHaveBeenCalledWith({ install_id: 'install-id' });
  });

  it('removes private messages and stack frames from captured exceptions', async () => {
    const { sanitizeTelemetryException } = await import('../telemetry');
    const original = new Error(
      'PAN-2599 failed in /home/alice/private-repo/src/secret.ts with token ghp_secret',
    );

    const sanitized = sanitizeTelemetryException(original, { action: 'merge' });

    expect(sanitized.name).toBe('OverdeckTelemetryException');
    expect(sanitized.message).toBe('Overdeck merge operation failed');
    expect(sanitized.stack).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain('PAN-2599');
    expect(JSON.stringify(sanitized)).not.toContain('/home/alice');
    expect(JSON.stringify(sanitized)).not.toContain('ghp_secret');
  });
});
