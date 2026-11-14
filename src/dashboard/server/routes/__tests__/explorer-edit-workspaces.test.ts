/** PAN-5191 WI-F5: GET /api/explorer/edit-workspaces/:workspaceId answers the edit-workspace banner. */
import { Option } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { PanRpcError } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import type { ProjectConfig } from '../../../../lib/projects.js';
import type { WorkspaceRow } from '../../../../lib/workspaces/types.js';
import type { EditWorkspacePrDeps } from '../../services/explorer/edit-workspace-pr.js';
import type { ExplorerRoot } from '../../services/explorer/roots.js';
import { _resetDashboardSessionTokenForTests } from '../dashboard-auth.js';
import { handleEditWorkspaceStatus } from '../explorer-edit-workspaces.js';

const TOKEN = 'explorer-edit-workspaces-internal-token';
const PATH = '/p/workspaces/scratch-edit-1';

function fakeRequest(credential = true) {
  return {
    method: 'GET',
    url: '/api/explorer/edit-workspaces/w1',
    headers: credential ? { [INTERNAL_TOKEN_HEADER]: TOKEN } : {},
    remoteAddress: Option.none(),
  } as unknown as Parameters<typeof handleEditWorkspaceStatus>[0];
}

function deps(branch: string, opts: { missing?: boolean } = {}): EditWorkspacePrDeps {
  const row: WorkspaceRow = {
    id: 'w1', projectId: 'p', kind: 'scratch', name: branch.replace(/^scratch\//, ''), path: PATH, branchName: branch,
    parentBranch: 'main', parentBranchGuessed: false, isGitRepository: true, issueId: null, layoutConfig: null,
    runCommand: null, isFavorite: false, isArchived: false, title: null, createdAt: 1, lastAccessedAt: 1,
  };
  const root: ExplorerRoot = { kind: 'workspace', id: 'workspace:w1', absPath: PATH, writable: true, projectKey: 'p', workspaceId: 'w1', defaultBranch: 'main' };
  return {
    resolveRoot: async (rootId) => {
      if (opts.missing) throw new PanRpcError({ code: 'ROOT_NOT_FOUND', message: `Explorer root ${rootId} not found` });
      return root;
    },
    getWorkspaceById: () => row,
    listProjects: async () => [{ key: 'p', config: { name: 'p', path: '/p', github_repo: 'o/r' } as ProjectConfig }],
    gh: async (args) =>
      args[1] === 'list'
        ? { stdout: JSON.stringify([{ number: 4, url: 'https://github.com/o/r/pull/4', state: 'OPEN' }]) }
        : { stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', headRefOid: 'abc', state: 'OPEN', isDraft: false }) },
    sleep: async () => {},
  };
}

async function call(credential: boolean, d: EditWorkspacePrDeps) {
  const response = HttpServerResponse.toWeb(await handleEditWorkspaceStatus(fakeRequest(credential), 'w1', d));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('handleEditWorkspaceStatus', () => {
  it('answers 401 without a credential', async () => {
    const { status } = await call(false, deps('scratch/edit-1'));
    expect(status).toBe(401);
  });

  it('answers 409 NOT_AN_EDIT_WORKSPACE for a scratch/notes row', async () => {
    const { status, body } = await call(true, deps('scratch/notes'));
    expect(status).toBe(409);
    expect(body.code).toBe('NOT_AN_EDIT_WORKSPACE');
  });

  it('answers 404 ROOT_NOT_FOUND when the root does not resolve', async () => {
    const { status, body } = await call(true, deps('scratch/edit-1', { missing: true }));
    expect(status).toBe(404);
    expect(body.code).toBe('ROOT_NOT_FOUND');
  });

  it('answers 200 with the status body', async () => {
    const { status, body } = await call(true, deps('scratch/edit-1'));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      workspace: { id: 'w1', branch: 'scratch/edit-1', rootId: 'workspace:w1' },
      pr: { number: 4, canMerge: true },
      prSupport: { available: true, reason: null },
    });
  });
});
