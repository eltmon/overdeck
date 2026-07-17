import { Effect } from 'effect';
import { messageAgent } from '../agents.js';
import { getFlywheelActiveRunId, isFlywheelGloballyPaused } from '../overdeck/control-settings.js';
import { sessionExists } from '../tmux.js';
import { recordDeaconNudge } from './deacon-nudge-log.js';
import { FLYWHEEL_ORCHESTRATOR_AGENT_ID } from './flywheel.js';
import type { PromoteResult } from './uat-promote.js';

type SessionExists = (name: string) => boolean | Promise<boolean>;

export interface NotifyDeps {
  getActiveRunId?: typeof getFlywheelActiveRunId;
  isPaused?: typeof isFlywheelGloballyPaused;
  sessionExists?: SessionExists;
  message?: typeof messageAgent;
  recordNudge?: typeof recordDeaconNudge;
}

function buildPromoteNudge(result: Extract<PromoteResult, { success: true }>): string {
  const members = result.members.length > 0 ? result.members.join(', ') : '(no members recorded)';
  return (
    `The operator just promoted UAT generation ${result.generation} to main at ${result.mergeSha}. ` +
    `Run a fresh Observe->Act loop NOW. Fetch GET /api/registered-projects, then for every returned ` +
    `project key call GET /api/pipeline/membership?project=<URL-encoded-project-key>. Combine the responses ` +
    `and re-derive activePipeline from only rows where inPipeline === true; clean_terminal rows are audit-only ` +
    `and excluded. EXCLUDE ` +
    `the merged member(s): ${members}. Re-assemble a clean UAT batch with only members that are currently ` +
    `review+test passed, close out the promoted issue(s), emit a fresh status snapshot, and re-arm the next ` +
    `tick. Do NOT ask the operator a question, do NOT pause, and do NOT reuse the stale pre-promote ready set.`
  );
}

export async function notifyFlywheelOfUatPromote(result: PromoteResult, deps: NotifyDeps = {}): Promise<void> {
  try {
    if (result.success !== true) return;

    const getActiveRunId = deps.getActiveRunId ?? getFlywheelActiveRunId;
    const isPaused = deps.isPaused ?? isFlywheelGloballyPaused;
    const sessionExistsDep = deps.sessionExists ?? ((name: string) => Effect.runPromise(sessionExists(name)));
    const message = deps.message ?? messageAgent;
    const recordNudge = deps.recordNudge ?? recordDeaconNudge;

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
      patrol: 'uat-promote-notify',
      issueId: result.members[0] ?? result.generation,
      action: 'notified flywheel-orchestrator to re-derive ready set after UAT promote',
      reason:
        'operator promoted a UAT batch; flywheel must immediately rebuild to drop merged + regressed members before its next tick',
      state: {
        generation: result.generation,
        members: result.members,
        mergeSha: result.mergeSha,
        delivered,
      },
    });
  } catch {
    /* best-effort — promote success must never be converted into a notification failure */
  }
}
