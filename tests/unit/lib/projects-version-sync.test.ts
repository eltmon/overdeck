import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { TEST_HOME: join(tmpdir(), `projects-version-sync-test-${process.pid}`) };
});

vi.mock('../../../src/lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/lib/paths.js')>('../../../src/lib/paths.js');
  return {
    ...real,
    OVERDECK_HOME: TEST_HOME,
    CONFIG_DIR: TEST_HOME,
  };
});

import {
  PROJECTS_CONFIG_FILE,
  loadProjectsConfigSync,
  saveProjectsConfigSync,
  validateVersionSyncConfig,
  type VersionSyncConfig,
} from '../../../src/lib/projects.js';

const MYN_VERSION_SYNC = {
  set: [
    { path: 'frontend/package.json', json_field: 'version' },
  ],
  command: 'pnpm vsync',
  command_cwd: 'frontend',
  expect: [
    { path: 'frontend/package.json', pattern: '"version": "{version}"' },
    { path: 'api/src/main/java/com/myn/config/Version.java', pattern: 'String version = "{version}\\.git "' },
    { path: 'frontend/ios/App/App/Info.plist', pattern: 'CFBundleShortVersionString</key>\\s*<string>{majorMinor}</string>' },
    { path: 'frontend/android/app/build.gradle', pattern: 'versionName "{majorMinor}"' },
  ],
  push: ['frontend', 'api'],
} satisfies VersionSyncConfig;

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  rmSync(PROJECTS_CONFIG_FILE, { force: true });
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('project version_sync config', () => {
  it('preserves a full version_sync block from projects.yaml', () => {
    saveProjectsConfigSync({
      projects: {
        myn: {
          name: 'Mind Your Now',
          path: '/repo/myn',
          version_sync: MYN_VERSION_SYNC,
        },
      },
    });

    expect(loadProjectsConfigSync().projects.myn?.version_sync).toEqual(MYN_VERSION_SYNC);
  });

  it('leaves version_sync undefined when the key is absent', () => {
    saveProjectsConfigSync({
      projects: {
        app: {
          name: 'App',
          path: '/repo/app',
        },
      },
    });

    expect(loadProjectsConfigSync().projects.app?.version_sync).toBeUndefined();
  });
});

describe('validateVersionSyncConfig', () => {
  it('accepts the full Mind Your Now version sync block', () => {
    expect(validateVersionSyncConfig(MYN_VERSION_SYNC)).toEqual({
      ok: true,
      config: MYN_VERSION_SYNC,
    });
  });

  it('rejects an expect entry with a missing pattern', () => {
    const result = validateVersionSyncConfig({
      expect: [{ path: 'frontend/package.json' }],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.expect[0].pattern must be a non-empty string'],
    });
  });

  it('rejects an expect pattern that does not compile', () => {
    const result = validateVersionSyncConfig({
      expect: [{ path: 'frontend/package.json', pattern: '[' }],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.expect[0].pattern must be a valid regular expression'],
    });
  });

  it('rejects a path that escapes above the project root', () => {
    const result = validateVersionSyncConfig({
      set: [{ path: '../outside/package.json', json_field: 'version' }],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.set[0].path must not escape the project root'],
    });
  });

  it('rejects a command containing a newline', () => {
    const result = validateVersionSyncConfig({ command: 'pnpm vsync\ngit push' });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.command must be a single command line'],
    });
  });
});
