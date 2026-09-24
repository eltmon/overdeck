/**
 * Every Herdr terminal a stop has to close for one Overdeck agent id (PAN-3966).
 *
 * `findHerdrAgentPane` (`./herdr.ts`) answers with ONE pane, found by live
 * agent name or `agentId` token. A stop needs more:
 *
 * - every pane stamped with the agent id, not just the first, so an older
 *   launch's residue goes too;
 * - the pane the agent's state recorded. Seen live on 2026-09-24: after a
 *   Herdr restore every residue pane had lost its tokens, the exited harness had
 *   no agent record, and `pan kill` closed nothing. The recorded pane is taken
 *   only when nothing in it names another owner: no other agent's `agentId`
 *   token, and no detected harness under another name;
 * - workspaces that belong to this agent alone. `launchAgentPane` places every
 *   agent in the workspace of its `issueId`, splitting a new pane into it, so an
 *   issue workspace is shared by the issue's work, review and test agents and a
 *   stop never closes it. A role run launched with its own id as the issue (the
 *   backlog sequencer) owns its workspace, root shell included, and a stop
 *   closes it whole.
 */

import { getHerdrApiClient, type HerdrApiClient } from './herdr-api.js';
import { AGENT_ID_TOKEN } from './herdr.js';
import { workspaceBelongsToIssue } from './herdr-workspaces.js';

/** A lookup must never hold up a stop. */
const LOOKUP_TIMEOUT_MS = 2_000;

interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  agent?: string | null;
  name?: string | null;
  tokens?: Record<string, string>;
}

interface WorkspaceInfo {
  workspace_id: string;
  label?: string;
  tokens?: Record<string, string>;
}

/** A Herdr pane by its handles. */
export interface HerdrPaneHandle {
  readonly paneId: string;
  readonly terminalId: string;
  readonly workspaceId: string;
}

/** What `findHerdrAgentTerminals` found for one Overdeck agent id. */
export interface HerdrAgentTerminals {
  /** Every pane the agent occupies, live or residue. */
  readonly panes: readonly HerdrPaneHandle[];
  /** Workspaces that belong to this agent alone (their label or `issue` token is the agent id). */
  readonly workspaceIds: readonly string[];
}

export interface FindHerdrAgentTerminalsOptions {
  /**
   * The pane id the agent's state recorded at launch (`state.paneId`). Herdr
   * does not keep pane metadata across a session restore, so a residue pane
   * can carry no `agentId` token and no agent record, and this is the only
   * handle left that names it.
   */
  readonly recordedPaneId?: string;
}

/** Never throws; a socket that does not answer yields what was found so far. */
export async function findHerdrAgentTerminals(
  agentName: string,
  options: FindHerdrAgentTerminalsOptions = {},
  api: HerdrApiClient = getHerdrApiClient(),
): Promise<HerdrAgentTerminals> {
  const wanted = agentName.toLowerCase();
  const panes = new Map<string, HerdrPaneHandle>();
  const add = (pane: PaneInfo): void => {
    panes.set(pane.pane_id, { paneId: pane.pane_id, terminalId: pane.terminal_id, workspaceId: pane.workspace_id });
  };

  try {
    const info = await api.call<{ agent?: PaneInfo }>('agent.get', { target: agentName }, { timeoutMs: LOOKUP_TIMEOUT_MS });
    if (info.agent) add(info.agent);
  } catch {
    // Pane-bound agents and exited harnesses have no Herdr agent record.
  }

  try {
    const snapshot = await api.call<{ snapshot?: { panes?: PaneInfo[] } }>(
      'session.snapshot',
      {},
      { timeoutMs: LOOKUP_TIMEOUT_MS },
    );
    for (const pane of snapshot.snapshot?.panes ?? []) {
      const owner = pane.tokens?.[AGENT_ID_TOKEN]?.toLowerCase();
      if (owner === wanted) {
        add(pane);
        continue;
      }
      if (pane.pane_id !== options.recordedPaneId || owner) continue;
      if (pane.agent && pane.name?.toLowerCase() !== wanted) continue;
      add(pane);
    }
  } catch {
    // Socket did not answer: close what the agent record named.
  }

  const workspaceIds: string[] = [];
  try {
    const listed = await api.call<{ workspaces?: WorkspaceInfo[] }>('workspace.list', {}, { timeoutMs: LOOKUP_TIMEOUT_MS });
    for (const workspace of listed.workspaces ?? []) {
      if (workspaceBelongsToIssue(workspace, wanted)) workspaceIds.push(workspace.workspace_id);
    }
  } catch {
    // No workspace listing: close the panes one by one.
  }

  return { panes: [...panes.values()], workspaceIds };
}
