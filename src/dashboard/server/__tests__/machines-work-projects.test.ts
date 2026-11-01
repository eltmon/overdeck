/** PAN-4651 WI-19 (D-4651-14): Add this project there — the owner door and the viewer's sender. */
import { describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { handleWorkProject, readJsonResponse } from '../routes/machines-work.js';
import { type AddProjectRequest, addProjectThere } from '../services/fleet-add-project.js';

const machine = (access: 'operator' | 'agent-fenced', actor: 'operator' | { agentId: string }): DashboardCredential => ({
  kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES(access), actor, access,
});

const BODY = {
  gitOrigin: 'github.com/eltmon/overdeck', cloneUrl: 'https://github.com/eltmon/overdeck.git', name: 'Overdeck', issuePrefix: 'PAN',
  files: [{ path: '.env', contentBase64: Buffer.from('TOKEN=abc\n').toString('base64') }, { path: 'apps/web/.dev.vars', contentBase64: Buffer.from('X=1').toString('base64') }],
};

describe('POST /api/machines/work/projects (D-4651-14)', () => {
  it('ac19: the operator on an operator-level link clones and writes the files', async () => {
    const start = vi.fn(async (_request: AddProjectRequest) => ({ ok: true as const, jobId: 'add-7' }));
    const answer = readJsonResponse(await handleWorkProject(machine('operator', 'operator'), BODY, { start }));
    expect(answer).toEqual({ status: 202, body: { jobId: 'add-7' } });
    expect(start).toHaveBeenCalledWith({
      cloneUrl: 'https://github.com/eltmon/overdeck.git', name: 'Overdeck', issuePrefix: 'PAN',
      files: [{ path: '.env', contents: Buffer.from('TOKEN=abc\n') }, { path: 'apps/web/.dev.vars', contents: Buffer.from('X=1') }],
    });
  });

  it('ac19: an agent actor and an agent-fenced link get 403 project-files-forbidden; a non-machine credential machine-only', async () => {
    const start = vi.fn();
    expect(readJsonResponse(await handleWorkProject(machine('operator', { agentId: 'agent-pan-7' }), BODY, { start }))).toMatchObject({ status: 403, body: { code: 'project-files-forbidden' } });
    expect(readJsonResponse(await handleWorkProject(machine('agent-fenced', 'operator'), BODY, { start }))).toMatchObject({ status: 403, body: { code: 'project-files-forbidden' } });
    expect(readJsonResponse(await handleWorkProject({ kind: 'root-session' }, BODY, { start }))).toMatchObject({ status: 403, body: { code: 'machine-only' } });
    expect(start).not.toHaveBeenCalled();
  });

  it('ac19: files with .. or an absolute path are refused', async () => {
    const start = vi.fn();
    for (const path of ['../.env', 'a/../../b', '/etc/passwd']) {
      const answer = readJsonResponse(await handleWorkProject(machine('operator', 'operator'), { ...BODY, files: [{ path, contentBase64: '' }] }, { start }));
      expect(answer).toMatchObject({ status: 400, body: { code: 'bad-path' } });
    }
    expect(start).not.toHaveBeenCalled();
  });
});

describe('addProjectThere (D-4651-14)', () => {
  const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', access: 'operator', revokedAt: null } as MachineLink;
  const source = {
    key: 'overdeck', name: 'Overdeck', issuePrefix: 'PAN', gitOrigin: 'github.com/eltmon/overdeck', cloneUrl: 'https://github.com/eltmon/overdeck.git', root: '/srv/overdeck',
    ignoredFiles: [{ path: '.env', bytes: 10, preselected: true }, { path: 'notes.local', bytes: 4, preselected: false }],
  };

  it('posts the project facts and the chosen files (base64) to the owner door', async () => {
    const post = vi.fn(async () => ({ status: 202, json: { jobId: 'add-9' } }));
    const result = await addProjectThere({ link: DESK, projectKey: 'overdeck', files: [], includePreselected: true }, {
      source: async () => source, readFile: async () => Buffer.from('TOKEN=abc\n'), post,
    });
    expect(result).toEqual({ ok: true, jobId: 'add-9' });
    expect(post).toHaveBeenCalledWith('env-desk', {
      gitOrigin: 'github.com/eltmon/overdeck', cloneUrl: 'https://github.com/eltmon/overdeck.git', name: 'Overdeck', issuePrefix: 'PAN',
      files: [{ path: '.env', contentBase64: Buffer.from('TOKEN=abc\n').toString('base64') }],
    });
  });

  it('passes the owner refusal through and refuses a project without an origin', async () => {
    const refused = await addProjectThere({ link: DESK, projectKey: 'overdeck', files: [], includePreselected: false }, {
      source: async () => source, readFile: vi.fn(), post: async () => ({ status: 403, json: { code: 'project-files-forbidden', error: 'operator only' } }),
    });
    expect(refused).toMatchObject({ ok: false, status: 403, body: { code: 'project-files-forbidden' } });
    const noOrigin = await addProjectThere({ link: DESK, projectKey: 'overdeck', files: [], includePreselected: false }, {
      source: async () => ({ ...source, gitOrigin: null, cloneUrl: null }), readFile: vi.fn(), post: vi.fn(),
    });
    expect(noOrigin).toMatchObject({ ok: false, status: 409, body: { code: 'project-has-no-origin' } });
  });
});
