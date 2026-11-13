import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { OVERDECK_PROJECT_GITIGNORE_ENTRIES, OVERDECK_WORKSPACE_ROOT_SYNC_ENTRIES } from '../workspace-sync-paths.js';

const execAsync = promisify(exec);

export interface PolyrepoWorkspaceRepoRef {
  name: string;
}

/**
 * PAN-2386: ensure a polyrepo scaffold workspace has a .gitignore that excludes
 * sub-repository directories. The scaffold repo is separate from the sub-repos;
 * without these entries, git status shows hundreds of untracked files and blocks
 * agent auto-start.
 *
 * Returns the entries that were added (the `removed` half is kept in the return
 * shape for callers that still report it; nothing is removed any more).
 */
export function ensurePolyrepoWorkspaceGitignore(
  workspacePath: string,
  repos: readonly PolyrepoWorkspaceRepoRef[],
): { added: string[]; removed: string[] } {
  const gitignorePath = join(workspacePath, '.gitignore');
  let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  const removed: string[] = [];

  const normalizedLines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const added: string[] = [];

  for (const repo of repos) {
    const entry = `${repo.name}/`;
    if (!normalizedLines.includes(entry) && !normalizedLines.includes(repo.name)) {
      added.push(entry);
    }
  }

  // PAN-2541: the workspace .overdeck/ dir is disposable issue runtime
  // (continue.json, transcripts, feedback). Without this entry the scaffold
  // repo shows `?? .overdeck/` and agents invent local .git/info/exclude edits.
  const runtimeEntries: string[] = [];
  if (!normalizedLines.includes('.overdeck/') && !normalizedLines.includes('.overdeck')) {
    runtimeEntries.push('.overdeck/');
  }
  // Generated devcontainer harness (`pan workspace render-devcontainer`):
  // `.devcontainer/` (rendered compose/config) and `dev` (symlink into it).
  // These are reproducible runtime artifacts, never commit targets — without
  // the entries, `pan done` preflight fails on the untracked files and agents
  // try to delete workspace infrastructure to unblock it (MIN-896/MIN-898).
  if (!normalizedLines.includes('.devcontainer/') && !normalizedLines.includes('.devcontainer')) {
    runtimeEntries.push('.devcontainer/');
  }
  if (!normalizedLines.includes('dev')) {
    runtimeEntries.push('dev');
  }

  // PAN-5199: Overdeck's own sync output in the wrapper root (skills, agents,
  // settings, .mcp.json, .hume-config, .env). Without these, `?? .claude/…`
  // refuses every work-agent start. One shared list: ../workspace-sync-paths.ts.
  const syncEntries = [...OVERDECK_PROJECT_GITIGNORE_ENTRIES, ...OVERDECK_WORKSPACE_ROOT_SYNC_ENTRIES]
    .filter(entry => !normalizedLines.includes(entry) && !normalizedLines.includes(entry.replace(/\/$/, '')));

  if (added.length === 0 && runtimeEntries.length === 0 && removed.length === 0 && syncEntries.length === 0) {
    return { added, removed };
  }

  if (content && !content.endsWith('\n')) {
    content += '\n';
  }
  if (added.length > 0) {
    if (!normalizedLines.some(l => l.includes('Polyrepo') || l.includes('polyrepo'))) {
      content += '\n# Polyrepo sub-repositories\n';
    }
    content += added.join('\n') + '\n';
  }
  if (runtimeEntries.length > 0) {
    content += '\n# Overdeck workspace runtime (PAN-2541: disposable issue runtime; devcontainer harness is generated)\n';
    content += runtimeEntries.join('\n') + '\n';
    added.push(...runtimeEntries);
  }
  if (syncEntries.length > 0) {
    content += '\n# Overdeck sync output (PAN-5199: written by Overdeck into the workspace root, never work product)\n';
    content += syncEntries.join('\n') + '\n';
    added.push(...syncEntries);
  }
  writeFileSync(gitignorePath, content, 'utf-8');
  return { added, removed };
}

/**
 * PAN-2386: commit a freshly-written polyrepo workspace .gitignore so the file
 * itself does not show as untracked and block agent auto-start. Non-fatal: if
 * the commit cannot be made, the workspace is still usable and the caller can
 * surface the warning.
 */
export async function commitPolyrepoWorkspaceGitignoreAsync(workspacePath: string): Promise<string | null> {
  if (!existsSync(join(workspacePath, '.git'))) return null;

  try {
    await execAsync('git add .gitignore', { cwd: workspacePath });
    try {
      await execAsync('git diff --cached --quiet', { cwd: workspacePath });
      return null;
    } catch {
      // There are staged changes — commit them.
    }

    await execAsync(
      'git commit -m "chore(workspace): add polyrepo scaffold .gitignore"',
      {
        cwd: workspacePath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Overdeck',
          GIT_AUTHOR_EMAIL: 'agent@overdeck.ai',
          GIT_COMMITTER_NAME: 'Overdeck',
          GIT_COMMITTER_EMAIL: 'agent@overdeck.ai',
        },
      },
    );
    return 'Committed polyrepo workspace .gitignore';
  } catch (err: any) {
    return `Warning: could not commit workspace .gitignore: ${err.message}`;
  }
}
