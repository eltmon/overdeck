/** PAN-4651 WI-17 (D-4651-14): project facts and files only for the operator on an operator-level link. */
import { describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import { ProjectFileError } from '../../../lib/projects/ignored-files.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { handleProjectFile, handleProjectSource, type MachineProjectsDeps } from '../routes/machines-projects.js';
import { readJsonResponse } from '../routes/machines-work.js';

const machine = (access: 'operator' | 'agent-fenced', actor: 'operator' | { agentId: string }): DashboardCredential => ({
  kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES(access), actor, access,
});

const deps: MachineProjectsDeps = {
  project: (key) => (key === 'overdeck' ? { name: 'Overdeck', path: '/srv/overdeck', github_repo: 'eltmon/overdeck', issue_prefix: 'PAN' } as ProjectConfig : null),
  ignoredFiles: vi.fn(async () => [{ path: '.env', bytes: 10, preselected: true }]),
  cloneUrl: vi.fn(async () => 'https://github.com/eltmon/overdeck.git'),
  readFile: vi.fn(async (_root: string, path: string) => {
    if (path.includes('..')) throw new ProjectFileError('bad-path', 'not inside');
    return Buffer.from('TOKEN=abc\n');
  }),
};

describe('owner project source and file routes (D-4651-14)', () => {
  it('answers the source facts to the operator on an operator-level link', async () => {
    const answer = readJsonResponse(await handleProjectSource(machine('operator', 'operator'), 'overdeck', deps));
    expect(answer).toEqual({ status: 200, body: {
      key: 'overdeck', name: 'Overdeck', issuePrefix: 'PAN', gitOrigin: 'github.com/eltmon/overdeck',
      cloneUrl: 'https://github.com/eltmon/overdeck.git', ignoredFiles: [{ path: '.env', bytes: 10, preselected: true }],
    } });
  });

  it('ac17: an agent actor, an agent-fenced link or a non-machine credential gets 403 project-files-forbidden', async () => {
    for (const credential of [machine('operator', { agentId: 'agent-pan-7' }), machine('agent-fenced', 'operator'), { kind: 'root-session' } as DashboardCredential, null]) {
      expect(readJsonResponse(await handleProjectSource(credential, 'overdeck', deps))).toMatchObject({ status: 403, body: { code: 'project-files-forbidden' } });
      expect(readJsonResponse(await handleProjectFile(credential, 'overdeck', '.env', deps))).toMatchObject({ status: 403, body: { code: 'project-files-forbidden' } });
    }
  });

  it('serves a file as bytes and refuses a bad path with 400; an unknown project is 404', async () => {
    const ok = await handleProjectFile(machine('operator', 'operator'), 'overdeck', '.env', deps);
    expect(ok.status).toBe(200);
    expect(readJsonResponse(await handleProjectFile(machine('operator', 'operator'), 'overdeck', '../etc/passwd', deps))).toMatchObject({ status: 400, body: { code: 'bad-path' } });
    expect(readJsonResponse(await handleProjectSource(machine('operator', 'operator'), 'nope', deps)).status).toBe(404);
  });
});
