import { describe, expect, it, vi } from 'vitest';

import type { ComputerUseProvider, SetupStep, SetupStepResult } from '../platform-types.js';
import { runSetup, SetupInProgressError, type SetupDeps } from '../setup.js';
import type { ComputerUseStatusView } from '../status.js';

function statusWith(setupSteps: SetupStep[], overrides: Partial<ComputerUseStatusView> = {}): ComputerUseStatusView {
  return {
    platform: 'linux',
    supported: true,
    enabled: false,
    hostname: 'desk',
    session: { ok: true, label: 'x11 · display :1' },
    checks: [],
    setupSteps,
    lease: null,
    skill: { installed: true, locations: ['~/.claude/skills'] },
    ...overrides,
  };
}

const INSTALL: SetupStep = { id: 'install-packages', label: 'Install xdotool', needsPassword: true };
const A11Y: SetupStep = { id: 'enable-accessibility', label: 'Turn on GNOME accessibility' };
const FLAG: SetupStep = { id: 'enable-flag', label: 'Turn on Computer Use' };
const HELPER: SetupStep = { id: 'test-helper', label: 'Test the helper' };

function harness(options: {
  steps: SetupStep[];
  stepResults?: Partial<Record<string, SetupStepResult>>;
  helper?: () => Promise<{ ok: boolean; [key: string]: unknown }>;
  viewOverrides?: Partial<ComputerUseStatusView>;
}) {
  const order: string[] = [];
  const provider: ComputerUseProvider = {
    id: 'linux',
    blockedKeyPlatform: 'linux',
    resolveSession: async () => ({ ok: true, session: { label: 'x11 · display :1', env: { DISPLAY: ':1' } } }),
    readiness: async () => ({ session: { ok: true, label: 'x11 · display :1' }, checks: [], setupSteps: [] }),
    runSetupStep: vi.fn(async (id) => {
      order.push(id);
      return options.stepResults?.[id] ?? { status: 'done' as const };
    }),
    runHelper: vi.fn(async () => {
      order.push('test-helper');
      return (options.helper ?? (async () => ({ ok: true })))();
    }),
  };
  const saveSettings = vi.fn(async (input: { enabled: boolean }) => {
    order.push('enable-flag');
    return input;
  });
  const withDesktopLock = vi.fn(async <T,>(fn: () => Promise<T>) => fn());
  const buildStatus = vi.fn(async () => statusWith(options.steps, options.viewOverrides));
  const deps: SetupDeps = {
    buildStatus,
    detectPlatform: () => 'linux',
    providerFor: (id) => (id === 'linux' ? provider : null),
    saveSettings,
    withDesktopLock,
  };
  return { deps, order, provider, saveSettings, withDesktopLock, buildStatus };
}

describe('runSetup (PAN-5461 WI-4b)', () => {
  it('runs provider steps, then writes the flag, then tests the helper under the lock', async () => {
    const h = harness({ steps: [INSTALL, A11Y, FLAG, HELPER] });
    const result = await runSetup(h.deps);
    expect(h.order).toEqual(['install-packages', 'enable-accessibility', 'enable-flag', 'test-helper']);
    expect(h.saveSettings).toHaveBeenCalledWith({ enabled: true });
    expect(h.withDesktopLock).toHaveBeenCalledTimes(1);
    expect(h.provider.runHelper).toHaveBeenCalledWith({ tool: 'handshake' }, { label: 'x11 · display :1', env: { DISPLAY: ':1' } });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.id, s.status])).toEqual([
      ['install-packages', 'done'],
      ['enable-accessibility', 'done'],
      ['enable-flag', 'done'],
      ['test-helper', 'done'],
    ]);
    expect(h.buildStatus).toHaveBeenCalledTimes(2);
  });

  it('stops after a failed install, before enable-flag, and returns its command', async () => {
    const h = harness({
      steps: [INSTALL, FLAG, HELPER],
      stepResults: {
        'install-packages': { status: 'failed', message: 'The password prompt was cancelled.', command: 'sudo apt-get install -y xdotool' },
      },
    });
    const result = await runSetup(h.deps);
    expect(result.ok).toBe(false);
    expect(result.steps).toEqual([
      {
        id: 'install-packages',
        label: 'Install xdotool',
        status: 'failed',
        message: 'The password prompt was cancelled.',
        command: 'sudo apt-get install -y xdotool',
      },
    ]);
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.provider.runHelper).not.toHaveBeenCalled();
  });

  it('stops at a waiting step', async () => {
    const h = harness({
      steps: [A11Y, FLAG, HELPER],
      stepResults: { 'enable-accessibility': { status: 'waiting', message: 'Grant access, then press Continue.' } },
    });
    const result = await runSetup(h.deps);
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.status)).toEqual(['waiting']);
    expect(h.saveSettings).not.toHaveBeenCalled();
  });

  it('reports a failed helper test with the flag still written', async () => {
    const h = harness({
      steps: [FLAG, HELPER],
      helper: async () => {
        throw new Error('helper_timeout');
      },
    });
    const result = await runSetup(h.deps);
    expect(result.ok).toBe(false);
    expect(h.saveSettings).toHaveBeenCalledWith({ enabled: true });
    expect(result.steps.at(-1)).toEqual({ id: 'test-helper', label: 'Test the helper', status: 'failed', message: 'helper_timeout' });
  });

  it('treats an ok:false handshake as a failed helper test', async () => {
    const h = harness({ steps: [HELPER], helper: async () => ({ ok: false, error: 'no atspi bus' }) });
    const result = await runSetup(h.deps);
    expect(result.steps).toEqual([{ id: 'test-helper', label: 'Test the helper', status: 'failed', message: 'no atspi bus' }]);
  });

  it('reports a failed flag write and stops before the helper test', async () => {
    const h = harness({ steps: [FLAG, HELPER] });
    h.saveSettings.mockRejectedValueOnce(new Error('YAML syntax error'));
    const result = await runSetup(h.deps);
    expect(result.steps).toEqual([{ id: 'enable-flag', label: 'Turn on Computer Use', status: 'failed', message: 'YAML syntax error' }]);
    expect(h.provider.runHelper).not.toHaveBeenCalled();
  });

  it('returns ok with no steps when ready and enabled', async () => {
    const h = harness({ steps: [], viewOverrides: { enabled: true } });
    const result = await runSetup(h.deps);
    expect(result.ok).toBe(true);
    expect(result.steps).toEqual([]);
    expect(result.status.enabled).toBe(true);
  });

  it('refuses an unavailable host', async () => {
    const h = harness({ steps: [], viewOverrides: { supported: false, session: { ok: false, message: 'nope' } } });
    const result = await runSetup(h.deps);
    expect(result).toMatchObject({ ok: false, steps: [], message: "Computer use isn't available on this host." });
  });

  it('throws SetupInProgressError for a second concurrent call, then allows a new run', async () => {
    let release!: () => void;
    const h = harness({ steps: [INSTALL] });
    vi.mocked(h.provider.runSetupStep).mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ status: 'done' });
      }),
    );
    const first = runSetup(h.deps);
    await expect(runSetup(h.deps)).rejects.toBeInstanceOf(SetupInProgressError);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    expect((await first).ok).toBe(true);
    expect((await runSetup(h.deps)).ok).toBe(true);
  });
});
