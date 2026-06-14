import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/test-panopticon',
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => String(path) !== '/tmp/test-panopticon/cloister.toml'),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { DEFAULT_CLOISTER_CONFIG, loadCloisterConfigSync } from '../config.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

describe('loadCloisterConfig', () => {
  afterEach(() => {
    mockedExistsSync.mockImplementation((path: Parameters<typeof existsSync>[0]) => String(path) !== '/tmp/test-panopticon/cloister.toml');
    mockedReadFileSync.mockReset();
    mockedWriteFileSync.mockReset();
  });

  it('defines conservative close-out defaults', () => {
    expect(DEFAULT_CLOISTER_CONFIG.close_out).toEqual({
      remove_workspace: false,
      delete_feature_branch: false,
      auto: false,
      auto_delay_minutes: 60,
    });
  });

  it('defines stuck-remediation defaults', () => {
    expect(DEFAULT_CLOISTER_CONFIG.stuck_remediation).toEqual({
      enabled: true,
      stage1_minutes: 20,
      stage2_minutes: 45,
      stage3_minutes: 90,
    });
  });

  it('defines orphan-proposed reconciler defaults', () => {
    expect(DEFAULT_CLOISTER_CONFIG.orphanProposedReconciler).toEqual({
      enabled: true,
      minAttemptIntervalMs: 5 * 60 * 1000,
    });
  });

  it('loads stuck-remediation defaults when the config file has no block', () => {
    const config = loadCloisterConfigSync();

    expect(config.stuck_remediation).toEqual({
      enabled: true,
      stage1_minutes: 20,
      stage2_minutes: 45,
      stage3_minutes: 90,
    });
  });

  it('deep-merges a partial stuck-remediation block', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('[stuck_remediation]\nstage1_minutes = 10\n');

    const config = loadCloisterConfigSync();

    expect(config.stuck_remediation).toEqual({
      enabled: true,
      stage1_minutes: 10,
      stage2_minutes: 45,
      stage3_minutes: 90,
    });
  });

});
