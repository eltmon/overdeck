import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HERDR_INSTALL_URL,
  HERDR_MANIFEST_URL,
  compareSemver,
  ensureStableChannel,
  extractSemver,
  fetchLatestStableVersion,
  herdrInstallDir,
  installHerdrBinary,
  readHerdrVersion,
  updateHerdrBinary,
} from '../../../../src/lib/herdr-setup/binary.js';
import { parseHerdrStatus, type HerdrExec } from '../../../../src/lib/herdr-setup/status.js';
import { STATUS_RUNNING_JSON } from './fixtures.js';

const HOME = '/home/op';
const LOCAL_HERDR = '/home/op/.local/bin/herdr';

function ok(stdout = ''): Awaited<ReturnType<HerdrExec>> {
  return { stdout, stderr: '', exitCode: 0 };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('version helpers', () => {
  it('reads the semver out of `herdr --version`', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok('herdr 0.9.1\n'));
    await expect(readHerdrVersion(LOCAL_HERDR, exec)).resolves.toBe('0.9.1');
    expect(exec).toHaveBeenCalledWith(LOCAL_HERDR, ['--version']);
  });

  it('is null when the binary cannot answer', async () => {
    const exec: HerdrExec = async () => { throw new Error('ENOENT'); };
    await expect(readHerdrVersion(LOCAL_HERDR, exec)).resolves.toBeNull();
  });

  it('compares versions numerically', () => {
    expect(compareSemver('0.10.0', '0.9.1')).toBeGreaterThan(0);
    expect(compareSemver('0.9.1', '0.9.1')).toBe(0);
    expect(compareSemver('0.13.9', '0.14.0')).toBeLessThan(0);
    expect(extractSemver('kimi, version 2.0.1')).toBe('2.0.1');
  });

  it('installs into ~/.local/bin', () => {
    expect(herdrInstallDir(HOME)).toBe('/home/op/.local/bin');
  });
});

describe('fetchLatestStableVersion (D5)', () => {
  it('reads `version` from the manifest', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"version":"0.9.1","protocol":22,"endpoint_generation":1}'));
    await expect(fetchLatestStableVersion(fetchImpl as unknown as typeof fetch)).resolves.toBe('0.9.1');
    expect(fetchImpl).toHaveBeenCalledWith(HERDR_MANIFEST_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns null after the 10 s timeout and aborts the request', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    }));
    const pending = fetchLatestStableVersion(fetchImpl as unknown as typeof fetch);
    let settled: string | null | undefined;
    void pending.then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(aborted).toBe(true);
  });

  it('returns null on a network error or a non-OK response', async () => {
    await expect(fetchLatestStableVersion((async () => { throw new Error('offline'); }) as unknown as typeof fetch))
      .resolves.toBeNull();
    await expect(fetchLatestStableVersion((async () => new Response('nope', { status: 503 })) as unknown as typeof fetch))
      .resolves.toBeNull();
  });
});

describe('installHerdrBinary / updateHerdrBinary (D4)', () => {
  it('runs the vendor installer with HERDR_INSTALL_DIR=<home>/.local/bin', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok());
    await expect(installHerdrBinary(exec, HOME)).resolves.toEqual({ binary: LOCAL_HERDR });
    expect(exec).toHaveBeenCalledTimes(1);
    const [file, args, options] = exec.mock.calls[0]!;
    expect(file).toBe('sh');
    expect(args).toEqual(['-c', `curl -fsSL ${HERDR_INSTALL_URL} | sh`]);
    expect(options?.env?.HERDR_INSTALL_DIR).toBe('/home/op/.local/bin');
    expect(options?.timeoutMs).toBe(120_000);
  });

  it('throws with the installer output when it fails', async () => {
    const exec: HerdrExec = async () => ({ stdout: '', stderr: 'curl: (6) Could not resolve host', exitCode: 6 });
    await expect(installHerdrBinary(exec, HOME)).rejects.toThrow(/exited 6: curl: \(6\)/);
  });

  it('updates with `herdr update` and never --handoff', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok());
    await updateHerdrBinary(LOCAL_HERDR, exec);
    expect(exec).toHaveBeenCalledWith(LOCAL_HERDR, ['update'], expect.any(Object));
  });
});

describe('ensureStableChannel (D4)', () => {
  const stable = parseHerdrStatus(STATUS_RUNNING_JSON);
  const preview = parseHerdrStatus(STATUS_RUNNING_JSON.replace('"channel":"stable"', '"channel":"preview"'));

  it('is unmanaged for a brew binary and runs nothing', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok());
    await expect(ensureStableChannel('/opt/homebrew/bin/herdr', preview, exec, HOME)).resolves.toBe('unmanaged');
    expect(exec).not.toHaveBeenCalled();
  });

  it('leaves a stable installer binary alone', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok());
    await expect(ensureStableChannel(LOCAL_HERDR, stable, exec, HOME)).resolves.toBe('stable');
    expect(exec).not.toHaveBeenCalled();
  });

  it('sets the channel to stable only when it is not stable', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok());
    await expect(ensureStableChannel(LOCAL_HERDR, preview, exec, HOME)).resolves.toBe('changed');
    expect(exec).toHaveBeenCalledWith(LOCAL_HERDR, ['channel', 'set', 'stable']);
  });

  it('asks `channel show` when no status is available', async () => {
    const exec = vi.fn<HerdrExec>(async () => ok('stable\n'));
    await expect(ensureStableChannel(LOCAL_HERDR, null, exec, HOME)).resolves.toBe('stable');
    expect(exec).toHaveBeenCalledWith(LOCAL_HERDR, ['channel', 'show']);
  });
});
