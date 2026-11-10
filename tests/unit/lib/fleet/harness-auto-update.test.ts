import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../../../../src/lib/config-yaml/defaults.js';
import type { NormalizedConfig } from '../../../../src/lib/config-yaml/schema.js';
import {
  _resetLaunchUpdateStateForTests,
  isHarnessAutoUpdateEnabled,
  LAUNCH_UPDATE_TIMEOUT_MS,
  launchUpdateNote,
  runLaunchUpdate,
} from '../../../../src/lib/fleet/harness-auto-update.js';
import { _resetUpdateQueueForTests } from '../../../../src/lib/fleet/harness-update-runner.js';

const ARGV = ['/p/bin/npm', 'install', '-g', '--prefix', '/p', '@anthropic-ai/claude-code@latest'];
const MINUTE = 60_000;

function globalConfig(harnesses?: NormalizedConfig['harnesses']) {
  return async () => ({ config: { ...DEFAULT_CONFIG, ...(harnesses ? { harnesses } : {}) } as NormalizedConfig });
}

describe('isHarnessAutoUpdateEnabled (PAN-5108 D13, D14)', () => {
  beforeEach(() => {
    _resetLaunchUpdateStateForTests();
  });

  it('is true for a global config with the default harnesses block outside Vitest', async () => {
    expect(await isHarnessAutoUpdateEnabled({ loadGlobal: globalConfig(), env: {} })).toBe(true);
  });

  it('is true when the loaded config has no harnesses block', async () => {
    const loadGlobal = async () => ({ config: { ...DEFAULT_CONFIG, harnesses: undefined } as unknown as NormalizedConfig });
    expect(await isHarnessAutoUpdateEnabled({ loadGlobal, env: {} })).toBe(true);
  });

  it('is false for auto_update: false', async () => {
    expect(await isHarnessAutoUpdateEnabled({ loadGlobal: globalConfig({ autoUpdate: false }), env: {} })).toBe(false);
  });

  it('is false under Vitest without reading the config', async () => {
    const loadGlobal = vi.fn(globalConfig());
    expect(await isHarnessAutoUpdateEnabled({ loadGlobal, env: { VITEST: 'true' } })).toBe(false);
    expect(loadGlobal).not.toHaveBeenCalled();
  });

  it('is false, with one warning, when the config cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loadGlobal = async () => {
      throw new Error('EACCES');
    };
    expect(await isHarnessAutoUpdateEnabled({ loadGlobal, env: {} })).toBe(false);
    expect(await isHarnessAutoUpdateEnabled({ loadGlobal, env: {} })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('runLaunchUpdate (PAN-5108 D3, D9, D11)', () => {
  beforeEach(() => {
    _resetLaunchUpdateStateForTests();
    _resetUpdateQueueForTests();
  });

  it('returns already-current and never runs the command when the re-check passes', async () => {
    const run = vi.fn(async () => ({ code: 0, output: '' }));

    const outcome = await runLaunchUpdate(ARGV, '/p/bin', async () => true, { run, now: () => 0 });

    expect(outcome).toEqual({ kind: 'already-current' });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the command with the launch timeout and the PATH directory', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'ok' }));

    const outcome = await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => 0 });

    expect(outcome).toEqual({ kind: 'ran', code: 0, output: 'ok' });
    expect(run).toHaveBeenCalledWith(ARGV, { timeoutMs: LAUNCH_UPDATE_TIMEOUT_MS, pathDir: '/p/bin' });
  });

  it('does not rerun a failed command inside the 15-minute cooldown', async () => {
    let now = 0;
    const run = vi.fn(async () => ({ code: 1, output: 'npm ERR! EACCES' }));

    const first = await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });
    now = MINUTE;
    const second = await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });

    expect(first).toEqual({ kind: 'ran', code: 1, output: 'npm ERR! EACCES' });
    expect(second).toEqual({ kind: 'cooldown', error: 'npm ERR! EACCES', failedAt: 0 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reruns the command after the cooldown', async () => {
    let now = 0;
    const run = vi.fn(async () => ({ code: 1, output: 'E404' }));

    await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });
    now = 16 * MINUTE;
    await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('clears the remembered failure after a success', async () => {
    let now = 0;
    const run = vi.fn()
      .mockResolvedValueOnce({ code: 1, output: 'E404' })
      .mockResolvedValueOnce({ code: 0, output: '' })
      .mockResolvedValueOnce({ code: 0, output: '' });

    await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });
    now = 16 * MINUTE;
    await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });
    now = 17 * MINUTE;
    const third = await runLaunchUpdate(ARGV, '/p/bin', async () => false, { run, now: () => now });

    expect(third.kind).toBe('ran');
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('launchUpdateNote (PAN-5108 WI-7)', () => {
  it('names a successful update that still left an old version', () => {
    expect(launchUpdateNote({ kind: 'ran', code: 0, output: '' })).toBe(
      'Overdeck updated Claude Code automatically, but the launch binary still reports an older version.',
    );
  });

  it('names a failed update with the last 300 characters of output', () => {
    const output = `${'x'.repeat(500)} npm ERR! EACCES\n`;
    const note = launchUpdateNote({ kind: 'ran', code: 1, output });
    expect(note.startsWith('Overdeck tried to update Claude Code automatically and it failed: ')).toBe(true);
    expect(note.endsWith('npm ERR! EACCES.')).toBe(true);
    expect(note.length).toBeLessThanOrEqual('Overdeck tried to update Claude Code automatically and it failed: '.length + 301);
  });

  it('falls back to the exit code when the failed update printed nothing', () => {
    expect(launchUpdateNote({ kind: 'ran', code: 7, output: '  ' })).toBe(
      'Overdeck tried to update Claude Code automatically and it failed: exited with code 7.',
    );
  });

  it('names a cooldown with the minutes since the failure', () => {
    expect(launchUpdateNote({ kind: 'cooldown', error: 'E404', failedAt: 0 }, 5 * MINUTE)).toBe(
      "Overdeck's automatic update failed 5 minutes ago and retries after 15 minutes: E404.",
    );
    expect(launchUpdateNote({ kind: 'cooldown', error: 'E404', failedAt: 0 }, 1_000)).toContain('less than a minute ago');
  });
});
