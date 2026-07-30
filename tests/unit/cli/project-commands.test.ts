import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

const { mockGetProjectSync } = vi.hoisted(() => ({ mockGetProjectSync: vi.fn() }));

vi.mock('../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/projects.js')>('../../../src/lib/projects.js');
  return { ...actual, getProjectSync: mockGetProjectSync };
});

import { projectAddTargetCommand } from '../../../src/cli/commands/project.js';
import { getProjectByKey, listProjectTargets } from '../../../src/lib/workspaces/resolver.js';

let odb: OverdeckTestDb;
let projectRoot: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-project-target-'));
  mockGetProjectSync.mockReset();
  mockGetProjectSync.mockReturnValue({ name: 'Test Project', path: projectRoot });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('pan project add-target (PAN-1990)', () => {
  it('creates a project_targets row for the project', async () => {
    await projectAddTargetCommand('test-project', { path: '/repo/secondary' });

    expect(getProjectByKey('test-project')?.primaryPath).toBe(projectRoot);
    const targets = listProjectTargets('test-project');
    expect(targets).toHaveLength(1);
    expect(targets[0].path).toBe('/repo/secondary');
    expect(targets[0].isPrimary).toBe(false);
  });

  it('--primary demotes the previous primary so exactly one primary row remains', async () => {
    await projectAddTargetCommand('test-project', { path: '/repo/first', primary: true });
    await projectAddTargetCommand('test-project', { path: '/repo/second', primary: true });

    const targets = listProjectTargets('test-project');
    expect(targets.filter((t) => t.isPrimary)).toHaveLength(1);
    expect(targets.find((t) => t.isPrimary)?.path).toBe('/repo/second');
  });

  it('exits 1 for an unregistered project key', async () => {
    mockGetProjectSync.mockReturnValue(null);
    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(projectAddTargetCommand('missing-project', { path: '/repo/x' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
