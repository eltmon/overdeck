import { Effect } from 'effect';
import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { clearAgentPaused, getAgentState, resolveAgentTarget } from '../../lib/agents.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';
import { getWorkAgentLifecycleState } from '../../lib/work-agent-lifecycle.js';
import { resumeAgent } from '../../lib/agents/resume.js';
import {
  restartIssueAfterUnpause,
  reviewRequestOutcomeFromRoute,
  type ReviewRequestOutcome,
} from '../../lib/agents/issue-pause.js';
import { requestReviewViaDashboard } from './request-review.js';

/** The review-request door from the CLI: the dashboard route `pan review request` uses. */
async function requestReviewFromCli(issueId: string): Promise<ReviewRequestOutcome> {
  const response = await requestReviewViaDashboard(issueId, 'review re-requested after pan unpause', 120_000, 'pan-unpause');
  if (response.kind === 'unreachable') return { requested: false, reason: `dashboard unreachable (${response.error})` };
  return reviewRequestOutcomeFromRoute(response.kind === 'ok', response.status, response.result);
}

export async function unpauseCommand(id: string): Promise<void> {
  // PAN-1760: resolve through normalizeAgentId so full agent IDs
  // (strike-pan-1723, inspect-…, agent-…-ship) are addressable, not just issue IDs.
  const agentId = resolveAgentTarget(id);
  if (!agentId) {
    console.error(chalk.red(`Could not resolve agent target "${id}"`));
    console.error(chalk.dim(
      'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.overdeck/agents/',
    ));
    return exitCli(1);
  }
  const state = getAgentState(agentId);

  if (!state) {
    console.error(chalk.red(`Agent ${agentId} not found.`));
    return exitCli(1);
  }
  const issueId = state.issueId;

  try {
    const wasPaused = state.paused === true;
    await Effect.runPromise(clearAgentPaused(agentId));

    if (wasPaused) {
      await appendOperatorInterventionEvent({ issueId, kind: 'unpause', source: 'pan unpause' });
      console.log(chalk.green(`Unpaused agent: ${agentId}`));
    } else {
      console.log(chalk.dim(`Agent ${agentId} is already unpaused.`));
    }

    // PAN-3911: when the issue pause stopped review or test agents, start them
    // again through the normal doors before the work agent resumes: a fresh
    // review request (new synthesis parent and convoy for the current head),
    // never convoy recovery against the stopped parent.
    const restart = await restartIssueAfterUnpause(state, { requestReview: requestReviewFromCli });
    if (restart?.review) {
      if (restart.review.requested) {
        console.log(chalk.green(`Re-requested review for ${issueId}: the pause had stopped its reviewers.`));
      } else if (restart.review.noReviewNeeded) {
        console.log(chalk.dim(`No review re-requested for ${issueId}: ${restart.review.reason}`));
      } else {
        console.error(chalk.red(`Review not re-requested for ${issueId}: ${restart.review.reason}`));
        console.error(chalk.dim(`Run pan review request ${issueId} to start it again.`));
        process.exitCode = 1;
      }
    } else if (restart?.test) {
      if (restart.test.dispatched) {
        console.log(chalk.green(`Re-dispatched the ${issueId} test agent: the pause had stopped it.`));
      } else {
        console.error(chalk.red(`Test agent not re-dispatched for ${issueId}: ${restart.test.reason}`));
        process.exitCode = 1;
      }
    }

    // Resume immediately — unpause means "go now", not "wait for the Deacon's
    // next patrol". Only when there is actually a session to resume; a plain
    // stopped agent with no session is pointed at pan start instead.
    if (wasPaused && (await getWorkAgentLifecycleState(agentId)).canResumeSession) {
      console.log(chalk.dim('Resuming now…'));
      const result = await resumeAgent(agentId);
      if (result.success) {
        console.log(chalk.green(`Agent ${agentId} resumed.`));
      } else {
        console.error(chalk.red(`Resume failed: ${result.error ?? 'unknown error'}`));
        console.error(chalk.dim(`Run pan start ${issueId} to spawn a fresh agent.`));
        process.exitCode = 1;
      }
    } else if (wasPaused) {
      console.log(chalk.dim(`No saved session to resume — run pan start ${issueId} to spawn now.`));
    }
  } catch (error: any) {
    console.error(chalk.red('Error: ' + error.message));
    return exitCli(1);
  }
}
