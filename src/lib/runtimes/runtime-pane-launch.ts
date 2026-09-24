/**
 * Pane launch for the runtime-class `spawnAgent` of the muse and kimi-code
 * runtimes (PAN-3936). Their callers are Cloister's specialist rotation and
 * crash respawn (`session-rotation.ts`, `service-crash.ts`).
 *
 * The pane goes through `launchAgentPane` on the host's backend, stamped with
 * the same four tokens `spawn.ts` and `recovery.ts` stamp, so on a Herdr host it
 * lands on Herdr (where liveness looks) rather than in a tmux session that
 * `isAliveOnHerdr` reads as dead. The PTY supervisor is tmux-only: on Herdr its
 * second pseudo-terminal hides the harness from the pane's foreground process
 * (docs/TERMINAL-BACKENDS.md, "The PTY supervisor is tmux-only").
 */
import { getAgentState, saveAgentStateSync } from '../agents/agent-state.js';
import { launchAgentPane } from '../terminal-backends/launch.js';
import { toPaneRole, tokensFromLaunchMetadata } from '../terminal-backends/prompt-guard.js';
import type { AgentPaneRef, TerminalBackend } from '../terminal-backends/types.js';

/**
 * Whether a runtime launch on this backend wraps the harness in the PTY
 * supervisor. On tmux these runtimes always did, whatever the agent's role; on
 * Herdr never.
 */
export function runtimeUsesSupervisor(backend: TerminalBackend): boolean {
  return backend.name === 'tmux';
}

export interface RuntimePaneLaunch {
  readonly agentId: string;
  readonly workspace: string;
  readonly harness: 'muse' | 'kimi-code';
  readonly model: string;
  readonly launcherScript: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly backend: TerminalBackend;
}

/**
 * Launch the runtime's launcher in the agent's issue workspace on `backend`,
 * and record the pane on the agent state when one exists, so a stop or a
 * failed start can still find a Herdr pane by the id it recorded.
 */
export async function launchRuntimePane(input: RuntimePaneLaunch): Promise<AgentPaneRef> {
  const state = getAgentState(input.agentId);
  const issueId = state?.issueId || input.agentId.replace(/^(agent|planning)-/, '').toUpperCase();
  const pane = await launchAgentPane({
    issueId,
    cwd: input.workspace,
    agentId: input.agentId,
    argv: ['bash', input.launcherScript],
    env: { ...input.env },
    tokens: {
      ...tokensFromLaunchMetadata(state),
      issue: issueId,
      role: toPaneRole(state?.role),
      // The harness decides Herdr's detection policy (`detectionPolicyFor`); a
      // state that lacks it must not default this pane to claude-code's.
      harness: input.harness,
      model: input.model || state?.model || 'unknown',
    },
  }, input.backend);
  if (state) {
    Object.assign(state, { backend: pane.backend, paneId: pane.paneId, terminalId: pane.terminalId });
    saveAgentStateSync(state);
  }
  return pane;
}
