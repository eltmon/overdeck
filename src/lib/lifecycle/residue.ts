/**
 * Residue disposition: close stale convention PRs/MRs for tracker-closed
 * pre-record-era issues with no landing evidence.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { StepResult } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Extract GitHub owner/repo from a repository checkout path.
 * Reads the git remote URL to resolve forge coordinates.
 */
export async function extractGitHubCoordinates(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', repoPath,
      'remote', 'get-url', 'origin',
    ], { encoding: 'utf-8', timeout: 5_000 });

    const remoteUrl = stdout.trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
    if (match) {
      const owner = match[1];
      const repo = match[2];
      return `${owner}/${repo}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract GitLab project path from a repository checkout path.
 * Reads the git remote URL to resolve forge coordinates.
 */
export async function extractGitLabProject(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', repoPath,
      'remote', 'get-url', 'origin',
    ], { encoding: 'utf-8', timeout: 5_000 });

    const remoteUrl = stdout.trim();
    const match = remoteUrl.match(/gitlab\.com[:/](.+?)(\.git)?$/);
    if (match) {
      return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

export interface CloseResidueConventionPrsContext {
  issueId: string;
  projectPath: string;
  github?: string;  // owner/repo path for GitHub
  gitlab?: { projects: string[] };  // GitLab project paths
}

export async function closeResidueConventionPrs(
  ctx: CloseResidueConventionPrsContext,
): Promise<StepResult> {
  const evidence: string[] = [];
  const fatalErrors: string[] = [];
  const issueIdLower = ctx.issueId.toLowerCase();
  const possibleHeads = [`feature/${issueIdLower}`, `strike/${issueIdLower}`];

  // GitHub PR close — resolve forge coordinates and close all found
  if (ctx.github) {
    for (const head of possibleHeads) {
      try {
        const { stdout } = await execFileAsync('gh', [
          'pr', 'list',
          '--repo', ctx.github,
          '--head', head,
          '--state', 'open',
          '--json', 'number',
        ], { encoding: 'utf-8', timeout: 15_000 });

        const prs = JSON.parse(stdout) as Array<{ number: number }>;
        if (prs.length === 0) {
          evidence.push(`No open GitHub PRs found on ${head}`);
        }
        for (const pr of prs) {
          try {
            await execFileAsync('gh', [
              'pr', 'close',
              `${pr.number}`,
              '--repo', ctx.github,
              '--comment', 'Closing stale residue PR with no merge claim — issue closed out without merge landing.',
            ], { encoding: 'utf-8', timeout: 15_000 });
            evidence.push(`Closed GitHub PR #${pr.number} on ${head}`);
          } catch (err) {
            fatalErrors.push(`GitHub PR #${pr.number} close failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        fatalErrors.push(`GitHub PR lookup for ${head} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // GitLab MR close — resolve forge coordinates and close all found
  if (ctx.gitlab?.projects) {
    for (const glProject of ctx.gitlab.projects) {
      for (const head of possibleHeads) {
        try {
          const { stdout } = await execFileAsync('glab', [
            'mr', 'list',
            '--repo', glProject,
            '--source-branch', head,
            '--state', 'opened',
            '--output', 'json',
          ], { encoding: 'utf-8', timeout: 15_000 });

          const mrs = JSON.parse(stdout) as Array<{ iid: number }>;
          if (mrs.length === 0) {
            evidence.push(`No open GitLab MRs found on ${glProject}/${head}`);
          }
          for (const mr of mrs) {
            try {
              await execFileAsync('glab', [
                'mr', 'close',
                '--repo', glProject,
                String(mr.iid),
              ], { encoding: 'utf-8', timeout: 15_000 });

              // Add a note with honest comment
              await execFileAsync('glab', [
                'mr', 'note',
                '--repo', glProject,
                String(mr.iid),
                '--message', 'Closing stale residue MR with no merge claim — issue closed out without merge landing.',
              ], { encoding: 'utf-8', timeout: 15_000 });

              evidence.push(`Closed GitLab MR !${mr.iid} on ${head}`);
            } catch (err) {
              fatalErrors.push(`GitLab MR !${mr.iid} close failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } catch (err) {
          fatalErrors.push(`GitLab MR lookup for ${glProject}/${head} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  // Fail on any repository/operation errors — even if some PRs/MRs closed
  if (fatalErrors.length > 0) {
    return {
      step: 'Close stale convention PRs/MRs',
      success: false,
      skipped: false,
      error: `Failed to list/close convention PRs/MRs: ${fatalErrors.join('; ')}`,
      details: evidence.length > 0 ? [`Partial progress before failure: ${evidence.join('; ')}`] : undefined,
    };
  }

  if (evidence.length === 0) {
    return {
      step: 'Close stale convention PRs/MRs',
      success: true,
      skipped: true,
      details: ['No open convention PRs/MRs found on any configured repository'],
    };
  }

  return {
    step: 'Close stale convention PRs/MRs',
    success: true,
    skipped: false,
    details: evidence,
  };
}
