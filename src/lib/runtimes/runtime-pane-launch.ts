/**
 * Pane launch for the runtime-class `spawnAgent` of the muse and kimi-code
 * runtimes (PAN-3936). Their callers are Cloister's specialist rotation and
 * crash respawn (`session-rotation.ts`, `service-crash.ts`).
 *
 * The pane goes through `launchAgentPane` on the host's backend, stamped with
 * the same four tokens `spawn.ts` and `recovery.ts` stamp, so on a Herdr host it
 * lands on Herdr (where liveness looks) rather than in a tmux session that
 * `isAliveOnHerdr` reads as dead.
 */
import type { AgentState } from '../agents/agent-state-read.js';
import { detectionPolicyFor, launchAgentPane } from '../terminal-backends/launch.js';
import { toPaneRole, tokensFromLaunchMetadata } from '../terminal-backends/prompt-guard.js';
import type { AgentPaneRef, TerminalBackend } from '../terminal-backends/types.js';

/**
 * Whether a runtime launch wraps the harness in the PTY supervisor — the same
 * rule conversations follow (PAN-3921). On Herdr it is refused only around a
 * harness Herdr must detect (claude-code), whose foreground process node-pty
 * would hide (PAN-3917 W12). muse and kimi-code are pane-bound: Herdr holds no
 * agent record for them, so `agent.prompt` cannot reach them and tmux
 * `send-keys` cannot reach a Herdr pane — the supervisor socket is their
 * delivery path on both backends.
 */
export function runtimeUsesSupervisor(harness: string, backend: TerminalBackend): boolean {
  return backend.name === 'tmux' || detectionPolicyFor(harness) !== 'required';
}

export interface RuntimePaneLaunch {
  readonly agentId: string;
  readonly workspace: string;
  readonly harness: 'muse' | 'kimi-code';
  readonly model: string;
  readonly launcherScript: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly backend: TerminalBackend;
  /** The agent's saved state, when it has one: its tokens, and where the pane is recorded. */
  readonly state: AgentState | null;
  /** Persists `state` after the pane is recorded on it. */
  readonly saveState: (state: AgentState) => void;
}

/**
 * Launch the runtime's launcher in the agent's issue workspace on `backend`,
 * and record the pane on the agent state when one exists, so a stop or a
 * failed start can still find a Herdr pane by the id it recorded.
 */
export async function launchRuntimePane(input: RuntimePaneLaunch): Promise<AgentPaneRef> {
  const { state } = input;
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
    input.saveState(state);
  }
  return pane;
}
