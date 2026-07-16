import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require('node:os') as typeof import('node:os');
  return { TEST_HOME: join(tmpdir(), `project-rename-test-${process.pid}`) };
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
  getProjectSync,
  PROJECTS_CONFIG_FILE,
  registerProjectSync,
  renameProjectSync,
  type ProjectConfig,
} from '../../../src/lib/projects.js';

const PROJECT: ProjectConfig = {
  name: 'Original Name',
  path: '/projects/original',
  issue_prefix: 'ORIG',
  workspace: {
    type: 'monorepo',
    workspaces_dir: 'workspaces',
    default_branch: 'main',
  },
};

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  rmSync(PROJECTS_CONFIG_FILE, { force: true });
  registerProjectSync('original-key', PROJECT);
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('renameProjectSync', () => {
  it('persists the trimmed name and preserves all other project fields', () => {
    renameProjectSync('original-key', '  Renamed Project  ');

    expect(getProjectSync('original-key')).toEqual({
      ...PROJECT,
      name: 'Renamed Project',
    });
  });

  it('throws for an unknown project without modifying projects.yaml', () => {
    const before = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');

    expect(() => renameProjectSync('missing', 'New Name')).toThrow('Unknown project: missing');
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(before);
  });

  it('throws for an empty or whitespace-only name without modifying projects.yaml', () => {
    const before = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');

    expect(() => renameProjectSync('original-key', '   ')).toThrow('Project name must not be empty');
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(before);
  });

  it("rejects a case-insensitive collision with another project's name", () => {
    registerProjectSync('other-key', {
      name: 'Existing Project',
      path: '/projects/other',
    });

    expect(() => renameProjectSync('original-key', 'existing project')).toThrow(
      "Project name 'existing project' conflicts with existing project 'other-key'",
    );
  });

  it("rejects a case-insensitive collision with another project's key", () => {
    registerProjectSync('existing-key', {
      name: 'Unrelated Name',
      path: '/projects/other',
    });

    expect(() => renameProjectSync('original-key', 'EXISTING-KEY')).toThrow(
      "Project name 'EXISTING-KEY' conflicts with existing project 'existing-key'",
    );
  });

  it('returns without modifying projects.yaml when the name is unchanged', () => {
    const before = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');

    expect(() => renameProjectSync('original-key', 'Original Name')).not.toThrow();
    expect(readFileSync(PROJECTS_CONFIG_FILE, 'utf-8')).toBe(before);
  });
});
