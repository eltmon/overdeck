import { Effect } from 'effect';
import { messageAgent } from '../agents.js';
import { getFlywheelActiveRunIdSync, isFlywheelGloballyPaused } from '../overdeck/control-settings.js';
import { sessionExists } from '../tmux.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { FLYWHEEL_ORCHESTRATOR_AGENT_ID } from './flywheel.js';
import type { PromoteResult } from './uat-promote.js';

type SessionExists = (name: string) => boolean | Promise<boolean>;

export interface NotifyDeps {
  getActiveRunId?: typeof getFlywheelActiveRunIdSync;
  isPaused?: typeof isFlywheelGloballyPaused;
  sessionExists?: SessionExists;
  message?: typeof messageAgent;
  recordNudge?: typeof emitActivityEntrySync;
}

function buildPromoteNudge(result: Extract<PromoteResult, { success: true }>): string {
  const members = result.members.length > 0 ? result.members.join(', ') : '(no members recorded)';
  return (
    `The operator just promoted UAT generation ${result.generation} to main at ${result.mergeSha}. ` +
    `Run a fresh Observe->Act loop NOW. Fetch GET /api/registered-projects, then for every returned ` +
    `project key call GET /api/pipeline/membership?project=<URL-encoded-project-key>. A bare array is a ` +
    `successful answer: combine arrays and re-derive activePipeline from only rows where inPipeline === true; ` +
    `clean_terminal rows are audit-only and excluded. An object with status:'unavailable' is a typed blind spot: ` +
    `emit an investigate suggestion naming projectKey, reason, and message, and NEVER derive membership from ` +
    `tracker, agent, tmux, workspace, or review-status state. membershipQueryable:false from the registered-projects ` +
    `response is an upfront missing_issue_prefix hint, not permission to skip the read door. EXCLUDE ` +
    `the merged member(s): ${members}. Re-assemble a clean UAT batch with only members that are currently ` +
    `review+test passed, close out the promoted issue(s), emit a fresh status snapshot, and re-arm the next ` +
    `tick. Do NOT ask the operator a question, do NOT pause, and do NOT reuse the stale pre-promote ready set.`
  );
}

export async function notifyFlywheelOfUatPromote(result: PromoteResult, deps: NotifyDeps = {}): Promise<void> {
  try {
    if (result.success !== true) return;

    const getActiveRunId = deps.getActiveRunId ?? getFlywheelActiveRunIdSync;
    const isPaused = deps.isPaused ?? isFlywheelGloballyPaused;
    const sessionExistsDep = deps.sessionExists ?? ((name: string) => Effect.runPromise(sessionExists(name)));
    const message = deps.message ?? messageAgent;
    const recordNudge = deps.recordNudge ?? emitActivityEntrySync;

    if (!getActiveRunId()) return;
    if (isPaused()) return;

    const delivered = await sessionExistsDep(FLYWHEEL_ORCHESTRATOR_AGENT_ID);
    if (delivered) {
      try {
        await message(FLYWHEEL_ORCHESTRATOR_AGENT_ID, buildPromoteNudge(result), 'uat-promote-notify');
      } catch {
        /* best-effort — the nudge log below still records that the session was present */
      }
    }

    recordNudge({
      source: 'cloister',
      level: 'info',
      issueId: result.members[0] ?? result.generation,
      message: 'uat-promote-notify: told flywheel-orchestrator to re-derive its ready set after a UAT promote',
      details: JSON.stringify({
        generation: result.generation,
        members: result.members,
        mergeSha: result.mergeSha,
        delivered,
      }),
    });
  } catch {
    /* best-effort — promote success must never be converted into a notification failure */
  }
}
