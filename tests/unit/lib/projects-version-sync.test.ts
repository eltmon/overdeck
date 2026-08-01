import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
import { updateProjectsConfigText } from '../../../src/lib/projects-config-write.js';
import { setProjectVersionSync } from '../../../src/lib/projects-writer.js';

const MYN_VERSION_SYNC = {
  set: [
    { path: 'frontend/package.json', json_field: 'version' },
  ],
  replace: [
    {
      path: 'api/src/main/java/com/myn/config/Version.java',
      pattern: 'String version = "(?<version>\\d+\\.\\d+\\.\\d+)\\.git "',
      value: '{version}',
    },
    {
      path: 'frontend/ios/App/App/Info.plist',
      pattern: 'CFBundleShortVersionString</key>\\s*<string>(?<version>\\d+\\.\\d+)</string>',
      value: '{majorMinor}',
    },
    {
      path: 'frontend/android/app/build.gradle',
      pattern: 'versionName "(?<version>\\d+\\.\\d+)"',
      value: '{majorMinor}',
    },
  ],
  command: 'pnpm vsync',
  command_cwd: 'frontend',
  command_image: 'myn-version-sync:latest',
  expect: [
    { path: 'frontend/package.json', pattern: '"version": "{version}"' },
    { path: 'api/src/main/java/com/myn/config/Version.java', pattern: 'String version = "{version}\\.git "' },
    { path: 'frontend/ios/App/App/Info.plist', pattern: 'CFBundleShortVersionString</key>\\s*<string>{majorMinor}</string>' },
    { path: 'frontend/android/app/build.gradle', pattern: 'versionName "{majorMinor}"' },
  ],
  push: ['frontend', 'api'],
} satisfies VersionSyncConfig;

const COMMENT_VERSION_SYNC = {
  expect: [{ path: 'package.json', pattern: 'version' }],
  push: ['.'],
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

describe('setProjectVersionSync', () => {
  it('sets and clears one project without changing any surrounding YAML bytes', async () => {
    const fixture = `# operator-owned registry\nprojects:\n  alpha:\n    name: "Alpha App" # quoted on purpose\n    path: '/repo/alpha'\n  beta:\n    name: Beta\n    path: /repo/beta\n# trailing operator note\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await setProjectVersionSync('alpha', MYN_VERSION_SYNC);
    const configured = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');
    expect(configured).toContain('version_sync:');
    expect(configured).toContain('# operator-owned registry');
    expect(configured).toContain('name: "Alpha App" # quoted on purpose');
    expect(configured).toContain("path: '/repo/alpha'");
    expect(configured).toContain('# trailing operator note');

    await setProjectVersionSync('alpha', null);
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
  });

  it.each([
    {
      label: 'four-space project indentation',
      fixture: `projects:\n    alpha:\n        name: Alpha\n        path: /repo/alpha\n    beta:\n        name: Beta\n        path: /repo/beta\n`,
    },
    {
      label: 'three-space project indentation',
      fixture: `projects:\n   alpha:\n      name: Alpha\n      path: /repo/alpha\n   beta:\n      name: Beta\n      path: /repo/beta\n`,
    },
  ])('derives indentation for $label and restores the original bytes', async ({ fixture }) => {
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await setProjectVersionSync('alpha', MYN_VERSION_SYNC);
    const parsed = loadProjectsConfigSync();
    expect(parsed.projects.alpha?.version_sync).toEqual(MYN_VERSION_SYNC);
    expect(parsed.projects.version_sync).toBeUndefined();

    await setProjectVersionSync('alpha', null);
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
  });

  it('inserts after a last project with no trailing newline and clears byte-exactly', async () => {
    const fixture = 'projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha';
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await setProjectVersionSync('alpha', MYN_VERSION_SYNC);
    expect(loadProjectsConfigSync().projects.alpha?.version_sync).toEqual(MYN_VERSION_SYNC);

    await setProjectVersionSync('alpha', null);
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
  });

  it('preserves an attached trailing comment while updating and removing the block', async () => {
    const fixture = `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n    version_sync:\n      expect:\n        - path: package.json\n          pattern: version\n      push:\n        - .\n      # keep this operator note\n    auto_merge_default: hold\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await setProjectVersionSync('alpha', COMMENT_VERSION_SYNC);
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);

    await setProjectVersionSync('alpha', null);
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(
      `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n      # keep this operator note\n    auto_merge_default: hold\n`,
    );
  });

  it('rejects updates and removal when an inline comment inside the block cannot be preserved', async () => {
    const fixture = `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n    version_sync:\n      expect:\n        - path: package.json\n          pattern: version\n      push:\n        - . # keep inline\n    auto_merge_default: hold\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await expect(setProjectVersionSync('alpha', COMMENT_VERSION_SYNC)).rejects.toThrow(
      'Project alpha has comments inside version_sync; edit projects.yaml directly to preserve them',
    );
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);

    await expect(setProjectVersionSync('alpha', null)).rejects.toThrow(
      'Project alpha has comments inside version_sync; edit projects.yaml directly to preserve them',
    );
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
  });

  it('rejects a block containing multiple standalone and inline comments without changing any bytes', async () => {
    const fixture = `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n    version_sync: # block warning\n      # before expectations\n      expect:\n        - path: package.json # manifest note\n          pattern: version\n      # before push\n      push:\n        - . # repository note\n    auto_merge_default: hold\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await expect(setProjectVersionSync('alpha', COMMENT_VERSION_SYNC)).rejects.toThrow(
      'Project alpha has comments inside version_sync; edit projects.yaml directly to preserve them',
    );
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);

    await expect(setProjectVersionSync('alpha', null)).rejects.toThrow(
      'Project alpha has comments inside version_sync; edit projects.yaml directly to preserve them',
    );
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
  });

  it('serializes concurrent version_sync updates and leaves no lock or temporary files', async () => {
    writeFileSync(
      PROJECTS_CONFIG_FILE,
      `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n  beta:\n    name: Beta\n    path: /repo/beta\n`,
      'utf-8',
    );

    await Promise.all([
      setProjectVersionSync('alpha', COMMENT_VERSION_SYNC),
      setProjectVersionSync('beta', COMMENT_VERSION_SYNC),
    ]);

    const parsed = loadProjectsConfigSync();
    expect(parsed.projects.alpha?.version_sync).toEqual(COMMENT_VERSION_SYNC);
    expect(parsed.projects.beta?.version_sync).toEqual(COMMENT_VERSION_SYNC);
    expect(readdirSync(TEST_HOME).sort()).toEqual(['projects.yaml', 'projects.yaml.lock']);
  });

  it('holds the lock across read and transform so a queued save reads the renamed project', async () => {
    writeFileSync(
      PROJECTS_CONFIG_FILE,
      `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n`,
      'utf-8',
    );
    let transformStarted!: () => void;
    const started = new Promise<void>(resolve => {
      transformStarted = resolve;
    });
    let releaseTransform!: () => void;
    const blocked = new Promise<void>(resolve => {
      releaseTransform = resolve;
    });

    const rename = updateProjectsConfigText(PROJECTS_CONFIG_FILE, 'projects: {}\n', async content => {
      transformStarted();
      await blocked;
      return { content: content.replace('name: Alpha', 'name: Renamed Alpha'), result: undefined };
    });
    await started;
    let versionSaveFinished = false;
    const versionSave = setProjectVersionSync('alpha', COMMENT_VERSION_SYNC).then(() => {
      versionSaveFinished = true;
    });
    await Promise.resolve();
    expect(versionSaveFinished).toBe(false);

    releaseTransform();
    await Promise.all([rename, versionSave]);

    const parsed = loadProjectsConfigSync();
    expect(parsed.projects.alpha?.name).toBe('Renamed Alpha');
    expect(parsed.projects.alpha?.version_sync).toEqual(COMMENT_VERSION_SYNC);
  });

  it('releases the in-process queue after directory setup fails', async () => {
    const fixture = `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');
    const notDirectory = join(TEST_HOME, 'not-a-directory');
    writeFileSync(notDirectory, 'file', 'utf-8');

    await expect(updateProjectsConfigText(
      join(notDirectory, 'projects.yaml'),
      'projects: {}\n',
      content => ({ content, result: undefined }),
    )).rejects.toBeDefined();

    await setProjectVersionSync('alpha', COMMENT_VERSION_SYNC);
    expect(loadProjectsConfigSync().projects.alpha?.version_sync).toEqual(COMMENT_VERSION_SYNC);
  });

  it('leaves the durable registry intact when another process owns the kernel lock', () => {
    const fixture = `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');
    const lock = `${PROJECTS_CONFIG_FILE}.lock`;
    const fd = openSync(lock, 'a+', 0o600);
    const acquired = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] });
    expect(acquired.status).toBe(0);

    try {
      expect(() => saveProjectsConfigSync({
        projects: { beta: { name: 'Beta', path: '/repo/beta' } },
      })).toThrow('projects.yaml is already being modified');
      expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
    } finally {
      closeSync(fd);
    }
  });

  it('allows only one external contender and releases the lock when its owner exits', () => {
    const lock = `${PROJECTS_CONFIG_FILE}.lock`;
    const fd = openSync(lock, 'a+', 0o600);
    expect(spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] }).status).toBe(0);

    const contenderA = spawnSync('flock', ['-n', lock, 'true']);
    const contenderB = spawnSync('flock', ['-n', lock, 'true']);
    expect(contenderA.status).toBe(1);
    expect(contenderB.status).toBe(1);

    closeSync(fd);
    expect(spawnSync('flock', ['-n', lock, 'true']).status).toBe(0);
  });

  it('recovers automatically after a lock-owning process is killed', async () => {
    const fixture = `projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n`;
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');
    const lock = `${PROJECTS_CONFIG_FILE}.lock`;
    const killed = spawnSync('flock', [lock, 'sh', '-c', 'kill -9 $$']);
    expect(killed.status).not.toBe(0);

    await setProjectVersionSync('alpha', COMMENT_VERSION_SYNC);

    expect(loadProjectsConfigSync().projects.alpha?.version_sync).toEqual(COMMENT_VERSION_SYNC);
    expect(readdirSync(TEST_HOME).sort()).toEqual(['projects.yaml', 'projects.yaml.lock']);
  });

  it('rejects a flow-style project without changing the file', async () => {
    const fixture = 'projects:\n  alpha: { name: Alpha, path: /repo/alpha }\n';
    writeFileSync(PROJECTS_CONFIG_FILE, fixture, 'utf-8');

    await expect(setProjectVersionSync('alpha', MYN_VERSION_SYNC)).rejects.toThrow(
      'Project alpha uses flow-style YAML; version_sync requires a block mapping',
    );
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(fixture);
  });

  it('rejects an unknown project key and names the known keys', async () => {
    writeFileSync(PROJECTS_CONFIG_FILE, 'projects:\n  alpha:\n    name: Alpha\n    path: /repo/alpha\n', 'utf-8');

    await expect(setProjectVersionSync('missing', MYN_VERSION_SYNC)).rejects.toThrow(
      'Unknown project key: missing. Known project keys: alpha',
    );
  });
});

describe('validateVersionSyncConfig', () => {
  it('accepts the full Mind Your Now version sync block', () => {
    expect(validateVersionSyncConfig(MYN_VERSION_SYNC)).toEqual({
      ok: true,
      config: MYN_VERSION_SYNC,
    });
  });

  it.each([
    [{}, [
      'version_sync.expect must contain at least one entry',
      'version_sync.push must contain at least one repository',
    ]],
    [{ expect: [], push: [] }, [
      'version_sync.expect must contain at least one entry',
      'version_sync.push must contain at least one repository',
    ]],
    [{ expect: [{ path: 'package.json', pattern: '"version"' }] }, [
      'version_sync.push must contain at least one repository',
    ]],
  ])('rejects a no-op operational shape %#', (config, errors) => {
    expect(validateVersionSyncConfig(config)).toEqual({ ok: false, errors });
  });

  it('requires each generated-text replacement to name its exact version capture', () => {
    const result = validateVersionSyncConfig({
      command: 'sync-version',
      command_image: 'version-sync:latest',
      replace: [{ path: 'build.gradle', pattern: 'versionName "\\d+\\.\\d+"', value: '{majorMinor}' }],
      expect: [{ path: 'build.gradle', pattern: 'versionName "{majorMinor}"' }],
      push: ['.'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.replace[0].pattern must contain exactly one named capture (?<version>...)'],
    });
  });

  it('rejects a generated-text replacement without an allowed version value', () => {
    const result = validateVersionSyncConfig({
      command: 'sync-version',
      command_image: 'version-sync:latest',
      replace: [{ path: 'build.gradle', pattern: 'versionName "(?<version>\\d+\\.\\d+)"', value: '{buildNumber}' }],
      expect: [{ path: 'build.gradle', pattern: 'versionName "{majorMinor}"' }],
      push: ['.'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.replace[0].value must be {version} or {majorMinor}'],
    });
  });

  it('rejects an expect entry with a missing pattern', () => {
    const result = validateVersionSyncConfig({
      expect: [{ path: 'frontend/package.json' }],
      push: ['frontend'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.expect[0].pattern must be a non-empty string'],
    });
  });

  it('rejects an expect pattern that does not compile', () => {
    const result = validateVersionSyncConfig({
      expect: [{ path: 'frontend/package.json', pattern: '[' }],
      push: ['frontend'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.expect[0].pattern must be a valid regular expression'],
    });
  });

  it('rejects an expectation pattern longer than the bounded evaluator accepts', () => {
    const result = validateVersionSyncConfig({
      expect: [{ path: 'frontend/package.json', pattern: 'a'.repeat(513) }],
      push: ['frontend'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.expect[0].pattern must be at most 512 characters'],
    });
  });

  it('rejects a path that escapes above the project root', () => {
    const result = validateVersionSyncConfig({
      set: [{ path: '../outside/package.json', json_field: 'version' }],
      expect: [{ path: 'package.json', pattern: '"version"' }],
      push: ['.'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.set[0].path must not escape the project root'],
    });
  });

  it('requires a sandbox image for a configured command', () => {
    const result = validateVersionSyncConfig({
      command: 'pnpm vsync',
      expect: [{ path: 'package.json', pattern: '"version"' }],
      push: ['.'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.command_image is required when version_sync.command is set'],
    });
  });

  it('rejects a command containing a newline', () => {
    const result = validateVersionSyncConfig({
      command: 'pnpm vsync\ngit push',
      expect: [{ path: 'package.json', pattern: '"version"' }],
      push: ['.'],
    });

    expect(result).toEqual({
      ok: false,
      errors: ['version_sync.command must be a single command line'],
    });
  });
});
