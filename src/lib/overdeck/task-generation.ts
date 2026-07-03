import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { getGitHubConfig } from '../../dashboard/server/services/tracker-config.js';
import { extractPrefixSync } from '../issue-id.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { findPlan } from '../vbrief/io.js';

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueSync(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function getGitHubLocalPaths(): Record<string, string> {
  const ghConfig = getGitHubConfig();
  if (!ghConfig) return {};
  const out: Record<string, string> = {};
  for (const r of ghConfig.repos) {
    const localPath = (r as { localPath?: unknown }).localPath;
    if (typeof localPath === 'string') {
      out[`${r.owner}/${r.repo}`] = localPath;
    }
  }
  return out;
}

function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;
  }
  if (issuePrefix) {
    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

export function buildChildStoriesFromRally(
  children: readonly { ref: string; title: string; status: string; description: string }[],
): Array<{ ref: string; title: string; status: string; description: string }> {
  return children.map((c) => ({
    ref: c.ref,
    title: c.title,
    status: c.status,
    description: c.description || '',
  }));
}

export function generateTasksForIssue(id: string) {
  return Effect.gen(function* () {
    const issueLower = id.toLowerCase();

    const githubCheck = isGitHubIssue(id);
    let projectPath = '';
    if (githubCheck.isGitHub && githubCheck.owner && githubCheck.repo) {
      const localPaths = getGitHubLocalPaths();
      projectPath = localPaths[`${githubCheck.owner}/${githubCheck.repo}`] || '';
    }
    if (!projectPath) {
      const issuePrefix = extractPrefixSync(id) ?? id.split('-')[0];
      try { projectPath = getProjectPath(undefined, issuePrefix); } catch { projectPath = ''; }
    }

    if (!projectPath) {
      return jsonResponse({ success: false, error: `Could not resolve project path for ${id}` }, { status: 404 });
    }

    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planPath = yield* findPlan(workspacePath);
    if (!planPath || !existsSync(planPath)) {
      return jsonResponse(
        { success: false, error: `No vBRIEF spec found on main for ${id} — run planning first.` },
        { status: 409 },
      );
    }

    const { createBeadsFromVBrief } = yield* Effect.promise(() => import('../vbrief/beads.js'));
    const result = yield* createBeadsFromVBrief(workspacePath);

    if (!result.success || result.created.length === 0) {
      const errors = result.errors.length > 0 ? result.errors : ['Beads creation produced no tasks'];
      return jsonResponse({ success: false, created: result.created, errors }, { status: 500 });
    }

    return jsonResponse({
      success: true,
      created: result.created,
      count: result.created.length,
    });
  });
}
