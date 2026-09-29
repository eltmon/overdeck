/**
 * Detects whether a candidate cwd resolves to a project's primary checkout —
 * its registered root, or a polyrepo member root — rather than a throwaway
 * workspace or worktree (PAN-4338).
 *
 * A subdirectory of a primary checkout still counts: its git top level
 * resolves back to the checkout root. A worktree added under
 * `<root>/workspaces/feature-x` does not: `git rev-parse --show-toplevel`
 * from inside it returns the worktree's own root, never the primary
 * checkout's, because a linked worktree carries its own top level.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { canonicalPathAsync } from './path-containment.js';
import { listProjectsAsync } from '../projects.js';

const execFileAsync = promisify(execFile);
const GIT_TOPLEVEL_TIMEOUT_MS = 5_000;

export interface PrimaryCheckoutMatch {
  projectKey: string;
  repoName: string | null;
  root: string;
}

interface PrimaryCheckoutProjectConfig {
  path?: string;
  workspace?: { repos?: Array<{ name: string; path: string }> };
}

export interface PrimaryCheckoutDeps {
  listProjects?: () => Promise<Array<{ key: string; config: PrimaryCheckoutProjectConfig }>>;
  gitToplevel?: (path: string) => Promise<string | null>;
}

/** `git rev-parse --show-toplevel` from `path`, or null when it isn't inside a repo. */
async function defaultGitToplevel(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path,
      timeout: GIT_TOPLEVEL_TIMEOUT_MS,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The registered project (and polyrepo member, if any) whose primary checkout
 * contains `path`, or null when `path` matches no primary checkout.
 */
export async function findPrimaryCheckout(
  path: string,
  deps: PrimaryCheckoutDeps = {},
): Promise<PrimaryCheckoutMatch | null> {
  const listProjects = deps.listProjects ?? listProjectsAsync;
  const gitToplevel = deps.gitToplevel ?? defaultGitToplevel;

  const canonical = await canonicalPathAsync(path);
  const candidates = [canonical];
  const toplevel = await gitToplevel(canonical);
  if (toplevel) {
    const canonicalToplevel = await canonicalPathAsync(toplevel);
    if (!candidates.includes(canonicalToplevel)) candidates.push(canonicalToplevel);
  }

  for (const { key, config } of await listProjects()) {
    if (!config.path) continue;
    const root = await canonicalPathAsync(config.path);
    if (candidates.includes(root)) return { projectKey: key, repoName: null, root };

    for (const repo of config.workspace?.repos ?? []) {
      const memberRoot = await canonicalPathAsync(resolve(root, repo.path));
      if (candidates.includes(memberRoot)) return { projectKey: key, repoName: repo.name, root: memberRoot };
    }
  }

  return null;
}

/** Human-readable label for a match: `key`, or `key/repoName` for a polyrepo member. */
export function primaryCheckoutLabel(match: PrimaryCheckoutMatch): string {
  return match.repoName ? `${match.projectKey}/${match.repoName}` : match.projectKey;
}
