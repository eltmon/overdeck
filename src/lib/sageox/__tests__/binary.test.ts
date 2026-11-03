/**
 * PAN-4852 WI-6: the built `ox` resolves from the sageox pack's trusted
 * commit, and only when that commit's build is ready.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sageox-binary-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { OX_BUILD_MARKER } from '../../skill-packs/ox-build.js';
import type { PackRegistryEntry } from '../../skill-packs/sources.js';
import { resolveOxBinary } from '../binary.js';

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const entry = (commit: string): PackRegistryEntry => ({
  id: 'sageox',
  url: 'https://github.com/eltmon/ox',
  ref: commit,
  commit,
  adapter: 'plain',
});

function writeReadyBuild(commit: string): string {
  const binDir = join(overdeckHome, 'packs', 'sageox', commit, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'ox'), '#!/bin/sh\n');
  chmodSync(join(binDir, 'ox'), 0o755);
  writeFileSync(join(binDir, OX_BUILD_MARKER), JSON.stringify({ version: 1, commit }));
  return binDir;
}

describe('resolveOxBinary', () => {
  it('returns the absolute built ox when the pack is registered and its build is ready', async () => {
    const binDir = writeReadyBuild(COMMIT);
    const getPack = vi.fn(async () => entry(COMMIT));

    const result = await resolveOxBinary({ getPack });

    expect(getPack).toHaveBeenCalledWith('sageox');
    expect(result).toEqual({ ok: true, bin: join(binDir, 'ox'), binDir, commit: COMMIT });
    if (result.ok) expect(isAbsolute(result.bin)).toBe(true);
  });

  it('checks readiness against the trusted commit extraction', async () => {
    const isReady = vi.fn(async () => true);

    await resolveOxBinary({ getPack: async () => entry(OTHER), isReady });

    expect(isReady).toHaveBeenCalledWith(join(overdeckHome, 'packs', 'sageox', OTHER), OTHER);
  });

  it('is not-built when the registered commit has no ready build', async () => {
    const result = await resolveOxBinary({ getPack: async () => entry(OTHER) });

    expect(result).toEqual({
      ok: false,
      reason: 'not-built',
      commit: OTHER,
      message: 'ox is not built for the sageox pack (bbbbbbb); run pan skills pack sync sageox',
    });
  });

  it('is not-registered when the sageox pack has no registry entry', async () => {
    const isReady = vi.fn(async () => true);

    const result = await resolveOxBinary({ getPack: async () => null, isReady });

    expect(result).toEqual({
      ok: false,
      reason: 'not-registered',
      message: 'the sageox pack is not registered; add it with: pan skills pack add sageox',
    });
    expect(isReady).not.toHaveBeenCalled();
  });
});
