/**
 * The selected backend's live agent inventory (PAN-3917 FR-3/FR-11, NFR-3).
 *
 * Counting, reconciling and reaping agents used to mean listing tmux sessions,
 * which is a regression the moment Herdr is the backend: a Herdr-hosted agent
 * has no tmux session at all, so every tmux census reports it dead. These two
 * reads are the backend-aware replacement — the tmux behaviour is unchanged,
 * because it now lives inside the tmux adapter's `list()`.
 *
 * `null` means INDETERMINATE, never "nothing is running": an unreadable
 * inventory must make a caller skip, exactly as `isConfirmedDead` makes a
 * failed liveness probe skip. Everything here is async (NFR-3).
 */

import { Effect } from 'effect';

import { resolveLaunchBackend } from './launch.js';
import { isUnsupported, type AgentState, type TerminalBackendName } from './types.js';

export interface LiveAgentPane {
  readonly backend: TerminalBackendName;
  /** The Overdeck agent id: the tmux session name, or the Herdr live agent name. */
  readonly agentId: string;
  /** Backend-native pane handle (`w1:p1` on Herdr, the session name on tmux). */
  readonly paneId: string;
  readonly terminalId: string;
  readonly state: AgentState;
}

export interface LiveAgentInventory {
  readonly backend: TerminalBackendName;
  readonly panes: readonly LiveAgentPane[];
}

/**
 * Every agent pane the selected backend currently hosts, or `null` when the
 * inventory could not be read. Exited panes are left out — they are residue,
 * not agents.
 */
export async function liveAgentInventory(): Promise<LiveAgentInventory | null> {
  let backend;
  try {
    backend = await resolveLaunchBackend();
  } catch {
    return null;
  }

  if (backend.name === 'herdr') {
    try {
      const { listHerdrAgents } = await import('./herdr.js');
      return {
        backend: 'herdr',
        panes: (await listHerdrAgents())
          .filter((agent) => agent.state !== 'exited')
          .map((agent) => ({
            backend: 'herdr' as const,
            agentId: agent.agentId,
            paneId: agent.paneId,
            terminalId: agent.terminalId,
            state: agent.state,
          })),
      };
    } catch {
      return null;
    }
  }

  const listed = await Effect.runPromise(backend.list()).catch(() => null);
  if (listed === null || isUnsupported(listed)) return null;
  return {
    backend: backend.name,
    panes: listed
      .filter((snapshot) => snapshot.state !== 'exited')
      .map((snapshot) => ({
        backend: backend.name,
        agentId: snapshot.paneId,
        paneId: snapshot.paneId,
        terminalId: snapshot.terminalId,
        state: snapshot.state,
      })),
  };
}

/** The live panes, or `null` when the inventory could not be read. */
export async function listLiveAgentPanes(): Promise<readonly LiveAgentPane[] | null> {
  return (await liveAgentInventory())?.panes ?? null;
}

/** The live agent ids, or `null` when the inventory could not be read. */
export async function listLiveAgentIds(): Promise<ReadonlySet<string> | null> {
  const panes = await listLiveAgentPanes();
  return panes === null ? null : new Set(panes.map((pane) => pane.agentId));
}

/** Recent terminal text from one live pane, or `null` when it cannot be read. */
export async function captureLiveAgentPaneText(
  pane: LiveAgentPane,
  lines: number,
): Promise<string | null> {
  try {
    if (pane.backend === 'herdr') {
      const { readHerdrPaneText } = await import('./herdr.js');
      return await readHerdrPaneText(pane.paneId, lines);
    }
    const { capturePane } = await import('../tmux.js');
    return await Effect.runPromise(capturePane(pane.agentId, lines));
  } catch {
    return null;
  }
}
