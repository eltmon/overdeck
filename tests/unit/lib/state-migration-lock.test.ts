import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireStateMigrationLock,
  isStateMigrationLocked,
  stateMigrationLockPath,
} from '../../../src/lib/state-migration-lock.js';

describe('state migration lock', () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'overdeck-state-lock-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
  });

  it('reports unlocked in a fresh home and detects an acquired lock', () => {
    const path = stateMigrationLockPath('fixture');
    expect(existsSync(path)).toBe(false);
    expect(isStateMigrationLocked('fixture')).toBe(false);
    expect(existsSync(path)).toBe(false);

    const release = acquireStateMigrationLock('fixture');
    expect(isStateMigrationLocked('fixture')).toBe(true);
    release();
    expect(isStateMigrationLocked('fixture')).toBe(false);
  });
});
