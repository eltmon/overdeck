/**
 * Who acts on a GitHub repository (PAN-5153).
 *
 * This module owns the answer to "who acts on this repository": the App's bot
 * when the App is installed there, otherwise the signed-in gh user, otherwise
 * nobody. Spawn, the identities route, `pan doctor` and the dashboard all read
 * it from here, so they cannot disagree.
 */

import { configureWorkspaceForBot, getBotIdentity, isGitHubAppConfigured } from './github-app.js';
import {
  appCoversRepo as defaultAppCoversRepo,
  getRepoInstallationToken,
  resetRepoInstallationCache,
} from './github-app-installations.js';
import { getGitHubLogin } from './github-quota/identity.js';
import { clearAppNotInstalled } from './github-quota/repo-notes.js';
import { listProjectsSync } from './projects.js';

export type GitHubRepoIdentity =
  | { mode: 'app'; actor: string; detail: string }
  | { mode: 'user'; actor: string; detail: string }
  | { mode: 'none'; actor: null; detail: string };

export interface GitHubIdentityProject {
  key: string;
  name: string;
  /** "owner/repo" */
  repo: string;
  mode: 'app' | 'user' | 'none';
  actor: string | null;
  detail: string;
}

export interface GitHubIdentityOwner {
  owner: string;
  projects: GitHubIdentityProject[];
}

export interface GitHubIdentitiesSnapshot {
  ghLogin: string | null;
  appSlug: string | null;
  owners: GitHubIdentityOwner[];
}

export interface RepoIdentityDeps {
  appCoversRepo?: (owner: string, repo: string) => Promise<boolean>;
  isAppConfigured?: () => boolean;
  botName?: () => string;
  ghLogin?: () => Promise<string | null>;
  listProjects?: () => Array<{ key: string; config: { name?: string; github_repo?: string } }>;
  getRepoToken?: (owner: string, repo: string) => Promise<string | null>;
  configureBot?: (workspacePath: string, owner: string, repo: string, token: string) => Promise<void>;
}

function splitRepo(githubRepo: string | undefined): { owner: string; repo: string } | null {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec((githubRepo ?? '').trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** Who acts on owner/repo: the App's bot, the gh user, or nobody. */
export async function resolveRepoIdentity(
  owner: string,
  repo: string,
  deps: RepoIdentityDeps = {},
): Promise<GitHubRepoIdentity> {
  const covers = deps.appCoversRepo ?? defaultAppCoversRepo;
  if (await covers(owner, repo)) {
    const botName = deps.botName ?? (() => getBotIdentity().name);
    return { mode: 'app', actor: botName(), detail: 'GitHub App is installed on this repository' };
  }
  const login = await (deps.ghLogin ?? (() => getGitHubLogin()))();
  if (login) {
    const appConfigured = (deps.isAppConfigured ?? isGitHubAppConfigured)();
    return {
      mode: 'user',
      actor: login,
      detail: appConfigured ? 'GitHub App is not installed on this repository' : 'No GitHub App is configured',
    };
  }
  return { mode: 'none', actor: null, detail: 'gh is not signed in. Run: gh auth login' };
}

/** The identity of every registered project with a GitHub repository, grouped by owner. */
export async function collectGitHubIdentities(
  opts: { fresh?: boolean } = {},
  deps: RepoIdentityDeps = {},
): Promise<GitHubIdentitiesSnapshot> {
  const projects = (deps.listProjects ?? listProjectsSync)()
    .map(({ key, config }) => ({ key, name: config.name || key, target: splitRepo(config.github_repo) }))
    .filter((p): p is { key: string; name: string; target: { owner: string; repo: string } } => p.target !== null);

  if (opts.fresh) {
    for (const { target } of projects) clearAppNotInstalled(target.owner, target.repo);
    resetRepoInstallationCache();
  }

  const [identities, ghLogin] = await Promise.all([
    Promise.all(projects.map(({ target }) => resolveRepoIdentity(target.owner, target.repo, deps))),
    (deps.ghLogin ?? (() => getGitHubLogin()))(),
  ]);

  const owners = new Map<string, GitHubIdentityOwner>();
  projects.forEach(({ key, name, target }, index) => {
    const ownerKey = target.owner.toLowerCase();
    let group = owners.get(ownerKey);
    if (!group) {
      group = { owner: target.owner, projects: [] };
      owners.set(ownerKey, group);
    }
    const identity = identities[index];
    group.projects.push({
      key,
      name,
      repo: `${target.owner}/${target.repo}`,
      mode: identity.mode,
      actor: identity.actor,
      detail: identity.detail,
    });
  });
  const sorted = [...owners.values()].sort((a, b) => a.owner.localeCompare(b.owner));
  for (const group of sorted) group.projects.sort((a, b) => a.name.localeCompare(b.name));

  const appConfigured = (deps.isAppConfigured ?? isGitHubAppConfigured)();
  const botName = deps.botName ?? (() => getBotIdentity().name);
  return {
    ghLogin: ghLogin ?? null,
    appSlug: appConfigured ? botName().replace(/\[bot\]$/, '') : null,
    owners: sorted,
  };
}

/**
 * Set up a new workspace for the identity that acts on its repository. Only
 * the App's bot changes the workspace (HTTPS remote + token); the gh user
 * keeps the remote and credentials the clone came with.
 */
export async function configureWorkspaceGitHubIdentity(
  agentId: string,
  workspacePath: string,
  githubRepo: string,
  deps: RepoIdentityDeps = {},
): Promise<GitHubRepoIdentity> {
  const target = splitRepo(githubRepo);
  if (!target) {
    const identity: GitHubRepoIdentity = { mode: 'none', actor: null, detail: `not an owner/repo: ${githubRepo}` };
    console.log(`[${agentId}] GitHub identity for ${githubRepo}: none (${identity.detail}); git remote and credentials left unchanged`);
    return identity;
  }
  const { owner, repo } = target;
  const identity = await resolveRepoIdentity(owner, repo, deps);
  if (identity.mode === 'app') {
    const token = await (deps.getRepoToken ?? getRepoInstallationToken)(owner, repo);
    if (token) {
      await (deps.configureBot ?? configureWorkspaceForBot)(workspacePath, owner, repo, token);
      console.log(`[${agentId}] Configured workspace for bot push (${identity.actor})`);
      return identity;
    }
  }
  console.log(
    `[${agentId}] GitHub identity for ${owner}/${repo}: ${identity.actor ?? 'none'} (${identity.detail}); git remote and credentials left unchanged`,
  );
  return identity;
}
