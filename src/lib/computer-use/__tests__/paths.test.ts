import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computerUseDir, helperPath, leasePath, lockPath, opsDir, screenshotDir, snapshotDir, SYSTEM_PYTHON } from '../paths.js';
import { ComputerUseError, isComputerUseError } from '../errors.js';
import { packageRoot } from '../../paths.js';

describe('computer-use paths (PAN-5452)', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = '/x';
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
  });

  it('derives every location from OVERDECK_HOME (ac1)', () => {
    expect(computerUseDir()).toBe('/x/computer-use');
    expect(opsDir()).toBe('/x/computer-use/ops');
    expect(lockPath()).toBe('/x/computer-use/desktop.lock');
    expect(leasePath()).toBe('/x/computer-use/lease.json');
    expect(snapshotDir('holder-a')).toBe('/x/computer-use/snapshots/holder-a');
    expect(screenshotDir()).toBe('/x/computer-use/screenshots');
  });

  it('resolves the helper under packageRoot and the system python (ac2)', () => {
    expect(helperPath()).toBe(`${packageRoot}/native/computer-use-linux/runtime.py`);
    expect(SYSTEM_PYTHON).toBe('/usr/bin/python3');
  });
});

describe('ComputerUseError (PAN-5452)', () => {
  it('carries its code and message and is recognized by the guard (ac3)', () => {
    const error = new ComputerUseError('desktop_busy', 'm');
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('desktop_busy');
    expect(error.message).toBe('m');
  });

  it('a plain Error is not a ComputerUseError', () => {
    expect(isComputerUseError(new Error('nope'))).toBe(false);
  });
});
