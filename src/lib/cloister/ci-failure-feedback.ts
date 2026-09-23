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
 * - PAN-3965: for a project whose tests run on CI (`verification.tests: ci`),
 *   a red CI test job on the PR head IS the verification gate's test failure.
 *   It is journaled as `verification.failed { failedCheck: 'test' }` — same
 *   shape the local gate writes — and the agent is told it owes rework.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { Effect } from 'effect';
import { getAgentStateSync, messageAgent } from '../agents.js';
import { findProjectByPathSync, resolveProjectFromIssueSync } from '../projects.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { appendPipelineEntry } from './pipeline-journal.js';
import type { PrFacts } from './pr-facts.js';
import { resolveVerificationTestsMode, TEST_GATE_NAME } from './verification-tests-mode.js';

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
  /** PAN-3965: the CI test job — the verification test gate — failed on this head. */
  testGateFailed?: boolean;
}

export interface CiFailureFeedbackDeps {
  /** Fresh forge read of the PR; defaults to an uncached `getPrFacts`. */
  readPrFacts?: (issueId: string) => Promise<PrFacts>;
}

/** Per-issue head SHA we last sent CI failure feedback for. */
const lastNotifiedSha = new Map<string, string>();
/** Per-issue head SHA we last journaled a CI test-gate failure for. */
const lastJournaledTestFailureSha = new Map<string, string>();
/** Per-issue head SHA we last sent a CI test-gate (rework) message for. */
const lastNotifiedTestGateSha = new Map<string, string>();

/** Reset internal debounce state — for tests only. */
export function resetCiFailureFeedbackStateForTests(): void {
  lastNotifiedSha.clear();
  lastJournaledTestFailureSha.clear();
  lastNotifiedTestGateSha.clear();
}

/**
 * Webhooks bump the PR-tab cache generation before relaying, so passing the
 * PR reader explicitly skips pr-facts' 60s memo without re-reading stale data.
 */
async function readFreshPrFacts(issueId: string): Promise<PrFacts> {
  // Lazy: the forge readers pull in the GitHub App client, which only this
  // CI-mode branch needs.
  const [{ getPrFacts }, { fetchIssuePullRequest }] = await Promise.all([
    import('./pr-facts.js'),
    import('../overdeck/pull-requests.js'),
  ]);
  return getPrFacts(issueId, { fetchGitHubPr: fetchIssuePullRequest });
}

/**
 * PAN-3965: when the project's tests run on CI and the PR head's test job is
 * red, record the verification test-gate failure in the pipeline journal.
 * Returns true when this failure is the test gate's.
 */
async function recordCiTestGateFailure(
  issueId: string,
  opts: CiFailureFeedbackOptions,
  projectPath: string | undefined,
  workspacePath: string | undefined,
  deps: CiFailureFeedbackDeps,
): Promise<boolean> {
  if (!projectPath) return false;
  if (resolveVerificationTestsMode(findProjectByPathSync(projectPath)) !== 'ci') return false;
  if (lastJournaledTestFailureSha.get(issueId) === opts.headSha) return true;

  let facts: PrFacts;
  try {
    facts = await (deps.readPrFacts ?? readFreshPrFacts)(issueId);
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not read PR checks for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  if (facts.testChecks !== 'red') return false;
  // A late webhook for an older head is not a verdict on the current one.
  if (facts.headSha && facts.headSha !== opts.headSha) return false;

  if (workspacePath) {
    appendPipelineEntry(workspacePath, {
      type: 'verification.failed',
      issueId,
      source: `ci:${opts.source}`,
      data: {
        failedCheck: TEST_GATE_NAME,
        head: opts.headSha.slice(0, 8),
        via: 'ci',
        prNumber: opts.prNumber,
      },
    });
  }
  lastJournaledTestFailureSha.set(issueId, opts.headSha);
  return true;
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
  testGateFailed?: boolean;
}): string {
  const shortSha = opts.headSha.slice(0, 8);
  const prLine = opts.prUrl
    ? `Pull request: ${opts.prUrl} (head \`${shortSha}\`)`
    : `Pull request #${opts.prNumber} in ${opts.repo} (head \`${shortSha}\`)`;

  let body = `# CI Failure Feedback for ${opts.issueId}\n\n${prLine}\n\nSource: ${opts.source}\n\n`;
  if (opts.testGateFailed) {
    body +=
      'Failed check: test — this project runs its tests on CI (`verification.tests: ci`), so the CI test job ' +
      'is the verification test gate. Reproduce with `npx vitest run <failing files>`; do not run the full suite locally.\n\n';
  }

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
  deps: CiFailureFeedbackDeps = {},
): Promise<CiFailureFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();

  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = resolved
    ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`)
    : undefined;

  // PAN-3965: journal a CI test-gate failure whether or not an agent is live —
  // the journal records what happened to the PR, not who was told.
  const testGateFailed = await recordCiTestGateFailure(issueId, opts, resolved?.projectPath, workspacePath, deps);
  const testGateFlag = testGateFailed ? { testGateFailed: true } : {};

  // Only relay for work agents. The feedback file/message would not be useful
  // for plan/review/test/ship/strike roles.
  const agentId = agentIdForIssue(issueId);
  const agentState = getAgentStateSync(agentId);
  if (!agentState || agentState.role !== 'work') {
    return { agentMessageSent: false, ...testGateFlag };
  }

  // Debounce per head SHA so duplicate webhook deliveries / retries do not spam.
  // A test-gate failure is the exception once per head: an earlier generic
  // "CI FAILED" (a faster non-test check) must not swallow the rework message.
  const lastSha = lastNotifiedSha.get(issueId);
  const testGateAlreadyNotified = lastNotifiedTestGateSha.get(issueId) === opts.headSha;
  if (lastSha === opts.headSha && (!testGateFailed || testGateAlreadyNotified)) {
    console.log(`[ci-failure-feedback] Skipping duplicate feedback for ${issueId} @ ${opts.headSha.slice(0, 8)}`);
    return { agentMessageSent: false, ...testGateFlag };
  }

  const { owner, repo } = parseRepo(opts.repo);

  // Diff against main's current failing checks so agents do not chase inherited failures.
  const mainRuns = await listFailingRuns(owner, repo, 'main');
  const mainFailingNames = new Set(mainRuns.map((r) => r.name || r.workflowName || `run-${r.databaseId}`));

  // Collect the concrete failures for this PR head.
  const failures = await collectFailures(owner, repo, opts.headRef, opts.headSha, mainFailingNames);

  // If we cannot find any failing workflow run for this SHA, still write a short
  // feedback file for explicit status events and authoritative polling so the
  // agent is not left in the dark.
  if (
    failures.length === 0
    && !opts.source.startsWith('status:')
    && opts.source !== 'polling_reconciliation'
  ) {
    console.log(
      `[ci-failure-feedback] No failing runs found for ${issueId} @ ${opts.headSha.slice(0, 8)}; skipping feedback`,
    );
    return { agentMessageSent: false, ...testGateFlag };
  }

  const markdownBody = buildFeedbackBody({
    issueId,
    repo: opts.repo,
    prNumber: opts.prNumber,
    headSha: opts.headSha,
    prUrl: opts.prUrl,
    failures,
    source: opts.source,
    testGateFailed,
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
    return { agentMessageSent: false, ...testGateFlag };
  }

  let agentMessageSent = false;
  const message = testGateFailed
    ? `VERIFICATION FAILED for ${issueId}.\nFailed check: ${TEST_GATE_NAME} — the CI test job failed on PR head ${opts.headSha.slice(0, 8)}.\n\n` +
      `MUST READ: ${fileResult.filePath}\n\n` +
      'Use your Read tool to open this file, read every line, reproduce each failure with `npx vitest run <failing files>`, ' +
      'fix it, commit, and invoke /rebase-and-submit. Do NOT stop at the prompt.'
    : `SPECIALIST FEEDBACK: ci-monitor reported CI FAILED for ${issueId}.\n\n` +
      `MUST READ: ${fileResult.filePath}\n\n` +
      'Use your Read tool to open this file, read every line, then fix ALL failing checks. Do NOT stop at the prompt.';
  try {
    // PAN-3965: a red CI test job is the test gate failing, so the agent owes
    // rework — the same re-drive contract as local verification feedback.
    const outcome = await messageAgent(
      agentId,
      message,
      'internal',
      testGateFailed ? { owesRework: true, feedbackRedelivery: true } : {},
    );
    // messageAgent reports a failed delivery as `delivered: false` rather than
    // throwing (PR #3874), so success is the outcome, not the absence of a throw.
    agentMessageSent = outcome?.delivered === true;
    if (!agentMessageSent) {
      console.warn(
        `[ci-failure-feedback] Message to ${agentId} was not delivered (${outcome?.reason ?? 'no delivery outcome'}); feedback file remains at ${fileResult.filePath}`,
      );
    }
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not message ${agentId}; feedback file remains available: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  lastNotifiedSha.set(issueId, opts.headSha);
  if (testGateFailed) lastNotifiedTestGateSha.set(issueId, opts.headSha);
  return { feedbackPath: fileResult.filePath, agentMessageSent, ...testGateFlag };
}

/** Effect variant of {@link relayCiFailureFeedbackPromise}. */
export const relayCiFailureFeedback = (
  opts: CiFailureFeedbackOptions,
  deps: CiFailureFeedbackDeps = {},
): Effect.Effect<CiFailureFeedbackResult> => Effect.promise(() => relayCiFailureFeedbackPromise(opts, deps));
