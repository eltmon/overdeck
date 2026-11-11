import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  checkGitHubIdentities,
  checkGitHubIdentityRows,
  type GitHubIdentityCheckDeps,
} from '../../../src/cli/commands/doctor-github-identity.js';
import type { GitHubIdentitiesSnapshot, GitHubIdentityProject } from '../../../src/lib/github-repo-identity.js';
import { getOverdeckHome } from '../../../src/lib/paths.js';

// PAN-5153 W8: `pan doctor` shows one GitHub identity row per owner.
function project(overrides: Partial<GitHubIdentityProject>): GitHubIdentityProject {
  return {
    key: 'p',
    name: 'P',
    repo: 'acme/p',
    mode: 'app',
    actor: 'overdeck-agent[bot]',
    detail: 'GitHub App is installed on this repository',
    ...overrides,
  };
}

function snapshot(owners: GitHubIdentitiesSnapshot['owners']): GitHubIdentitiesSnapshot {
  return { ghLogin: 'eltmon', appSlug: 'overdeck-agent', owners };
}

function deps(snap: GitHubIdentitiesSnapshot, overrides: Partial<GitHubIdentityCheckDeps> = {}): GitHubIdentityCheckDeps {
  return {
    collect: async () => snap,
    canPush: vi.fn(async () => 'true\n'),
    credentialHelper: vi.fn(async () => null),
    projectPath: (key) => `/projects/${key}`,
    ...overrides,
  };
}

const userProject = project({ key: 'web', repo: 'acme/web', mode: 'user', actor: 'eltmon', detail: 'GitHub App is not installed on this repository' });

describe('checkGitHubIdentities (PAN-5153)', () => {
  it('reports ok with the actors and their repo counts when the App acts everywhere', async () => {
    const rows = await checkGitHubIdentities(deps(snapshot([
      { owner: 'eltmon', projects: [project({ key: 'a', repo: 'eltmon/a' }), project({ key: 'b', repo: 'eltmon/b' })] },
    ])));
    expect(rows).toEqual([{ name: 'GitHub identity: eltmon', status: 'ok', message: 'overdeck-agent[bot] (2 repos)' }]);
  });

  it('lists distinct actors in an ok row', async () => {
    const rows = await checkGitHubIdentities(deps(snapshot([
      { owner: 'acme', projects: [project({ key: 'a', repo: 'acme/a' }), project({ key: 'b', repo: 'acme/b' }), userProject] },
    ])));
    expect(rows[0]).toMatchObject({ status: 'ok', message: 'overdeck-agent[bot] (2 repos), eltmon (1 repo)' });
  });

  it('warns with the write-access fix when the gh user cannot push', async () => {
    const rows = await checkGitHubIdentities(deps(snapshot([{ owner: 'acme', projects: [userProject] }]), {
      canPush: async () => 'false\n',
    }));
    expect(rows).toEqual([{
      name: 'GitHub identity: acme',
      status: 'warn',
      message: 'eltmon has no push access to acme/web',
      fix: 'Ask an owner of acme for write access, or install the GitHub App on acme',
    }]);
  });

  it('names the SAML fix when the token is not authorized for the organization', async () => {
    const samlError = Object.assign(new Error('gh: HTTP 403'), {
      stderr: 'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
    });
    const rows = await checkGitHubIdentities(deps(snapshot([{ owner: 'acme', projects: [userProject] }]), {
      canPush: async () => { throw samlError; },
    }));
    expect(rows[0]).toMatchObject({
      status: 'warn',
      message: 'acme/web needs SAML authorization for the gh token',
      fix: 'Run: gh auth refresh -h github.com, and authorize the organization in the browser',
    });
  });

  it('reports that a repository cannot be read on any other failure', async () => {
    const rows = await checkGitHubIdentities(deps(snapshot([{ owner: 'acme', projects: [userProject] }]), {
      canPush: async () => { throw new Error('HTTP 404'); },
    }));
    expect(rows[0]).toMatchObject({ status: 'warn', message: 'eltmon cannot read acme/web' });
  });

  it('names gh auth login when nobody acts on the repository', async () => {
    const none = project({ key: 'web', repo: 'acme/web', mode: 'none', actor: null, detail: 'gh is not signed in. Run: gh auth login' });
    const rows = await checkGitHubIdentities(deps(snapshot([{ owner: 'acme', projects: [none] }])));
    expect(rows[0]).toMatchObject({ status: 'warn', message: 'gh is not signed in. Run: gh auth login', fix: 'Run: gh auth login' });
  });

  it('warns when a gh-user checkout still pushes with a bot credential file', async () => {
    const helper = `store --file ${join(getOverdeckHome(), 'credentials', 'acme-web')}`;
    const credentialHelper = vi.fn(async () => helper);
    const rows = await checkGitHubIdentities(deps(snapshot([{ owner: 'acme', projects: [userProject] }]), { credentialHelper }));
    expect(credentialHelper).toHaveBeenCalledWith('/projects/web');
    expect(rows[0]).toMatchObject({
      status: 'warn',
      message: 'acme/web still pushes with a bot credential file',
      fix: 'In /projects/web run: git config --unset credential.helper, then set origin back to your own remote URL',
    });
  });

  it('does not read the credential helper of an App-covered checkout', async () => {
    const credentialHelper = vi.fn(async () => null);
    await checkGitHubIdentities(deps(snapshot([{ owner: 'eltmon', projects: [project({})] }]), { credentialHelper }));
    expect(credentialHelper).not.toHaveBeenCalled();
  });

  it('returns no rows when no project names a GitHub repository', async () => {
    await expect(checkGitHubIdentities(deps(snapshot([])))).resolves.toEqual([]);
  });

  it('turns a failed check into one warn row for doctor', async () => {
    const rows = await checkGitHubIdentityRows({ collect: async () => { throw new Error('projects.yaml unreadable'); } });
    expect(rows).toEqual([{ name: 'GitHub identity', status: 'warn', message: 'projects.yaml unreadable' }]);
  });
});
