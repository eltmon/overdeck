import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
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

  // PAN-4264: operator grouping is opt-in and must be revocable.
  it('registers operatorHash while grouping is on and removes the persisted hash once it is off', async () => {
    const settings = { telemetry: { enabled: true, installId: 'install-id', operatorHash: '0123456789abcdef' } as Record<string, unknown> };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => settings })));
    const first = await import('../telemetry');
    await first.initTelemetry();
    expect(posthogMock.register).toHaveBeenCalledWith({ operatorHash: '0123456789abcdef' });
    expect(posthogMock.unregister).not.toHaveBeenCalled();

    vi.resetModules();
    vi.clearAllMocks();
    delete settings.telemetry.operatorHash;
    const second = await import('../telemetry');
    await second.initTelemetry();
    expect(posthogMock.unregister).toHaveBeenCalledWith('operatorHash');
    expect(posthogMock.register).not.toHaveBeenCalledWith(expect.objectContaining({ operatorHash: expect.anything() }));
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

  // PAN-5084: install_kind separates real adoption from CI/test/VM churn.
  it('registers install_kind when the server sends one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        telemetry: { enabled: true, installId: 'install-id', installKind: 'dev_checkout' },
      }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.register).toHaveBeenCalledWith({ install_kind: 'dev_checkout' });
  });

  it('never registers an install_kind key when the server sends none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ telemetry: { enabled: true, installId: 'install-id' } }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.register).not.toHaveBeenCalledWith(
      expect.objectContaining({ install_kind: expect.anything() }),
    );
  });

  it('never calls posthog.init or register when effectiveEnabled is false, even with an installKind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        telemetry: { enabled: true, effectiveEnabled: false, installId: 'install-id', installKind: 'container' },
      }),
    })));
    const { initTelemetry } = await import('../telemetry');

    await initTelemetry();

    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.register).not.toHaveBeenCalled();
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

  // PAN-5100 WI-4
  describe('initTelemetryFromConfig', () => {
    it('registers client desktop and platform web with no bootstrap or memory persistence', async () => {
      const { initTelemetryFromConfig } = await import('../telemetry');

      const ok = initTelemetryFromConfig({ enabled: true }, {
        client: 'desktop',
        platform: 'web',
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
      });

      expect(ok).toBe(true);
      expect(posthogMock.register).toHaveBeenCalledWith({ client: 'desktop', platform: 'web' });
      const initOptions = posthogMock.init.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(initOptions.persistence).toBeUndefined();
      expect(initOptions.bootstrap).toBeUndefined();
    });

    it('passes memory persistence and bootstrap.distinctID for a phone with machineIdentity', async () => {
      const { initTelemetryFromConfig } = await import('../telemetry');

      const ok = initTelemetryFromConfig({ enabled: true, installId: 'id-1' }, {
        client: 'phone',
        platform: 'ios',
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
        machineIdentity: true,
      });

      expect(ok).toBe(true);
      const initOptions = posthogMock.init.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(initOptions.persistence).toBe('memory');
      expect(initOptions.bootstrap).toEqual({ distinctID: 'id-1' });
      expect(posthogMock.register).toHaveBeenCalledWith({ client: 'phone', platform: 'ios' });
    });

    it('registers build_commit only when the config has one', async () => {
      const { initTelemetryFromConfig } = await import('../telemetry');

      initTelemetryFromConfig({ enabled: true, buildCommit: 'abc1234' }, {
        client: 'desktop',
        platform: 'web',
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
      });

      expect(posthogMock.register).toHaveBeenCalledWith({ build_commit: 'abc1234' });
    });

    it('never registers a build_commit key when the config has none', async () => {
      const { initTelemetryFromConfig } = await import('../telemetry');

      initTelemetryFromConfig({ enabled: true }, {
        client: 'desktop',
        platform: 'web',
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
      });

      expect(posthogMock.register).not.toHaveBeenCalledWith(
        expect.objectContaining({ build_commit: expect.anything() }),
      );
    });

    it('returns false and never calls posthog.init when effectiveEnabled is false', async () => {
      const { initTelemetryFromConfig } = await import('../telemetry');

      const ok = initTelemetryFromConfig({ effectiveEnabled: false }, {
        client: 'desktop',
        platform: 'web',
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
      });

      expect(ok).toBe(false);
      expect(posthogMock.init).not.toHaveBeenCalled();
      expect(posthogMock.register).not.toHaveBeenCalled();
    });

    it('is idempotent: a second call while initialized returns true without a second posthog.init', async () => {
      const { initTelemetryFromConfig } = await import('../telemetry');
      const context = {
        client: 'desktop' as const,
        platform: 'web' as const,
        posthogKey: 'phc_test',
        posthogHost: 'https://us.i.posthog.com',
      };

      const first = initTelemetryFromConfig({ enabled: true }, context);
      const second = initTelemetryFromConfig({ enabled: true }, context);

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(posthogMock.init).toHaveBeenCalledTimes(1);
    });
  });
});
