import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const spinner = {
  start: vi.fn(() => spinner),
  succeed: vi.fn(),
  fail: vi.fn(),
  text: '',
};

vi.mock('ora', () => ({
  default: vi.fn(() => spinner),
}));

vi.mock('../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/config.js')>()),
  getDashboardApiUrl: () => 'http://pan.test',
}));

vi.mock('../../../lib/internal-token.js', () => ({
  ensureInternalToken: () => 'test-internal-token',
  INTERNAL_TOKEN_HEADER: 'x-overdeck-internal-token',
}));

describe('planCommand', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['OVERDECK_AGENT_STARTED_BY'];
    delete process.env['OVERDECK_FLYWHEEL_RUN_ID'];
    delete process.env['OVERDECK_CONVERSATION'];
    spinner.text = '';
    global.fetch = vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      },
    })) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends autoStart when --auto-start is provided', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { auto: true, autoStart: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://pan.test/api/issues/PAN-123/start-planning',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-overdeck-internal-token': 'test-internal-token' }),
        body: expect.any(String),
      }),
    );
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      auto: true,
      autoStart: true,
      startedBy: 'operator:cli:pan-plan',
    });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('--auto-start is deprecated'),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pan start'),
    );
    consoleWarnSpy.mockRestore();
  });

  // PAN-3634: run ids are retired. resolveCliStartedBy mints the Flywheel
  // token from OVERDECK_CONVERSATION=conv-flywheel, not from a run id, so a
  // stale OVERDECK_FLYWHEEL_RUN_ID is no longer read at all.
  it('stamps flywheel planning provenance when the Flywheel conversation is inherited', async () => {
    process.env['OVERDECK_CONVERSATION'] = 'conv-flywheel';
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { auto: true });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.startedBy).toBe('flywheel:conv-flywheel');
  });

  it('ignores blank inherited provenance and uses the Flywheel origin', async () => {
    process.env['OVERDECK_AGENT_STARTED_BY'] = '   ';
    process.env['OVERDECK_CONVERSATION'] = 'conv-flywheel';
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { auto: true });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.startedBy).toBe('flywheel:conv-flywheel');
  });

  it('no longer reads a legacy OVERDECK_FLYWHEEL_RUN_ID for planning provenance', async () => {
    process.env['OVERDECK_FLYWHEEL_RUN_ID'] = 'RUN-81';
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { auto: true });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.startedBy).toBe('operator:cli:pan-plan');
  });

  it('sends probe when --probe is provided', async () => {
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { probe: true });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      probe: true,
    });
  });

  it('sends effort: max when --effort max is provided', async () => {
    const { planCommand } = await import('../plan.js');

    await planCommand('PAN-123', { effort: 'max' });

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      effort: 'max',
    });
  });
});
