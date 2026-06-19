/**
 * Unit tests for registerProjectFromPath (src/lib/project-registration.ts)
 *
 * AC coverage:
 *  - registers a project: getProjectSync returns the minimal {name, path} config
 *  - returns {key, config} on success
 *  - duplicate key throws DuplicateProjectError and does NOT write a second time
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Isolate OVERDECK_HOME so tests don't pollute real state ────────────────
// vi.mock factories are hoisted — define TEST_HOME via vi.hoisted so it's
// available before the factory runs.

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir: t } = require('node:os') as typeof import('node:os');
  return { TEST_HOME: j(t(), `project-reg-test-${process.pid}`) };
});

vi.mock('../../../src/lib/paths.js', async () => {
  const real = await vi.importActual<typeof import('../../../src/lib/paths.js')>('../../../src/lib/paths.js');
  return {
    ...real,
    OVERDECK_HOME: TEST_HOME,
    CONFIG_DIR: TEST_HOME,
  };
});
vi.mock('../../../src/lib/workspace-manager.js', () => ({
  preTrustDirectorySync: vi.fn(),
  preTrustDirectory: vi.fn(),
}));
vi.mock('../../../src/lib/context-layers/index.js', () => ({
  ensureProjectLayer: vi.fn().mockReturnValue(false),
}));

// Import after mocks are set up
import { registerProjectFromPath, DuplicateProjectError } from '../../../src/lib/project-registration.js';
import { getProjectSync, PROJECTS_CONFIG_FILE } from '../../../src/lib/projects.js';

function makeProjectDir(suffix = '') {
  const dir = join(TEST_HOME, `proj-${suffix}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  // Remove projects.yaml so each test starts fresh
  try { rmSync(PROJECTS_CONFIG_FILE); } catch { /* ok if missing */ }
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('registerProjectFromPath', () => {
  it('registers a project and returns { key, config }', async () => {
    const dir = makeProjectDir('basic');
    const result = await registerProjectFromPath({ path: dir });

    expect(result.key).toBe(dir.split('/').pop()!.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    expect(result.config).toMatchObject({ name: expect.any(String), path: dir });

    const stored = getProjectSync(result.key);
    expect(stored).not.toBeNull();
    expect(stored!.path).toBe(dir);
  });

  it('derives the key from the folder basename when name is not provided', async () => {
    const dir = join(TEST_HOME, 'my-cool-project');
    mkdirSync(dir, { recursive: true });

    const result = await registerProjectFromPath({ path: dir });
    expect(result.key).toBe('my-cool-project');
    expect(result.config.name).toBe('my-cool-project');
  });

  it('uses an explicit name when provided', async () => {
    const dir = makeProjectDir('named');
    const result = await registerProjectFromPath({ path: dir, name: 'My Project' });
    expect(result.key).toBe('my-project');
    expect(result.config.name).toBe('My Project');
  });

  it('throws DuplicateProjectError on a second registration with the same key and does NOT write again', async () => {
    const dir1 = join(TEST_HOME, 'dupe-proj');
    const dir2 = join(TEST_HOME, 'dupe-proj-2');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    await registerProjectFromPath({ path: dir1, name: 'dupe-proj' });

    await expect(registerProjectFromPath({ path: dir2, name: 'dupe-proj' })).rejects.toBeInstanceOf(DuplicateProjectError);

    // The stored entry must still point to dir1, not dir2
    const stored = getProjectSync('dupe-proj');
    expect(stored!.path).toBe(dir1);
  });

  it('DuplicateProjectError carries key and existingPath', async () => {
    const dir = join(TEST_HOME, 'err-proj');
    mkdirSync(dir, { recursive: true });
    await registerProjectFromPath({ path: dir, name: 'err-proj' });

    const err = await registerProjectFromPath({ path: dir, name: 'err-proj' }).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateProjectError);
    expect((err as DuplicateProjectError).key).toBe('err-proj');
    expect((err as DuplicateProjectError).existingPath).toBe(dir);
  });
});
