import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MACOS_APP_CLI,
  TAILSCALE_READ_TIMEOUT_MS,
  resolveTailscaleCli,
  runTailscale,
  type TailscaleCli,
} from '../../../../src/lib/tailscale/cli.js';

const HOME = '/fake/overdeck-home';
const USERSPACE_BIN = `${HOME}/tailscale/bin/tailscale`;
const SOCKET = `${HOME}/tailscale/tailscaled.sock`;

function accessFor(executables: string[]) {
  return async (path: string) => {
    if (!executables.includes(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
}

describe('resolveTailscaleCli', () => {
  const originalHome = process.env.OVERDECK_HOME;
  beforeEach(() => {
    process.env.OVERDECK_HOME = HOME;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
  });

  it('prefers the Overdeck userspace install over tailscale on PATH', async () => {
    const cli = await resolveTailscaleCli({
      access: accessFor([USERSPACE_BIN, '/usr/bin/tailscale']),
      platform: 'linux',
      pathEnv: '/usr/local/bin:/usr/bin',
    });
    expect(cli).toEqual({ bin: USERSPACE_BIN, mode: 'userspace', baseArgs: [`--socket=${SOCKET}`] });
  });

  it('finds tailscale on PATH as system mode', async () => {
    const cli = await resolveTailscaleCli({
      access: accessFor(['/usr/bin/tailscale']),
      platform: 'linux',
      pathEnv: '/usr/local/bin:/usr/bin',
    });
    expect(cli).toEqual({ bin: '/usr/bin/tailscale', mode: 'system', baseArgs: [] });
  });

  it('falls back to the macOS app binary', async () => {
    const cli = await resolveTailscaleCli({ access: accessFor([MACOS_APP_CLI]), platform: 'darwin', pathEnv: '/usr/bin' });
    expect(cli).toEqual({ bin: MACOS_APP_CLI, mode: 'app', baseArgs: [] });
  });

  it('ignores the macOS app path on other platforms and returns null when nothing is found', async () => {
    expect(await resolveTailscaleCli({ access: accessFor([MACOS_APP_CLI]), platform: 'linux', pathEnv: '/usr/bin' })).toBeNull();
    expect(await resolveTailscaleCli({ access: accessFor([]), platform: 'darwin', pathEnv: '' })).toBeNull();
  });
});

describe('runTailscale', () => {
  const cli: TailscaleCli = { bin: '/usr/bin/tailscale', mode: 'userspace', baseArgs: ['--socket=/s.sock'] };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prepends baseArgs and returns stdout on success', async () => {
    const exec = vi.fn(async () => ({ stdout: '1.104.4\n', stderr: '' }));
    const result = await runTailscale(cli, ['version'], { execFile: exec });
    expect(exec).toHaveBeenCalledWith('/usr/bin/tailscale', ['--socket=/s.sock', 'version'], expect.objectContaining({ encoding: 'utf8' }));
    expect(result).toEqual({ ok: true, code: 0, stdout: '1.104.4\n', stderr: '', timedOut: false });
  });

  it('returns ok false with the exit code and output for a non-zero exit', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), { code: 1, stdout: 'partial', stderr: 'failed to connect to local tailscaled' });
    });
    const result = await runTailscale(cli, ['status', '--json'], { execFile: exec });
    expect(result).toEqual({ ok: false, code: 1, stdout: 'partial', stderr: 'failed to connect to local tailscaled', timedOut: false });
  });

  it('returns ok false with a null code when the binary is missing', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
    });
    const result = await runTailscale(cli, ['version'], { execFile: exec });
    expect(result.ok).toBe(false);
    expect(result.code).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('aborts a child that never exits after the read timeout', async () => {
    vi.useFakeTimers();
    const exec = vi.fn((_file: string, _args: string[], options: { signal: AbortSignal }) =>
      new Promise<{ stdout: string; stderr: string }>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
        });
      }));
    let settled = false;
    const pending = runTailscale(cli, ['status', '--json'], { execFile: exec }).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(TAILSCALE_READ_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ ok: false, timedOut: true, code: null });
  });
});
