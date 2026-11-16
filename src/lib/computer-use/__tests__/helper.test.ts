import { mkdir, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { runHelper } from '../helper.js';
import { isComputerUseError } from '../errors.js';

function makeDeps(overrides: Partial<Parameters<typeof runHelper>[2]> = {}) {
  return {
    mkdir: vi.fn(mkdir as unknown as typeof mkdir).mockResolvedValue(undefined),
    writeFile: vi.fn(writeFile as unknown as typeof writeFile).mockResolvedValue(undefined),
    rm: vi.fn(rm as unknown as typeof rm).mockResolvedValue(undefined),
    helperPath: () => '/pkg/native/computer-use-linux/runtime.py',
    opsDir: () => '/x/computer-use/ops',
    systemPython: '/usr/bin/python3',
    randomUUID: () => 'fixed-uuid',
    ...overrides,
  };
}

describe('runHelper (PAN-5452)', () => {
  it('writes the op file with mode 0600 under an 0700 dir, then removes it on success (ac1)', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '{"ok":true,"apps":[]}\n', stderr: '' });
    const deps = makeDeps({ execFile });

    const result = await runHelper({ tool: 'list_apps' }, {}, deps);

    expect(result).toEqual({ ok: true, apps: [] });
    expect(deps.mkdir).toHaveBeenCalledWith('/x/computer-use/ops', { recursive: true, mode: 0o700 });
    expect(deps.writeFile).toHaveBeenCalledWith(
      '/x/computer-use/ops/fixed-uuid.json',
      JSON.stringify({ tool: 'list_apps' }),
      { mode: 0o600 },
    );
    expect(deps.rm).toHaveBeenCalledWith('/x/computer-use/ops/fixed-uuid.json', { force: true });
  });

  it('removes the op file even when the helper fails (ac2)', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('boom'));
    const deps = makeDeps({ execFile });

    await expect(runHelper({ tool: 'list_apps' }, {}, deps)).rejects.toThrow();
    expect(deps.rm).toHaveBeenCalledWith('/x/computer-use/ops/fixed-uuid.json', { force: true });
  });

  it('still removes the op file when writeFile creates it and then fails partway (e.g. ENOSPC)', async () => {
    const writeFile = vi.fn().mockRejectedValue(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }));
    const execFile = vi.fn();
    const deps = makeDeps({ writeFile, execFile });

    await expect(runHelper({ tool: 'list_apps' }, {}, deps)).rejects.toThrow('no space left on device');
    expect(execFile).not.toHaveBeenCalled();
    expect(deps.rm).toHaveBeenCalledWith('/x/computer-use/ops/fixed-uuid.json', { force: true });
  });

  it('removes the op file after a timeout', async () => {
    const execFile = vi.fn().mockRejectedValue(Object.assign(new Error('killed'), { killed: true }));
    const deps = makeDeps({ execFile });

    await expect(runHelper({ tool: 'list_apps' }, {}, deps)).rejects.toThrow();
    expect(deps.rm).toHaveBeenCalledWith('/x/computer-use/ops/fixed-uuid.json', { force: true });
  });

  it('parses the last stdout line despite a stderr GLib warning (ac3)', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: '{"ok":true,"apps":[]}',
      stderr: 'dbind-WARNING **: 13:00:00.000: Couldn\'t register with accessibility bus',
    });
    const deps = makeDeps({ execFile });

    const result = await runHelper({ tool: 'list_apps' }, {}, deps);
    expect(result).toEqual({ ok: true, apps: [] });
  });

  it('maps killed: true to helper_timeout (ac4)', async () => {
    const execFile = vi.fn().mockRejectedValue(Object.assign(new Error('killed'), { killed: true }));
    const deps = makeDeps({ execFile });

    const error = await runHelper({ tool: 'list_apps' }, {}, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('helper_timeout');
  });

  it('maps ENOENT to helper_missing_dependency (ac4)', async () => {
    const execFile = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    const deps = makeDeps({ execFile });

    const error = await runHelper({ tool: 'list_apps' }, {}, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('helper_missing_dependency');
  });

  it('maps a non-JSON stdout line to helper_error with trailing stderr', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: 'not json', stderr: 'some diagnostic' });
    const deps = makeDeps({ execFile });

    const error = await runHelper({ tool: 'list_apps' }, {}, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('helper_error');
  });

  it('maps { ok: false, error: "Namespace Atspi not available" } to helper_missing_dependency with the apt fix (ac5)', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: '{"ok":false,"error":"Namespace Atspi not available"}',
      stderr: '',
    });
    const deps = makeDeps({ execFile });

    const error = await runHelper({ tool: 'list_apps' }, {}, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('helper_missing_dependency');
    expect(error.message).toContain('sudo apt install python3-gi gir1.2-atspi-2.0');
  });

  it('maps an unrelated { ok: false, error } to helper_error with the helper message', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: '{"ok":false,"error":"appNotFound(\\"calc\\")"}',
      stderr: '',
    });
    const deps = makeDeps({ execFile });

    const error = await runHelper({ tool: 'list_apps' }, {}, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('helper_error');
    expect(error.message).toContain('appNotFound');
  });

  it('maps a bare exec rejection mentioning Atspi in stderr to helper_missing_dependency', async () => {
    const execFile = vi.fn().mockRejectedValue(
      Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: '',
        stderr: "PyGObject unavailable in interpreter: /usr/bin/python3\nValueError: Namespace Atspi not available",
      }),
    );
    const deps = makeDeps({ execFile });

    const error = await runHelper({ tool: 'list_apps' }, {}, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('helper_missing_dependency');
  });
});
