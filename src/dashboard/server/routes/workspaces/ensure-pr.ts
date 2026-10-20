/**
 * Resolve the pull request a merge lands: reuse the open (or merged) PR for the
 * issue branch, or open one with a body built from the xBRIEF plan. Split out of
 * merge-ops.ts, which re-exports both functions.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { extractNumber } from '../../../../lib/issue-id.js';
import { findPlan } from '../../../../lib/xbrief/io.js';

const execFileAsync = promisify(execFile);

/**
 * Build a rich PR body with issue link, tasks task summary, and AC checklist
 * from the xBRIEF plan. Exported for testing.
 */
export async function buildRichPRBody(issueId: string, workspacePath: string): Promise<string> {
  const lines: string[] = [];

  // Non-closing reference on purpose: a closing keyword ("Closes #N") hands
  // close authority to GitHub, which fires the moment the PR's head becomes
  // reachable from main and races the pipeline's verifying_on_main → close-out
  // lifecycle (the first UAT batch promote closed 2 of 3 member issues
  // mid-handoff, 2026-06-11). Overdeck's close-out owns issue closing.
  lines.push(`**Issue:** #${extractNumber(issueId) ?? issueId}`);
  lines.push('');

  // Acceptance criteria checklist from xBRIEF plan items
  try {
    const planPath = await Effect.runPromise(findPlan(workspacePath));
    if (planPath && existsSync(planPath)) {
      const raw = await readFile(planPath, 'utf-8');
      const doc = JSON.parse(raw);
      const items: Array<{ status: string; title: string }> = doc?.plan?.items ?? [];
      if (items.length > 0) {
        lines.push('## Acceptance Criteria');
        lines.push('');
        for (const item of items) {
          const checked = item.status === 'completed' ? 'x' : ' ';
          lines.push(`- [${checked}] ${item.title}`);
        }
        lines.push('');
      }
    }
  } catch {
    // No xBRIEF plan — omit checklist
  }

  return lines.join('\n') || `Automated PR for ${issueId}`;
}

export async function ensurePRExists(
  issueId: string,
  options?: { cwd?: string; branchName?: string; targetBranch?: string }
): Promise<{ created: boolean; prUrl?: string; error?: string }> {
  try {
    const issueLower = issueId.toLowerCase();
    const branchName = options?.branchName ?? `feature/${issueLower}`;
    const targetBranch = options?.targetBranch ?? 'main';
    const execOptions: Parameters<typeof execFileAsync>[2] = { encoding: 'utf-8' };
    if (options?.cwd) execOptions.cwd = options.cwd;

    // Reuse an open PR for this head/base pair, or a merged PR for terminal reconciliation.
    // A closed unmerged PR must not prevent a fresh PR for new branch commits.
    try {
      const { stdout } = await execFileAsync('gh', ['pr', 'list', '--head', branchName, '--base', targetBranch, '--state', 'all', '--json', 'url,state', '--limit', '100'], execOptions);
      const pullRequests = JSON.parse(String(stdout)) as Array<{ url?: string; state?: string }>;
      const existing = pullRequests.find(pr => pr.state === 'OPEN') ?? pullRequests.find(pr => pr.state === 'MERGED');
      if (existing?.url) return { created: false, prUrl: existing.url };
    } catch { /* no reusable PR */ }

    // Build rich PR body if workspace path is available
    const prBody = options?.cwd ? await buildRichPRBody(issueId, options.cwd) : `Automated PR for ${issueId}`;

    // Write body to a temp file to avoid shell escaping issues
    const { tmpdir } = await import('os');
    const { join: pathJoin } = await import('path');
    const { writeFile: writeFileAsync, unlink: unlinkAsync } = await import('fs/promises');
    const bodyFile = pathJoin(tmpdir(), `pan-pr-body-${issueId}-${Date.now()}.md`);
    await writeFileAsync(bodyFile, prBody, 'utf-8');

    try {
      const { stdout: rawOut } = await execFileAsync('gh', ['pr', 'create', '--head', branchName, '--base', targetBranch, '--title', issueId, '--body-file', bodyFile], execOptions);
      const createOut = String(rawOut);
      // gh pr create prints the PR URL as the last line of stdout
      const prUrl = createOut.trim().split('\n').pop()?.trim() || createOut.trim();
      return { created: true, prUrl };
    } catch (createErr: unknown) {
      // The lookup above can fail transiently and fall through to create. gh then
      // refuses with the existing PR's URL, which is the PR this merge wants.
      const message = createErr instanceof Error ? createErr.message : String(createErr);
      const existingUrl = /already exists:\s*(https:\/\/\S+\/pull\/\d+)/.exec(message)?.[1];
      if (existingUrl) return { created: false, prUrl: existingUrl };
      throw createErr;
    } finally {
      unlinkAsync(bodyFile).catch(() => {});
    }
  } catch (err: unknown) {
    return { created: false, error: err instanceof Error ? err.message : String(err) };
  }
}

