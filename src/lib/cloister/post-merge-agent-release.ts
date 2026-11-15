/**
 * Free a merged issue's agents (PAN-5396): pause its work, planning and strike
 * agents and close their terminals.
 *
 * `postMergeLifecycle` runs this first, before any Docker or tracker step. The
 * PR has merged, and that alone decides that these agents are done. A failed
 * tracker write, or a dashboard restart part-way through the lifecycle, must
 * not leave a merged agent alive and idle. An agent left that way holds a work
 * slot and makes close-out refuse with "running agents".
 */
import { Effect } from 'effect';

export const POST_MERGE_PAUSE_REASON = 'awaiting close-out (verify on main)';

type LogActivity = (action: string, details: string) => void;

/** Close the agent's terminal through the terminal backend; a thrown close reads as not closed. */
async function tryCloseAgentTerminal(agentId: string): Promise<boolean> {
  try {
    const { closeAgentPane } = await import('../terminal-backends/launch.js');
    return await closeAgentPane(agentId);
  } catch (err) {
    console.warn(`[merge-agent] Could not close ${agentId} terminal: ${err}`);
    return false;
  }
}

async function paneIsLive(agentId: string): Promise<boolean> {
  try {
    const { isAlive } = await import('../agents/liveness.js');
    return (await isAlive(agentId)).alive;
  } catch {
    return false;
  }
}

/**
 * Close the terminal. A false close is normal when the agent has no pane (a
 * planning agent that already exited). When the pane is still live, log an
 * error and retry once, the same way the pause is verified.
 */
async function closeAgentTerminal(agentId: string, logActivity: LogActivity): Promise<boolean> {
  if (await tryCloseAgentTerminal(agentId)) return true;
  if (!(await paneIsLive(agentId))) return false;
  console.error(`[merge-agent] ✗ Could not close the live ${agentId} terminal after merge; retrying once`);
  if (await tryCloseAgentTerminal(agentId)) return true;
  console.error(`[merge-agent] ✗ FAILED to close the live ${agentId} terminal after merge — close-out will report it as a running agent`);
  logActivity('agent_session_kill_failed', `Could not close the live terminal for ${agentId} after merge`);
  return false;
}

export async function releaseMergedIssueAgents(issueId: string, logActivity: LogActivity): Promise<void> {
  try {
    const { setAgentPaused, getAgentState, markAgentStoppedState, saveAgentState } = await import('../agents.js');
    const issueLower = issueId.toLowerCase();
    const reason = POST_MERGE_PAUSE_REASON;
    for (const agentId of [`agent-${issueLower}`, `planning-${issueLower}`, `strike-${issueLower}`]) {
      // Pause, then VERIFY the gate actually persisted to state.json. A
      // concurrent deacon read-modify-write on state.json can silently drop the
      // pause. An unpaused merged work agent sits idle at its prompt yet still
      // counts against the PAN-1665 work ceiling, throttling dispatch for every
      // live issue (PAN-1726). Assert paused=true after the write; retry once,
      // then fail loudly.
      const initial = await Effect.runPromise(setAgentPaused(agentId, reason, true));
      if (initial === null) {
        // No state.json for this agent — nothing to pause (e.g. planning never ran).
        continue;
      }
      let verify = getAgentState(agentId);
      if (verify?.paused !== true) {
        await Effect.runPromise(setAgentPaused(agentId, reason, true));
        verify = getAgentState(agentId);
      }
      if (verify?.paused === true) {
        console.log(`[merge-agent] ✓ Paused ${agentId}: ${reason}`);
      } else {
        console.error(
          `[merge-agent] ✗ FAILED to persist pause for ${agentId} after merge — state.json paused=${verify?.paused}. ` +
          `Idle merged work agent may hold a PAN-1665 work slot and throttle dispatch (PAN-1726).`,
        );
        logActivity('agent_pause_failed', `Could not persist pause for ${agentId} after merge — may throttle dispatch (PAN-1726)`);
      }
      // PAN-3947: close through the terminal backend — `kill-session` on
      // tmux, `pane.close` on Herdr. A tmux-only kill left every Herdr pane
      // (and the idle harness in it) alive, so close-out's DoD row 5 still
      // saw a running work agent.
      if (await closeAgentTerminal(agentId, logActivity)) {
        console.log(`[merge-agent] ✓ Closed ${agentId} terminal to free resources`);
        logActivity('agent_session_killed', `Freed resources: closed terminal for ${agentId}`);
        // PAN-5112: this close is the agent's stop. Record it, or the crash
        // watcher sees a running agent with no pane and pushes a false crash.
        try {
          const closed = getAgentState(agentId);
          if (closed) {
            markAgentStoppedState(closed, 'system');
            await Effect.runPromise(saveAgentState(closed));
          }
        } catch (err) {
          console.warn(`[merge-agent] Could not record ${agentId} as stopped: ${err}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[merge-agent] Could not pause or kill agent sessions: ${err}`);
  }
}
