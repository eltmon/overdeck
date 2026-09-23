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
 *   It is recorded as a per-run verification artifact (`via: 'ci'`), counted
 *   against the same attempt budget as the local gate (verification-cycles),
 *   journaled as `verification.failed { failedCheck: 'test', cycleCount }`,
 *   escalated with the local gate's stuck pause, and delivered through the
 *   local gate's feedback door. A green CI test job records the reset.
 * - Review of #3993: only a `feature/` head is the work agent's test gate
 *   (strike and bypass PRs are not counted); cancelled, timed-out and other
 *   infrastructure conclusions are not counted, nor is a test check that is
 *   failing on the default branch too; relays for one issue run one at a time,
 *   so concurrent webhooks for one red head count it once; and a replayed
 *   report for a head already recorded is never re-delivered.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { getAgentStateSync, messageAgent } from '../agents.js';
import { findProjectByPathSync, resolveProjectFromIssueSync } from '../projects.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { appendPipelineEntry } from './pipeline-journal.js';
import type { FailedCheck, PrFacts } from './pr-facts.js';
import { writeVerificationArtifact } from './verification-artifact.js';
import {
  isFinalVerificationAttempt,
  readCiTestFailureStreak,
  readLatestCiTestResult,
  readVerificationCycleState,
  shouldEscalateVerificationFailure,
  VERIFICATION_MAX_CYCLES,
} from './verification-cycles.js';
import { buildFinalFailureInstructions } from './verification-feedback.js';
import { readDefaultBranchFailingTestChecks } from './ci-default-branch-tests.js';
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
  /** PAN-3965: attempts counted against the verification budget, this failure included. */
  cycleCount?: number;
  /** PAN-3965: this failure exhausted the budget and paused the work agent. */
  escalated?: boolean;
}

/** PAN-3965: a CI test-gate failure as counted against the verification budget. */
interface CiTestGateFailure {
  cycleCount: number;
  escalate: boolean;
  /** The workspace the record goes to; absent when it no longer exists. */
  workspacePath?: string;
}

export interface CiFailureFeedbackDeps {
  /** Fresh forge read of the PR; defaults to an uncached `getPrFacts`. */
  readPrFacts?: (issueId: string) => Promise<PrFacts>;
  /**
   * Names of the test checks failing on the newest default-branch commit whose
   * test checks finished (`owner/repo`); null when unknown. Defaults to
   * `ci-default-branch-tests.ts`.
   */
  readDefaultBranchFailingTestChecks?: (repo: string) => Promise<ReadonlySet<string> | null>;
  /** Surface a needs-you row; defaults to `feedback-target.ts`. */
  surfaceNeedsYou?: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
}

/** Per-issue head SHA we last sent CI failure feedback for. */
const lastNotifiedSha = new Map<string, string>();
/** Per-issue head SHA we last journaled a CI test-gate failure for. */
const lastJournaledTestFailureSha = new Map<string, string>();
/**
 * Review of #3993: the tail of each issue's relay queue. Webhook dispatch is
 * forked, so the shards of one red test job arrive together; every check-then-
 * record step below spans awaits, and only running one relay per issue at a
 * time makes "count this head once" hold.
 */
const issueQueues = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier relay for `issueId` has settled. */
async function withIssueQueue<T>(issueId: string, fn: () => Promise<T>): Promise<T> {
  const previous = issueQueues.get(issueId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => undefined);
  issueQueues.set(issueId, tail);
  try {
    return await run;
  } finally {
    if (issueQueues.get(issueId) === tail) issueQueues.delete(issueId);
  }
}

/** Reset internal debounce state — for tests only. */
export function resetCiFailureFeedbackStateForTests(): void {
  lastNotifiedSha.clear();
  lastJournaledTestFailureSha.clear();
  issueQueues.clear();
}

/** Review of #3993: only `feature/<issue>` is the work agent's branch; strike and bypass PRs are not its gate. */
function isFeatureHead(headRef: string | undefined): boolean {
  return (headRef ?? '').toLowerCase().startsWith('feature/');
}

/**
 * Review of #3993: conclusions that are a verdict on the code. CANCELLED,
 * TIMED_OUT, STARTUP_FAILURE, STALE and ACTION_REQUIRED say the runner or the
 * workflow did not finish, not that a test failed; they never use an attempt.
 */
const COUNTED_TEST_CONCLUSIONS = new Set(['FAILURE', 'ERROR']);

/**
 * Why a red test job on this head does not use an attempt, or null when it
 * does. `testCheckFailures` absent (no per-check detail) counts, as before.
 */
async function uncountedTestFailureReason(
  failures: readonly FailedCheck[] | undefined,
  repo: string,
  deps: CiFailureFeedbackDeps,
): Promise<string | null> {
  if (!failures || failures.length === 0) return null;
  const counted = failures.filter((check) => COUNTED_TEST_CONCLUSIONS.has(check.conclusion.toUpperCase()));
  if (counted.length === 0) {
    return `only infrastructure conclusions (${failures.map((c) => `${c.name}: ${c.conclusion}`).join(', ')})`;
  }
  const onDefaultBranch = await (deps.readDefaultBranchFailingTestChecks ?? readDefaultBranchFailingTestChecks)(repo);
  // Review of #4017: while the default branch's tests are still running (or
  // unreadable) nobody can say the failure is this PR's; spend no attempt.
  if (onDefaultBranch === null) return 'the default branch\'s test verdict is unknown (no finished test run)';
  if (counted.every((check) => onDefaultBranch.has(check.name))) {
    return `inherited from the default branch (${counted.map((c) => c.name).join(', ')} failing there too)`;
  }
  return null;
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

function workspaceFor(issueId: string): { projectPath?: string; workspacePath?: string } {
  const resolved = resolveProjectFromIssueSync(issueId);
  return resolved
    ? {
      projectPath: resolved.projectPath,
      workspacePath: join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`),
    }
    : {};
}

function isCiTestsProject(projectPath: string | undefined): boolean {
  return Boolean(projectPath) && resolveVerificationTestsMode(findProjectByPathSync(projectPath!)) === 'ci';
}

/**
 * PAN-3965: when the project's tests run on CI and the PR head's test job is
 * red, assess the verification test-gate failure: the attempt count and
 * whether it exhausts the budget. Nothing is written here; the relay records
 * it ({@link recordCiTestGateFailure}) once its feedback file exists, so a
 * failure to write the feedback leaves the head unrecorded and a later report
 * retries it (review of #4017).
 *
 * The count is the larger of the local per-head count (verification-cycles:
 * failed runs at this head, local or CI) and the run of consecutive red CI
 * heads. Escalation uses the local gate's rule on the per-head count and the
 * same `VERIFICATION_MAX_CYCLES` budget on the consecutive-heads count.
 *
 * Returns null when this is not a counted test-gate failure (not a feature
 * head, not red, an infrastructure conclusion, inherited from the default
 * branch), `repeat` when this head's failure was already recorded (duplicate
 * webhooks, a restart). Callers hold the issue's relay queue.
 */
async function assessCiTestGateFailure(
  issueId: string,
  opts: CiFailureFeedbackOptions,
  projectPath: string | undefined,
  workspacePath: string | undefined,
  deps: CiFailureFeedbackDeps,
): Promise<CiTestGateFailure | 'repeat' | null> {
  if (!isFeatureHead(opts.headRef)) return null;
  if (!isCiTestsProject(projectPath)) return null;
  const head8 = opts.headSha.slice(0, 8);
  const hasWorkspace = Boolean(workspacePath) && existsSync(workspacePath!);
  if (lastJournaledTestFailureSha.get(issueId) === opts.headSha) return 'repeat';
  if (hasWorkspace && readLatestCiTestResult(workspacePath!, head8) === 'failed') return 'repeat';

  let facts: PrFacts;
  try {
    facts = await (deps.readPrFacts ?? readFreshPrFacts)(issueId);
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not read PR checks for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (facts.testChecks !== 'red') return null;
  // A late webhook for an older head is not a verdict on the current one.
  if (facts.headSha && facts.headSha !== opts.headSha) return null;
  const uncounted = await uncountedTestFailureReason(facts.testCheckFailures, opts.repo, deps);
  if (uncounted) {
    console.log(`[ci-failure-feedback] Not counting the red CI test job for ${issueId} @ ${head8}: ${uncounted}`);
    return null;
  }

  // The journal and the attempt record die with the workspace; never recreate it.
  if (!hasWorkspace) return { cycleCount: 1, escalate: false };

  const perHead = readVerificationCycleState(workspacePath!, head8);
  const streak = readCiTestFailureStreak(workspacePath!);
  const perHeadCount = perHead.cycleCount + 1;
  const streakCount = streak.cycleCount + 1;
  const cycleCount = Math.max(perHeadCount, streakCount);
  const escalate = isFinalVerificationAttempt(streakCount)
    || shouldEscalateVerificationFailure(perHead, TEST_GATE_NAME, perHeadCount);
  return { cycleCount, escalate, workspacePath: workspacePath! };
}

/**
 * Record an assessed CI test-gate failure: the in-process memo, a per-run
 * artifact (`via: 'ci'`) and the `verification.failed` journal entry. From
 * here on, this head is a `repeat`.
 */
function recordCiTestGateFailure(
  issueId: string,
  opts: CiFailureFeedbackOptions,
  counted: CiTestGateFailure,
): void {
  lastJournaledTestFailureSha.set(issueId, opts.headSha);
  const { workspacePath, cycleCount } = counted;
  if (!workspacePath) return;
  const head8 = opts.headSha.slice(0, 8);
  // Review of #3993: like the pass below, a CI result is a per-run record
  // only; verification-latest.json stays the local gate run's record.
  try {
    writeVerificationArtifact(workspacePath, issueId, [{
      name: TEST_GATE_NAME,
      passed: false,
      required: true,
      durationMs: 0,
      output: `CI test job failed on PR head ${opts.headSha} (${opts.source})${opts.prUrl ? `: ${opts.prUrl}` : ''}`,
    }], { ranAt: new Date().toISOString(), head8, via: 'ci', updateLatest: false });
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not record the CI test failure for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  appendPipelineEntry(workspacePath, {
    type: 'verification.failed',
    issueId,
    source: `ci:${opts.source}`,
    data: {
      failedCheck: TEST_GATE_NAME,
      cycleCount,
      head: head8,
      via: 'ci',
      prNumber: opts.prNumber,
    },
  });
}

async function surfaceNeedsYou(
  issueId: string,
  reason: string,
  details: Record<string, unknown>,
  deps: CiFailureFeedbackDeps,
): Promise<void> {
  try {
    if (deps.surfaceNeedsYou) {
      await deps.surfaceNeedsYou(issueId, reason, details);
      return;
    }
    const { surfaceIssueFeedbackNeedsYou } = await import('./feedback-target.js');
    await surfaceIssueFeedbackNeedsYou(issueId, reason, details);
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not surface needs-you for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * PAN-3965: a green CI test job on the PR head resets the consecutive-red-heads
 * count. Recorded as a passed per-run artifact (`via: 'ci'`); the dashboard's
 * latest verification record is left as the local gate wrote it.
 */
async function recordCiTestGatePassPromise(
  opts: CiTestGatePassOptions,
  deps: CiFailureFeedbackDeps = {},
): Promise<boolean> {
  const issueId = opts.issueId.toUpperCase();
  // A strike or bypass PR's green test job says nothing about the feature branch.
  if (!isFeatureHead(opts.headRef)) return false;
  const { projectPath, workspacePath } = workspaceFor(issueId);
  if (!isCiTestsProject(projectPath) || !workspacePath || !existsSync(workspacePath)) return false;
  const head8 = opts.headSha.slice(0, 8);
  if (readLatestCiTestResult(workspacePath, head8) === 'passed') return false;

  let facts: PrFacts;
  try {
    facts = await (deps.readPrFacts ?? readFreshPrFacts)(issueId);
  } catch {
    return false;
  }
  // Every leg of the test job must be green on this exact head.
  if (facts.testChecks !== 'green' || (facts.headSha && facts.headSha !== opts.headSha)) return false;

  try {
    writeVerificationArtifact(workspacePath, issueId, [{
      name: TEST_GATE_NAME,
      passed: true,
      required: true,
      durationMs: 0,
      output: '',
    }], { ranAt: new Date().toISOString(), head8, via: 'ci', updateLatest: false });
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not record the CI test pass for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
  return true;
}

export interface CiTestGatePassOptions {
  issueId: string;
  headSha: string;
  /** The PR's head branch; only `feature/<issue>` records a pass. */
  headRef: string;
  source: string;
}

/** Effect variant of {@link recordCiTestGatePassPromise}. */
export const recordCiTestGatePass = (
  opts: CiTestGatePassOptions,
  deps: CiFailureFeedbackDeps = {},
): Effect.Effect<boolean> => Effect.promise(() =>
  withIssueQueue(opts.issueId.toUpperCase(), () => recordCiTestGatePassPromise(opts, deps)));

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
      'is the verification test gate. Reproduce with the project\'s test runner scoped to the failing test files; ' +
      'do not run the full suite locally.\n\n';
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

/**
 * PAN-3965: escalate and deliver a CI test-gate failure exactly as the local
 * verification gate does — the stuck pause at the budget, then the
 * verification feedback door (owes rework, slot resolution, resurrection,
 * needs-you when nothing can be reached).
 */
async function deliverCiTestGateFeedback(
  issueId: string,
  opts: CiFailureFeedbackOptions,
  feedbackPath: string,
  counted: CiTestGateFailure,
  deps: CiFailureFeedbackDeps,
): Promise<boolean> {
  // Lazy: the delivery door pulls in the terminal backend and agent liveness.
  const {
    announceVerificationFailure,
    deliverVerificationFeedback,
    escalateVerificationStuck,
  } = await import('./verification-escalation.js');
  const head8 = opts.headSha.slice(0, 8);
  const { cycleCount } = counted;
  const summary = `CI test job failed on PR head ${head8} (attempt ${cycleCount}/${VERIFICATION_MAX_CYCLES}).\n\nFeedback: ${feedbackPath}`;
  announceVerificationFailure(issueId, TEST_GATE_NAME, summary);
  if (counted.escalate) {
    await escalateVerificationStuck(issueId, TEST_GATE_NAME, cycleCount, summary, 'ci-failure-feedback');
  }
  const message = counted.escalate
    ? `VERIFICATION STUCK for ${issueId}.\nFailed check: ${TEST_GATE_NAME} — the CI test job failed on ${cycleCount} attempts.\n\n` +
      `MUST READ: ${feedbackPath}\n\n${buildFinalFailureInstructions(issueId)}`
    : `VERIFICATION FAILED for ${issueId} (attempt ${cycleCount}/${VERIFICATION_MAX_CYCLES}).\n` +
      `Failed check: ${TEST_GATE_NAME} — the CI test job failed on PR head ${head8}.\n\n` +
      `MUST READ: ${feedbackPath}\n\n` +
      'Use your Read tool to open this file, read every line, reproduce each failure with the project\'s test runner ' +
      'scoped to the failing test files, fix it, commit, and invoke /rebase-and-submit. Do NOT stop at the prompt.';
  try {
    // Review of #3993: sent only when the door says the message was delivered,
    // not when it surfaced needs-you or skipped a merged PR.
    return await deliverVerificationFeedback(issueId, message, { failedCheck: TEST_GATE_NAME, feedbackPath, via: 'ci' }, 'ci-failure-feedback');
  } catch (err) {
    console.warn(
      `[ci-failure-feedback] Could not deliver the CI test failure for ${issueId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    // The head is recorded, so no later report re-delivers it: say so now.
    await surfaceNeedsYou(issueId, `CI test failure feedback for ${head8} was not delivered: ${err instanceof Error ? err.message : String(err)}`, {
      specialist: 'verification-gate', failedCheck: TEST_GATE_NAME, feedbackPath, via: 'ci',
    }, deps);
    return false;
  }
}

async function relayCiFailureFeedbackPromise(
  opts: CiFailureFeedbackOptions,
  deps: CiFailureFeedbackDeps = {},
): Promise<CiFailureFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();

  const { projectPath, workspacePath } = workspaceFor(issueId);

  // PAN-3965: record a CI test-gate failure whether or not an agent is live —
  // the journal and the attempt count record what happened to the PR, not who
  // was told.
  const gate = await assessCiTestGateFailure(issueId, opts, projectPath, workspacePath, deps);
  if (gate === 'repeat') {
    // Review of #3993: the per-run record says this head was counted and its
    // feedback sent. A replay (duplicate webhook, a restart) delivers nothing:
    // re-sending would re-open rework past the budget and lift a stuck pause.
    console.log(`[ci-failure-feedback] CI test failure for ${issueId} @ ${opts.headSha.slice(0, 8)} already recorded; not re-delivering`);
    return { agentMessageSent: false, testGateFailed: true };
  }
  const counted = gate ?? undefined;
  const testGateFailed = counted !== undefined;
  const testGateFlag = counted
    ? { testGateFailed: true, cycleCount: counted.cycleCount, escalated: counted.escalate }
    : {};

  // Only relay for work agents. The feedback file/message would not be useful
  // for plan/review/test/ship/strike roles. A test-gate failure is verification
  // feedback: it goes through the local gate's delivery door, which finds the
  // work agent (or slot) and resurrects it, so no role check applies.
  const agentId = agentIdForIssue(issueId);
  const agentState = getAgentStateSync(agentId);
  if (!testGateFailed && (!agentState || agentState.role !== 'work')) {
    return { agentMessageSent: false, ...testGateFlag };
  }

  // Debounce per head SHA so duplicate webhook deliveries / retries do not spam.
  // A newly counted test-gate failure is the exception: an earlier generic
  // "CI FAILED" (a faster non-test check) must not swallow the rework message.
  const lastSha = lastNotifiedSha.get(issueId);
  if (lastSha === opts.headSha && !testGateFailed) {
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
  // PAN-3965: a test-gate failure is known from the PR checks, so it is always
  // delivered (and escalated) even when no run log could be found.
  if (
    failures.length === 0
    && !testGateFailed
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
    if (counted) {
      // Review of #4017: nothing is recorded yet, so the next report for this
      // head retries the count and the delivery. Until then, a person knows.
      await surfaceNeedsYou(issueId, `CI test failure on ${opts.headSha.slice(0, 8)}: could not write the feedback file (${fileResult.error ?? 'unknown error'})`, {
        specialist: 'verification-gate', failedCheck: TEST_GATE_NAME, via: 'ci',
      }, deps);
      return { agentMessageSent: false };
    }
    return { agentMessageSent: false, ...testGateFlag };
  }

  if (counted) {
    recordCiTestGateFailure(issueId, opts, counted);
    const agentMessageSent = await deliverCiTestGateFeedback(issueId, opts, fileResult.filePath, counted, deps);
    lastNotifiedSha.set(issueId, opts.headSha);
    return { feedbackPath: fileResult.filePath, agentMessageSent, ...testGateFlag };
  }

  let agentMessageSent = false;
  const message =
    `SPECIALIST FEEDBACK: ci-monitor reported CI FAILED for ${issueId}.\n\n` +
      `MUST READ: ${fileResult.filePath}\n\n` +
      'Use your Read tool to open this file, read every line, then fix ALL failing checks. Do NOT stop at the prompt.';
  try {
    const outcome = await messageAgent(agentId, message, 'internal', {});
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
  return { feedbackPath: fileResult.filePath, agentMessageSent, ...testGateFlag };
}

/** Effect variant of {@link relayCiFailureFeedbackPromise}; one relay per issue at a time. */
export const relayCiFailureFeedback = (
  opts: CiFailureFeedbackOptions,
  deps: CiFailureFeedbackDeps = {},
): Effect.Effect<CiFailureFeedbackResult> => Effect.promise(() =>
  withIssueQueue(opts.issueId.toUpperCase(), () => relayCiFailureFeedbackPromise(opts, deps)));
