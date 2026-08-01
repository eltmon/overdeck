/**
 * Residue disposition: close stale convention PRs/MRs for tracker-closed
 * pre-record-era issues with no landing evidence.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { StepResult } from './types.js';

const execFileAsync = promisify(execFile);

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
  const errors: string[] = [];
  const issueIdLower = ctx.issueId.toLowerCase();
  const possibleHeads = [`feature/${issueIdLower}`, `strike/${issueIdLower}`];

  // GitHub PR close
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
        for (const pr of prs) {
          await execFileAsync('gh', [
            'pr', 'close',
            `${pr.number}`,
            '--repo', ctx.github,
            '--comment', 'Closing stale residue PR with no merge claim — issue closed out without merge landing.',
          ], { encoding: 'utf-8', timeout: 15_000 });
          evidence.push(`Closed GitHub PR #${pr.number} on ${head}`);
        }
      } catch (err) {
        errors.push(`GitHub PR list failed for ${head}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // GitLab MR close
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
          for (const mr of mrs) {
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
          }
        } catch (err) {
          errors.push(`GitLab MR list failed for ${glProject}/${head}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  if (errors.length > 0 && evidence.length === 0) {
    return {
      step: 'Close stale convention PRs/MRs',
      success: false,
      skipped: false,
      error: `Failed to list/close convention PRs/MRs: ${errors.join('; ')}`,
    };
  }

  if (evidence.length === 0) {
    return {
      step: 'Close stale convention PRs/MRs',
      success: true,
      skipped: true,
      details: ['No open convention PRs/MRs found'],
    };
  }

  return {
    step: 'Close stale convention PRs/MRs',
    success: true,
    skipped: false,
    details: [...evidence, ...(errors.length > 0 ? [`Warnings: ${errors.join('; ')}`] : [])],
  };
}
