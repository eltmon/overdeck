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
import {
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardSessionCookieHeader,
} from '../dashboard-auth.js';
import { handleEditWorkspaceChanges, handleEditWorkspaceCreatePr, handleEditWorkspaceDiscard, handleEditWorkspaceStatus } from '../explorer-edit-workspaces.js';

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
    id: 'w1', projectId: 'p', kind: 'scratch', origin: 'operator', name: branch.replace(/^scratch\//, ''), path: PATH, branchName: branch,
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

describe('handleEditWorkspaceChanges (PAN-5290)', () => {
  async function changes(credential: boolean, d: EditWorkspacePrDeps) {
    const response = HttpServerResponse.toWeb(await handleEditWorkspaceChanges(fakeRequest(credential), 'w1', d));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('answers 401 without a credential', async () => {
    expect((await changes(false, deps('scratch/edit-1'))).status).toBe(401);
  });

  it('answers 404 ROOT_NOT_FOUND when the root does not resolve and 409 for a non-edit row', async () => {
    const missing = await changes(true, deps('scratch/edit-1', { missing: true }));
    expect(missing).toMatchObject({ status: 404, body: { code: 'ROOT_NOT_FOUND' } });
    const notEdit = await changes(true, deps('scratch/notes'));
    expect(notEdit).toMatchObject({ status: 409, body: { code: 'NOT_AN_EDIT_WORKSPACE' } });
  });

  it('answers 200 with what will land', async () => {
    const runGit: NonNullable<EditWorkspacePrDeps['runGit']> = async (_cwd, args) => {
      const out = (text: string) => ({ code: 0, stdout: Buffer.from(text), stderr: '', timedOut: false, truncated: false });
      if (args[0] === 'merge-base') return out('base-sha\n');
      if (args[0] === 'diff' && args[1] === '--numstat') return out('2\t1\tREADME.md\0');
      if (args[0] === 'diff') return out('M\0README.md\0');
      if (args[0] === 'status') return out('1 .M N... 100644 100644 100644 a b README.md\0');
      return out('');
    };
    const { status, body } = await changes(true, { ...deps('scratch/edit-1'), runGit });
    expect(status).toBe(200);
    expect(body).toEqual({
      base: 'base-sha',
      files: [{ path: 'README.md', status: 'M', additions: 2, deletions: 1, binary: false }],
      additions: 2,
      deletions: 1,
      uncommittedPaths: ['README.md'],
    });
  });
});

describe('handleEditWorkspaceCreatePr', () => {
  function postRequest(headers: Record<string, string>) {
    return {
      method: 'POST',
      url: '/api/explorer/edit-workspaces/w1/pr',
      headers: { 'content-type': 'application/json', ...headers },
      remoteAddress: Option.none(),
    } as unknown as Parameters<typeof handleEditWorkspaceCreatePr>[0];
  }

  const prDeps = (): EditWorkspacePrDeps => ({
    ...deps('scratch/edit-1'),
    gh: async (args) => (args[1] === 'list' ? { stdout: '[]' } : { stdout: 'https://github.com/o/r/pull/12\n' }),
    commitAll: async () => ({ committed: true }),
    pushHead: async () => {},
  });

  async function post(body: unknown, headers: Record<string, string> = { [INTERNAL_TOKEN_HEADER]: TOKEN }) {
    const response = HttpServerResponse.toWeb(
      await handleEditWorkspaceCreatePr(postRequest(headers), 'w1', async () => body, prDeps()),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('answers 400 INVALID_INPUT for an empty title', async () => {
    const { status, body } = await post({ mode: 'direct', title: '   ', body: '', draft: false });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('answers 400 INVALID_INPUT for an unknown mode', async () => {
    const { status, body } = await post({ mode: 'sideways', title: 't', body: '', draft: false });
    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('answers 403 without the CSRF header on a cookie request', async () => {
    const cookie = dashboardSessionCookieHeader().split(';')[0] ?? `${DASHBOARD_SESSION_COOKIE}=`;
    const { status } = await post({ mode: 'direct', title: 't', body: '', draft: false }, { cookie, origin: 'http://localhost:3011' });
    expect(status).toBe(403);
  });

  it('answers 201 with the direct PR result', async () => {
    const { status, body } = await post({ mode: 'direct', title: 'chore: edit a', body: 'b', draft: false });
    expect(status).toBe(201);
    expect(body).toEqual({ mode: 'direct', url: 'https://github.com/o/r/pull/12', number: 12, created: true });
  });
});

describe('handleEditWorkspaceDiscard', () => {
  it('answers 400 INVALID_INPUT for { closePr: "yes" }', async () => {
    const request = {
      method: 'POST',
      url: '/api/explorer/edit-workspaces/w1/discard',
      headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: TOKEN },
      remoteAddress: Option.none(),
    } as unknown as Parameters<typeof handleEditWorkspaceDiscard>[0];
    const removeEditWorkspace = async () => {
      throw new Error('must not remove');
    };
    const response = HttpServerResponse.toWeb(
      await handleEditWorkspaceDiscard(request, 'w1', async () => ({ closePr: 'yes' }), {
        ...deps('scratch/edit-1'),
        removeEditWorkspace,
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe('INVALID_INPUT');
  });
});
