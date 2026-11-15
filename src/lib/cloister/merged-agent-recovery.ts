/**
 * Finish post-merge lifecycles that a dashboard restart cut short (PAN-5396).
 *
 * `postMergeLifecycle` runs in the dashboard process and nothing records that
 * it is in flight. When the dashboard restarts during a run (a `pan reload`
 * right after a merge), the rest of the run is lost: the merged work agent
 * stays alive and idle, and close-out refuses with "running agents". This was
 * observed for PAN-5357 and PAN-5349 on 2026-11-15.
 *
 * At boot, the dashboard calls this once. It finds work and planning agents
 * that are still live although their issue's PR merged after they started, and
 * runs the lifecycle again for those issues. The lifecycle is idempotent and
 * skips closed-out issues.
 *
 * An agent counts as a leftover only when its last launch AND its last work
 * activity both predate the merge. The launch is `startedAt`, `lastResumeAt`
 * and the state file's `lastActivity`, which `markAgentRunning` stamps on a
 * restart or recover (except for codex). The work activity is the hook-driven
 * runtime mirror plus the transcript heartbeat (`idleAgeMs`). So a reopened
 * issue's new agent, or an agent the operator relaunched after the merge, is
 * left alone. The predicate is the one close-out's DoD row 5 uses
 * (`dod-post-merge-row.ts`): role work/plan, stored status starting/running,
 * and live by the liveness oracle.
 */
import type { AgentState } from '../agents/agent-state-read.js';
import type { LivenessVerdict } from '../agents/liveness.js';

/** Let the server, the terminal backend and the runtime census settle before reading liveness. */
export const MERGED_AGENT_RECOVERY_DELAY_MS = 30_000;

type AgentRow = Pick<AgentState, 'id' | 'issueId' | 'role' | 'status' | 'startedAt' | 'lastResumeAt' | 'lastActivity'>;

export interface MergedAgentRecoveryDeps {
  listAgents: () => Promise<AgentRow[]>;
  isAlive: (agentId: string) => Promise<LivenessVerdict>;
  /** Epoch ms of the agent's last work activity, or null when there is no signal. */
  lastWorkActivityMs: (agentId: string) => Promise<number | null>;
  readMergedAt: (issueId: string) => Promise<string | undefined>;
  resolveProjectPath: (issueId: string) => Promise<string | null>;
  runLifecycle: (issueId: string, projectPath: string) => Promise<void>;
}

const defaultDeps: MergedAgentRecoveryDeps = {
  listAgents: async () => (await import('../agents/queries.js')).listAgentStates(),
  isAlive: async (agentId) => (await import('../agents/liveness.js')).isAlive(agentId),
  lastWorkActivityMs: async (agentId) => {
    const age = (await import('../agents/liveness.js')).idleAgeMs(agentId);
    return age === null ? null : Date.now() - age;
  },
  readMergedAt: async (issueId) => (await import('../lifecycle/dod-post-merge-row.js')).readPullRequestMergedAt(issueId),
  resolveProjectPath: async (issueId) => (await import('../projects.js')).resolveProjectFromIssueSync(issueId)?.projectPath ?? null,
  runLifecycle: async (issueId, projectPath) => (await import('./merge-agent.js')).postMergeLifecycle(issueId, projectPath),
};

function latestLaunchMs(agent: AgentRow): number {
  const times = [agent.startedAt, agent.lastResumeAt, agent.lastActivity]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  return times.length > 0 ? Math.max(...times) : Number.NaN;
}

/**
 * Re-run the post-merge lifecycle for every issue whose PR merged while one of
 * its agents kept running. Returns one log line per action taken or skipped.
 */
export async function recoverInterruptedPostMergeLifecycles(
  deps: MergedAgentRecoveryDeps = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];

  const claimedLive = (await deps.listAgents()).filter((agent) =>
    (agent.role === 'work' || agent.role === 'plan') &&
    (agent.status === 'starting' || agent.status === 'running'),
  );
  const byIssue = new Map<string, AgentRow[]>();
  for (const agent of claimedLive) {
    const verdict = await deps.isAlive(agent.id).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }));
    if (!verdict.alive) {
      // An unreadable runtime at boot must not look like "nothing to do".
      if (verdict.reason === 'runtime-indeterminate') actions.push(`${agent.id}: liveness indeterminate — skipped`);
      continue;
    }
    const issueId = agent.issueId.toUpperCase();
    byIssue.set(issueId, [...(byIssue.get(issueId) ?? []), agent]);
  }

  for (const [issueId, agents] of byIssue) {
    try {
      const mergedAt = await deps.readMergedAt(issueId);
      const mergedMs = mergedAt ? Date.parse(mergedAt) : Number.NaN;
      if (!Number.isFinite(mergedMs)) continue;
      // An agent launched or working after the merge is new work (a reopened
      // issue, or an operator follow-up), not a leftover. Leave the issue alone.
      const launches = agents.map(latestLaunchMs);
      const work = await Promise.all(agents.map((agent) => deps.lastWorkActivityMs(agent.id).catch(() => null)));
      if (launches.some((ms) => !Number.isFinite(ms) || ms >= mergedMs) || work.some((ms) => ms !== null && ms >= mergedMs)) {
        actions.push(`${issueId}: PR merged at ${mergedAt}, but ${agents.map((a) => a.id).join(', ')} launched or worked after it — left running`);
        continue;
      }
      const projectPath = await deps.resolveProjectPath(issueId);
      if (!projectPath) {
        actions.push(`${issueId}: merged agents still live, but the project path could not be resolved — left running`);
        continue;
      }
      actions.push(`${issueId}: PR merged at ${mergedAt} while ${agents.map((a) => a.id).join(', ')} kept running — re-running the post-merge lifecycle`);
      await deps.runLifecycle(issueId, projectPath);
    } catch (err) {
      actions.push(`${issueId}: post-merge recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return actions;
}

/** Boot hook for the dashboard: run the recovery once after a delay, without blocking startup. */
export function scheduleMergedAgentRecovery(delayMs = MERGED_AGENT_RECOVERY_DELAY_MS): void {
  const handle = setTimeout(() => {
    recoverInterruptedPostMergeLifecycles()
      .then((actions) => { for (const action of actions) console.log(`[merged-agent-recovery] ${action}`); })
      .catch((err) => console.warn(`[merged-agent-recovery] sweep failed: ${err instanceof Error ? err.message : String(err)}`));
  }, delayMs);
  handle.unref?.();
}
