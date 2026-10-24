/**
 * Open the tab an agent launches into (PAN-4582).
 *
 * Every Herdr agent gets its own tab in its workspace. Splitting a pane out of
 * the workspace's current tab halved the remaining rows on every launch, so the
 * fifth conversation in the shared `conversations` workspace got about one row
 * and its Terminal tab rendered blank. A tab's root pane takes the whole tab
 * area. Closing the agent's pane closes its tab.
 */
import type { HerdrApiClient } from './herdr-api.js';

/** The new tab's root pane, as `tab.create` returns it. */
export interface AgentTabPane {
  readonly pane_id: string;
  readonly terminal_id: string;
  readonly workspace_id: string;
  readonly tab_id?: string;
}

export interface OpenAgentTabRequest {
  readonly workspaceId: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Display label for the tab: the agent name. */
  readonly label: string;
}

export async function openAgentTab(api: HerdrApiClient, request: OpenAgentTabRequest): Promise<AgentTabPane> {
  const created = await api.call<{ root_pane?: AgentTabPane }>('tab.create', {
    workspace_id: request.workspaceId,
    cwd: request.cwd,
    env: request.env,
    label: request.label,
    focus: false,
  });
  const pane = created.root_pane;
  if (!pane) throw new Error('tab.create returned no root pane');
  return pane;
}
