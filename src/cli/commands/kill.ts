import { existsSync, readdirSync } from 'fs';
import { Effect } from 'effect';
import chalk from 'chalk';
import { stopAgentSync, getAgentStateSync, isQualifiedAgentId } from '../../lib/agents.js';
import { sessionExistsSync } from '../../lib/tmux.js';
import { isRemoteAvailable } from '../../lib/remote/index.js';
import { killRemoteAgent, loadRemoteAgentState } from '../../lib/remote/remote-agents.js';
import { resolveBareNumericIdSync } from '../../lib/issue-id.js';
import { stopWorkspaceDocker } from '../../lib/workspace-manager.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { findWorkspacePath } from '../../lib/lifecycle/archive-planning.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';
import { AGENTS_DIR } from '../../lib/paths.js';

interface KillOptions {
  force?: boolean;
}

/**
 * Enumerate every on-disk agent directory tied to a given issue ID.
 *
 * Agents are registered under several naming schemes today (see
 * src/lib/cloister/service.ts and the on-disk layout):
 *   agent-<id>                          — work
 *   agent-<id>-<role>                   — review, test, ship, merge
 *   agent-<id>-review-<specialist>      — review specialists
 *   agent-<id>-<n>                      — swarm slots (numeric suffix)
 *   planning-<id>                       — plan (legacy prefix kept for compat)
 *   strike-<id>                         — strike (PAN-1760)
 *   inspect-<id>-<bead-slug>            — bead inspection (PAN-1760)
 *
 * PAN-1526: `pan kill <ISSUE-ID>` previously only tried `agent-<id>`, so
 * planning agents, pipeline specialists, and swarm slots could not be killed
 * via the CLI at all. This walks every directory so a single invocation kills
 * the entire agent set for an issue.
 */
function findAgentIdsForIssue(issueLower: string): string[] {
  if (!existsSync(AGENTS_DIR)) return [];
  let entries: string[];
  try {
    entries = readdirSync(AGENTS_DIR);
  } catch {
    return [];
  }
  return entries.filter(name =>
    name === `agent-${issueLower}` ||
    name.startsWith(`agent-${issueLower}-`) ||
    name === `planning-${issueLower}` ||
    name === `strike-${issueLower}` ||
    name === `inspect-${issueLower}` ||
    name.startsWith(`inspect-${issueLower}-`),
  );
}

export async function killCommand(id: string, options: KillOptions): Promise<void> {
  let issueId: string;
  let agentIds: string[];

  if (isQualifiedAgentId(id)) {
    // PAN-1760: a fully-qualified agent ID (strike-pan-1723, inspect-…,
    // agent-…-ship) targets exactly that agent — no issue-wide discovery.
    const agentId = id.toLowerCase();
    agentIds = [agentId];
    issueId = getAgentStateSync(agentId)?.issueId ?? agentId;
  } else {
    const resolved = resolveBareNumericIdSync(id);
    if (!resolved) {
      console.error(chalk.red(`Could not resolve issue ID "${id}"`));
      console.error(chalk.dim(
        'Pass an issue ID like "PAN-1148" or a full agent ID like "strike-pan-1723"; the state dir must exist under ~/.panopticon/agents/',
      ));
      process.exit(1);
    }
    issueId = resolved;
    const issueLower = issueId.toLowerCase();

    // Discover every agent tied to this issue (work + plan + pipeline specialists
    // + swarm slots + strike/inspect). Fall back to the canonical work-agent name
    // if disk scan turns up empty so callers can still kill a tmux-only session.
    const discovered = findAgentIdsForIssue(issueLower);
    const workCanonical = `agent-${issueLower}`;
    agentIds = discovered.length > 0
      ? discovered
      : (sessionExistsSync(workCanonical) ? [workCanonical] : []);
  }

  if (agentIds.length === 0) {
    console.log(chalk.yellow(`No agents found for ${issueId.toUpperCase()}.`));
    return;
  }

  if (agentIds.length > 1) {
    console.log(chalk.gray(`Found ${agentIds.length} agents for ${issueId.toUpperCase()}: ${agentIds.join(', ')}`));
  }

  let firstIssueIdForDocker: string | undefined;
  let killedAny = false;

  for (const agentId of agentIds) {
    // Remote (fly.io) agents persist remote-state.json, not state.json —
    // without this fallback the remote teardown branch below never fires.
    const state = (getAgentStateSync(agentId) ?? loadRemoteAgentState(agentId)) as any;
    const isRunning = sessionExistsSync(agentId);

    if (!state && !isRunning) {
      console.log(chalk.gray(`  ${agentId}: nothing to do`));
      continue;
    }

    if (!firstIssueIdForDocker && state?.issueId) {
      firstIssueIdForDocker = state.issueId;
    }

    // Remote agents need an extra teardown step
    if (state?.location === 'remote' && state?.vmName) {
      console.log(chalk.gray(`  ${agentId}: remote on VM ${state.vmName}`));
      try {
        const availability = await isRemoteAvailable();
        if (availability.available) {
          await killRemoteAgent(agentId, state.vmName);
          console.log(chalk.green(`  ${agentId}: killed remote`));
        } else {
          console.log(chalk.yellow(`  ${agentId}: remote unavailable (${availability.reason}); cleaning local state only`));
        }
      } catch (error: any) {
        console.log(chalk.yellow(`  ${agentId}: remote cleanup failed (${error.message}); cleaning local state only`));
      }
    }

    if (!options.force && isRunning) {
      // (Confirmation prompt placeholder — pan kill is always non-interactive today.)
    }

    try {
      stopAgentSync(agentId);
      killedAny = true;
      console.log(chalk.green(`  ${agentId}: killed`));
    } catch (error: any) {
      console.error(chalk.red(`  ${agentId}: error — ${error.message}`));
    }
  }

  if (!killedAny) {
    return;
  }

  await appendOperatorInterventionEvent({ issueId, kind: 'pause', source: 'pan kill' });

  // PAN-1316/PAN-1326: tear down the workspace Docker stack so dev-server
  // containers don't outlive their owning agent. Only runs for user-initiated
  // kills — restart paths re-assert stack health separately. Run once per
  // invocation: even when multiple agents share a workspace, one teardown
  // suffices.
  const issueForDocker = firstIssueIdForDocker ?? issueId;
  try {
    const lower = issueForDocker.toLowerCase();
    const project = resolveProjectFromIssueSync(issueForDocker);
    const projectPath = project?.projectPath ?? process.cwd();
    const workspacePath = findWorkspacePath(projectPath, lower);
    if (workspacePath) {
      const dockerResult = await Effect.runPromise(stopWorkspaceDocker(workspacePath, lower));
      if (dockerResult.containersFound) {
        console.log(chalk.gray(`Stopped Docker stack: ${dockerResult.steps.join('; ')}`));
      }
    }
  } catch (err: any) {
    console.warn(chalk.yellow(`Docker teardown warning: ${err?.message ?? err}`));
  }
}
