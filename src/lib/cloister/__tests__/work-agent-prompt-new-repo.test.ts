import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const findProjectByTeamSync = vi.hoisted(() => vi.fn());

vi.mock('../../projects.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../projects.js')>(),
  findProjectByTeamSync,
}));

import { buildPolyrepoContext } from '../work-agent-prompt.js';

let workspace = '';

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = '';
  vi.clearAllMocks();
});

describe('polyrepo new-repository guidance', () => {
  it('warns non-progressive work agents to register a new deliverable repo first', () => {
    workspace = mkdtempSync(join(tmpdir(), 'overdeck-polyrepo-prompt-'));
    mkdirSync(join(workspace, 'api'));
    findProjectByTeamSync.mockReturnValue({
      name: 'Mind Your Now',
      path: '/project',
      issue_prefix: 'MIN',
      workspace: {
        type: 'polyrepo',
        workspaces_dir: 'workspaces',
        repos: [{ name: 'api', path: 'api', branch_prefix: 'feature/' }],
      },
    });

    const context = buildPolyrepoContext('MIN-850', workspace);

    expect(context).toContain('## Creating a New Deliverable Repository');
    expect(context).toContain('pan workspace add-repo min-850 --new <git-url>');
    expect(context).toContain('Do not clone an unregistered repo into the workspace');
  });
});
