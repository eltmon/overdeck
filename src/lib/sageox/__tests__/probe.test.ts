/**
 * PAN-2444 O3: the host contract probe against fake `ox` scripts in a temp dir.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeOxHostContract } from '../probe.js';

let dir: string;

function fakeOx(body: string): string {
  const path = join(dir, 'ox');
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sageox-probe-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('probeOxHostContract', () => {
  it('returns version and commit for a contract binary', async () => {
    const bin = fakeOx(
      `echo '{"contract":"overdeck-host/1","hostManaged":true,"version":"0.19.0","commit":"abc123"}'`,
    );
    expect(await probeOxHostContract({ bin })).toEqual({ ok: true, version: '0.19.0', commit: 'abc123' });
  });

  it('runs ox host-managed with the network off', async () => {
    const bin = fakeOx(
      `echo "{\\"contract\\":\\"overdeck-host/1\\",\\"version\\":\\"$OX_HOST_MANAGED/$OX_HOST_NETWORK\\",\\"commit\\":\\"\\"}"`,
    );
    expect(await probeOxHostContract({ bin })).toEqual({ ok: true, version: '1/off', commit: '' });
  });

  it('reports no-contract when the command is unknown (exit 1)', async () => {
    const bin = fakeOx(`echo 'Error: unknown command "host-contract" for "ox"' >&2; exit 1`);
    expect(await probeOxHostContract({ bin })).toEqual({ ok: false, reason: 'no-contract' });
  });

  it('reports no-contract for a different contract id', async () => {
    const bin = fakeOx(`echo '{"contract":"other/9"}'`);
    expect(await probeOxHostContract({ bin })).toEqual({ ok: false, reason: 'no-contract' });
  });

  it('reports bad-output for malformed JSON', async () => {
    const bin = fakeOx(`echo 'not json {'`);
    expect(await probeOxHostContract({ bin })).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('reports missing when the binary does not exist', async () => {
    expect(await probeOxHostContract({ bin: join(dir, 'no-such-ox') })).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports timeout when the binary hangs past the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const bin = fakeOx('exec sleep 30');
    const result = probeOxHostContract({ bin, timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({ ok: false, reason: 'timeout' });
  });
});
