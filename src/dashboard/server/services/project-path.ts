/**
 * The checkout that owns an issue prefix, as the dashboard's workspace and merge
 * routes resolve it: the project registry first (`${prefix}-1`), then the GitHub
 * tracker config's repos under `~/Projects`, then `~/Projects` itself.
 *
 * PAN-4750 review: moved out of `routes/workspaces.ts` so the strike merge
 * builder (`strike-merge.ts`) resolves exactly the path `triggerMerge` uses,
 * repo-prefix fallback included, without importing the route module.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getGitHubConfig } from './tracker-config.js';

export function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;

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
