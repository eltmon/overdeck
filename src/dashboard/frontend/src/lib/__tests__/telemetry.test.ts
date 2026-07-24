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
      json: async () => ({
        telemetry: { enabled: true, effectiveEnabled: false, installId: 'install-id' },
      }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.register).not.toHaveBeenCalled();
  });

  it('hard-disables private automatic capture and enables sanitized unhandled exceptions', async () => {
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
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      before_send: expect.any(Function),
      get_current_url: expect.any(Function),
      save_campaign_params: false,
      save_referrer: false,
      disable_session_recording: true,
      disable_surveys: true,
    }));
    expect(posthogMock.register).toHaveBeenCalledWith({ install_id: 'install-id' });
  });

  it('strips SDK-added routes, referrers, campaigns, and raw exception fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ telemetry: { enabled: true, installId: 'install-id' } }),
    })));
    const { initTelemetry } = await import('../telemetry');
    await initTelemetry();
    const config = posthogMock.init.mock.calls[0]?.[1] as {
      before_send: (event: unknown) => unknown;
      get_current_url: () => string;
    };

    const sanitized = config.before_send({
      uuid: 'event-uuid',
      event: '$exception',
      properties: {
        $current_url: 'https://overdeck.localhost/issues/PAN-2599',
        $pathname: '/command-deck/private-repo/PAN-2599',
        $referrer: 'https://overdeck.localhost/conv/private-conversation-id',
        $session_entry_url: 'https://overdeck.localhost/conv/private-conversation-id',
        utm_campaign: 'private-repository-name',
        $exception_message: 'PAN-2599 /home/alice/private-repo ghp_secret',
        $exception_list: [{
          type: 'Error',
          value: 'PAN-2599 failed',
          stacktrace: { frames: [{ filename: '/home/alice/private-repo/src/secret.ts' }] },
        }],
        safe_category: 'dashboard',
      },
      $set: {
        $initial_referrer: 'https://overdeck.localhost/issues/PAN-2599',
        safe_set: true,
      },
    }) as Record<string, unknown>;

    expect(config.get_current_url()).toBe('https://overdeck.invalid/');
    expect(sanitized).toMatchObject({
      properties: {
        safe_category: 'dashboard',
        $exception_list: [{
          type: 'OverdeckTelemetryException',
          value: 'Overdeck browser operation failed',
        }],
      },
      $set: { safe_set: true },
    });
    expect(JSON.stringify(sanitized)).not.toContain('PAN-2599');
    expect(JSON.stringify(sanitized)).not.toContain('private-repo');
    expect(JSON.stringify(sanitized)).not.toContain('private-conversation-id');
    expect(JSON.stringify(sanitized)).not.toContain('/home/alice');
    expect(JSON.stringify(sanitized)).not.toContain('ghp_secret');
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
