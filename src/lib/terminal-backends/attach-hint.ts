/**
 * The attach hint a CLI command prints after it starts or finds an agent
 * (PAN-3928). A Herdr agent has no tmux session, so the hint must name the
 * backend the pane really lives on. `describeAttach` is pure; `resolveAttach`
 * fills a missing backend from the host selection.
 */
import { getManagedTmuxSocketName } from '../tmux.js';
import { herdrSessionName, hostTerminalBackendName } from './select.js';
import type { TerminalBackendName } from './types.js';

export interface AttachHintAgent {
  readonly id: string;
  readonly backend: TerminalBackendName;
  readonly paneId?: string;
  readonly terminalId?: string;
}

export interface AttachHint {
  /** Where the pane lives: `herdr (pane wG:p2)` or `tmux (session agent-pan-1)`. */
  readonly location: string;
  /** The shell command that opens the agent's terminal. */
  readonly command: string;
}

/**
 * Herdr: `terminal attach <terminalId>` works for every agent, including the
 * pane-bound harnesses (codex, acp, kimi) that have no Herdr agent record;
 * `agent attach <agent-id>` is the fallback for agents launched before the
 * terminal id was recorded, and resolves only detected (claude-code) agents.
 * `--session` is required: Herdr's own default session is `default`.
 */
export function describeAttach(agent: AttachHintAgent): AttachHint {
  if (agent.backend === 'herdr') {
    const session = herdrSessionName();
    return {
      location: `herdr (${agent.paneId ? `pane ${agent.paneId}` : 'pane not recorded'})`,
      command: agent.terminalId
        ? `herdr --session ${session} terminal attach ${agent.terminalId}`
        : `herdr --session ${session} agent attach ${agent.id}`,
    };
  }
  return {
    location: `tmux (session ${agent.id})`,
    command: `tmux -L ${getManagedTmuxSocketName()} attach -t ${agent.id}`,
  };
}

/**
 * The hint for an agent state. The persisted `backend` names the backend the
 * pane was launched on; an agent recorded before PAN-3917 W12 has none, so the
 * host's selected backend (env → config → Herdr) stands in.
 */
export async function resolveAttach(
  agent: Omit<AttachHintAgent, 'backend'> & { readonly backend?: TerminalBackendName },
  hostBackend: () => Promise<TerminalBackendName> = hostTerminalBackendName,
): Promise<AttachHint> {
  return describeAttach({ ...agent, backend: agent.backend ?? (await hostBackend()) });
}

/** The `Backend:` and `Attach:` lines of a `Commands:` block. */
export async function attachHintLines(
  agent: Parameters<typeof resolveAttach>[0],
  hostBackend?: () => Promise<TerminalBackendName>,
): Promise<string[]> {
  const hint = await resolveAttach(agent, hostBackend);
  return [`  Backend:  ${hint.location}`, `  Attach:   ${hint.command}`];
}
