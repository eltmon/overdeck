/**
 * CI failure feedback relay (PAN-1801)
 *
 * When a PR's GitHub checks fail, this module writes a feedback file to the
 * work agent's workspace and messages the agent so it can address the failure
 * instead of waiting for a human to notice a red merge gate.
 *
 * - Debounces per head SHA so retries do not spam the agent.
 * - Fetches failed log excerpts with `gh run view --log-failed`.
 * - Diff's the PR's failing check names against main's current failing set so
 *   inherited main-red failures are labelled as such.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { Effect } from 'effect';
import { getAgentStateSync, messageAgent } from '../agents.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { writeFeedbackFile } from './feedback-writer.js';

function execFilePromise(
  file: string,
  args: string[],
  options: { encoding: 'utf-8'; timeout?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout as string, stderr: stderr as string });
      }
    });
  });
}

export interface CiFailureFeedbackOptions {
  issueId: string;
  repo: string;
  prNumber: number;
  headSha: string;
  headRef: string;
  prUrl?: string;
  source: string;
}

export interface CiFailure {
  name: string;
  workflowName?: string;
  runId: number;
  excerpt: string;
  inheritedFromMain: boolean;
}

export interface CiFailureFeedbackResult {
  feedbackPath?: string;
  agentMessageSent: boolean;
}

/** Per-issue head SHA we last sent CI failure feedback for. */
const lastNotifiedSha = new Map<string, string>();

/** Reset internal debounce state — for tests only. */
export function resetCiFailureFeedbackStateForTests(): void {
  lastNotifiedSha.clear();
}

function agentIdForIssue(issueId: string): string {
  return `agent-${issueId.toLowerCase()}`;
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, ...rest] = repo.split('/');
  return { owner, repo: rest.join('/') };
}

interface GhRunListItem {
  databaseId: number;
  name: string;
  workflowName: string;
  headSha?: string;
  conclusion: string;
}

async function listFailingRuns(
  owner: string,
  repo: string,
  branch: string,
  headSha?: string,
): Promise<GhRunListItem[]> {
  try {
    const { stdout } = await execFilePromise(
      'gh',
      [
        'run', 'list',
        '--repo', `${owner}/${repo}`,
        '--branch', branch,
        '--status', 'failure',
        '--json', 'databaseId,name,workflowName,headSha,conclusion',
        '--limit', '100',
      ],
      { encoding: 'utf-8', timeout: 30000 },
    );
    const runs = JSON.parse(stdout) as GhRunListItem[];
    if (headSha) {
      return runs.filter((r) => r.headSha === headSha);
    }
    return runs;
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Failed to list failing runs for ${branch}:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

async function fetchRunFailedLogExcerpt(owner: string, repo: string, runId: number, maxChars = 2000): Promise<string> {
  try {
    const { stdout } = await execFilePromise(
      'gh',
      ['run', 'view', String(runId), '--repo', `${owner}/${repo}`, '--log-failed'],
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.slice(0, maxChars).trim();
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Failed to fetch log for run ${runId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return '';
  }
}

async function collectFailures(
  owner: string,
  repo: string,
  branch: string,
  headSha: string,
  mainFailingNames: Set<string>,
): Promise<CiFailure[]> {
  const runs = await listFailingRuns(owner, repo, branch, headSha);
  const failures: CiFailure[] = [];
  for (const run of runs) {
    const excerpt = await fetchRunFailedLogExcerpt(owner, repo, run.databaseId);
    const name = run.name || run.workflowName || `run-${run.databaseId}`;
    failures.push({
      name,
      workflowName: run.workflowName,
      runId: run.databaseId,
      excerpt,
      inheritedFromMain: mainFailingNames.has(name),
    });
  }
  return failures;
}

function buildFeedbackBody(opts: {
  issueId: string;
  repo: string;
  prNumber: number;
  headSha: string;
  prUrl?: string;
  failures: CiFailure[];
  source: string;
}): string {
  const shortSha = opts.headSha.slice(0, 8);
  const prLine = opts.prUrl
    ? `Pull request: ${opts.prUrl} (head \`${shortSha}\`)`
    : `Pull request #${opts.prNumber} in ${opts.repo} (head \`${shortSha}\`)`;

  let body = `# CI Failure Feedback for ${opts.issueId}\n\n${prLine}\n\nSource: ${opts.source}\n\n`;

  if (opts.failures.length === 0) {
    body +=
      'GitHub reported a failing CI status, but no failing workflow runs were found for this commit. Check the PR checks page directly.\n\n';
  } else {
    body += `## Failing checks (${opts.failures.length})\n\n`;
    for (const f of opts.failures) {
      const inheritedTag = f.inheritedFromMain ? ' [INHERITED FROM MAIN — also failing on main]' : '';
      body += `### ${f.name}${inheritedTag}\n\n`;
      if (f.workflowName && f.workflowName !== f.name) {
        body += `Workflow: ${f.workflowName}  \n`;
      }
      body += `Run: \`gh run view ${f.runId} --repo ${opts.repo}\`  \n`;
      if (f.excerpt) {
        body += '```\n' + f.excerpt + '\n```\n\n';
      } else {
        body += '*(No log excerpt available.)*\n\n';
      }
    }
  }

  body += `## Required action\n\n`;
  body +=
    'Fix the failing checks, commit the fixes, and push an update. If a failure is marked [INHERITED FROM MAIN], it is not caused by your PR and does not need to be fixed in this branch.\n';

  return body;
}

async function relayCiFailureFeedbackPromise(
  opts: CiFailureFeedbackOptions,
): Promise<CiFailureFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();

  // Only relay for work agents. The feedback file/message would not be useful
  // for plan/review/test/ship/strike roles.
  const agentId = agentIdForIssue(issueId);
  const agentState = getAgentStateSync(agentId);
  if (!agentState || agentState.role !== 'work') {
    return { agentMessageSent: false };
  }

  // Debounce per head SHA so duplicate webhook deliveries / retries do not spam.
  const lastSha = lastNotifiedSha.get(issueId);
  if (lastSha === opts.headSha) {
    console.log(`[ci-failure-feedback] Skipping duplicate feedback for ${issueId} @ ${opts.headSha.slice(0, 8)}`);
    return { agentMessageSent: false };
  }

  const { owner, repo } = parseRepo(opts.repo);

  // Diff against main's current failing checks so agents do not chase inherited failures.
  const mainRuns = await listFailingRuns(owner, repo, 'main');
  const mainFailingNames = new Set(mainRuns.map((r) => r.name || r.workflowName || `run-${r.databaseId}`));

  // Collect the concrete failures for this PR head.
  const failures = await collectFailures(owner, repo, opts.headRef, opts.headSha, mainFailingNames);

  // If we cannot find any failing workflow run for this SHA, still write a short
  // feedback file for explicit status events so the agent is not left in the dark.
  if (failures.length === 0 && !opts.source.startsWith('status:')) {
    console.log(
      `[ci-failure-feedback] No failing runs found for ${issueId} @ ${opts.headSha.slice(0, 8)}; skipping feedback`,
    );
    return { agentMessageSent: false };
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = resolved
    ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`)
    : undefined;

  const markdownBody = buildFeedbackBody({
    issueId,
    repo: opts.repo,
    prNumber: opts.prNumber,
    headSha: opts.headSha,
    prUrl: opts.prUrl,
    failures,
    source: opts.source,
  });

  const fileResult = await Effect.runPromise(
    writeFeedbackFile({
      issueId,
      workspacePath,
      specialist: 'ci-monitor',
      outcome: 'failed',
      summary: `CI failure: ${failures.map((f) => f.name).join(', ') || opts.source}`.slice(0, 120),
      markdownBody,
    }),
  );

  if (!fileResult.success || !fileResult.filePath) {
    console.error(`[ci-failure-feedback] Failed to write feedback for ${issueId}: ${fileResult.error}`);
    return { agentMessageSent: false };
  }

  let agentMessageSent = false;
  const message =
    `SPECIALIST FEEDBACK: ci-monitor reported CI FAILED for ${issueId}.\n\n` +
    `MUST READ: ${fileResult.filePath}\n\n` +
    'Use your Read tool to open this file, read every line, then fix ALL failing checks. Do NOT stop at the prompt.';
  try {
    await messageAgent(agentId, message);
    agentMessageSent = true;
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not message ${agentId}; feedback file remains available: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  lastNotifiedSha.set(issueId, opts.headSha);
  return { feedbackPath: fileResult.filePath, agentMessageSent };
}

/** Effect variant of {@link relayCiFailureFeedbackPromise}. */
export const relayCiFailureFeedback = (
  opts: CiFailureFeedbackOptions,
): Effect.Effect<CiFailureFeedbackResult> => Effect.promise(() => relayCiFailureFeedbackPromise(opts));
