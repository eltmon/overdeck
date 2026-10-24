/**
 * Open the tab an agent launches into (PAN-4582).
 *
 * Every Herdr agent gets its own tab in its workspace. Splitting a pane out of
 * the workspace's current tab halved the remaining rows on every launch, so the
 * fifth conversation in the shared `conversations` workspace got about one row
 * and its Terminal tab rendered blank. A tab's root pane takes the whole tab
 * area. Closing the agent's pane closes its tab.
 *
 * A new PTY still copies the session's FOCUSED pane's size, not the tab's own
 * layout rect, so `openAgentTab` sizes it explicitly right after creating it.
 */
import type { HerdrApiClient } from './herdr-api.js';
import { sizeHerdrTerminal } from './herdr-stream.js';

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

/** Sets a terminal's PTY size; `sizeHerdrTerminal` in production. Never throws. */
export type SizeTerminal = (terminalId: string, cols: number, rows: number) => Promise<unknown>;

interface PaneLayoutEntry {
  readonly pane_id?: string;
  readonly rect?: { readonly width?: number; readonly height?: number };
}

export async function openAgentTab(
  api: HerdrApiClient,
  request: OpenAgentTabRequest,
  sizeTerminal: SizeTerminal = sizeHerdrTerminal,
): Promise<AgentTabPane> {
  const created = await api.call<{ root_pane?: AgentTabPane }>('tab.create', {
    workspace_id: request.workspaceId,
    cwd: request.cwd,
    env: request.env,
    label: request.label,
    focus: false,
  });
  const pane = created.root_pane;
  if (!pane) throw new Error('tab.create returned no root pane');

  try {
    const layout = await api.call<{ layout?: { panes?: readonly PaneLayoutEntry[] } }>('pane.layout', {
      pane_id: pane.pane_id,
    });
    const entry = layout.layout?.panes?.find((candidate) => candidate.pane_id === pane.pane_id);
    const width = entry?.rect?.width ?? 0;
    const height = entry?.rect?.height ?? 0;
    if (width < 2 || height < 2) {
      console.warn(`[herdr] could not size ${pane.pane_id} to its layout: no usable rect`);
    } else {
      const outcome = await sizeTerminal(pane.terminal_id, width, height);
      if (outcome !== 'sized') {
        console.warn(`[herdr] could not size ${pane.pane_id} to its layout: sizing attach ${String(outcome)}`);
      }
    }
  } catch (error) {
    console.warn(`[herdr] could not size ${pane.pane_id} to its layout: ${String(error)}`);
  }

  return pane;
}
